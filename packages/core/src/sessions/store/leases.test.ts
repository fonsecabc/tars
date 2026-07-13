import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeTestPool, getTestPool } from '../../test-helpers/index.js';
import { claimLease, getLease, releaseLease, renewLease, takeOverLease } from './leases.js';

const pool = getTestPool();

/** A live lease deadline, comfortably in the future. */
function liveExpiry(): Date {
  return new Date(Date.now() + 60_000);
}

/** An already-passed deadline, i.e. an expired lease. */
function pastExpiry(): Date {
  return new Date(Date.now() - 1_000);
}

beforeEach(async () => {
  // The shared resetDb does not touch the Chronicle tables; truncate them ourselves.
  await pool.query('TRUNCATE session_events, sessions, session_leases RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await closeTestPool();
});

describe('sessions/store/leases — claimLease', () => {
  it('claims a fresh lease at epoch 1', async () => {
    const sessionId = randomUUID();
    const expiresAt = liveExpiry();
    const lease = await claimLease(pool, {
      sessionId,
      holder: 'voice:main',
      harness: 'voice',
      expiresAt,
    });

    expect(lease).toBeDefined();
    expect(lease?.sessionId).toBe(sessionId);
    expect(lease?.holder).toBe('voice:main');
    expect(lease?.harness).toBe('voice');
    expect(lease?.epoch).toBe('1');
    expect(lease?.acquiredAt).toBeInstanceOf(Date);
    expect(lease?.renewedAt).toBeInstanceOf(Date);
    expect(lease?.expiresAt.getTime()).toBe(expiresAt.getTime());
  });

  it('refuses a claim by a DIFFERENT holder while the lease is live, leaving the row unchanged', async () => {
    const sessionId = randomUUID();
    const original = await claimLease(pool, {
      sessionId,
      holder: 'voice:main',
      harness: 'voice',
      expiresAt: liveExpiry(),
    });
    expect(original).toBeDefined();

    const rival = await claimLease(pool, {
      sessionId,
      holder: 'whatsapp:responder',
      harness: 'whatsapp',
      expiresAt: liveExpiry(),
    });
    expect(rival).toBeUndefined();

    const current = await getLease(pool, sessionId);
    expect(current?.holder).toBe('voice:main');
    expect(current?.harness).toBe('voice');
    expect(current?.epoch).toBe('1');
    expect(current?.expiresAt.getTime()).toBe(original?.expiresAt.getTime());
    expect(current?.renewedAt.getTime()).toBe(original?.renewedAt.getTime());
  });

  it('lets the SAME holder re-claim while live: epoch and acquiredAt kept, expiry refreshed', async () => {
    const sessionId = randomUUID();
    const first = await claimLease(pool, {
      sessionId,
      holder: 'voice:main',
      harness: 'voice',
      expiresAt: liveExpiry(),
    });
    expect(first).toBeDefined();

    const laterExpiry = new Date(Date.now() + 120_000);
    const reclaimed = await claimLease(pool, {
      sessionId,
      holder: 'voice:main',
      harness: 'voice',
      expiresAt: laterExpiry,
    });

    expect(reclaimed).toBeDefined();
    expect(reclaimed?.epoch).toBe('1');
    expect(reclaimed?.acquiredAt.getTime()).toBe(first?.acquiredAt.getTime());
    expect(reclaimed?.expiresAt.getTime()).toBe(laterExpiry.getTime());
  });

  it('lets a NEW holder claim an EXPIRED lease: epoch bumped, acquiredAt reset', async () => {
    const sessionId = randomUUID();
    const stale = await claimLease(pool, {
      sessionId,
      holder: 'voice:main',
      harness: 'voice',
      expiresAt: pastExpiry(),
    });
    expect(stale).toBeDefined();

    const claimed = await claimLease(pool, {
      sessionId,
      holder: 'cron:briefing',
      harness: 'cron',
      expiresAt: liveExpiry(),
    });

    expect(claimed).toBeDefined();
    expect(claimed?.holder).toBe('cron:briefing');
    expect(claimed?.harness).toBe('cron');
    expect(claimed?.epoch).toBe('2');
    expect(claimed?.acquiredAt.getTime()).toBeGreaterThan(stale?.acquiredAt.getTime() ?? Infinity);
  });
});

describe('sessions/store/leases — renewLease', () => {
  it('renews a live lease held by the caller, extending the expiry', async () => {
    const sessionId = randomUUID();
    const lease = await claimLease(pool, {
      sessionId,
      holder: 'voice:main',
      harness: 'voice',
      expiresAt: liveExpiry(),
    });
    expect(lease).toBeDefined();

    const newExpiry = new Date(Date.now() + 300_000);
    const renewed = await renewLease(pool, sessionId, 'voice:main', newExpiry);

    expect(renewed).toBeDefined();
    expect(renewed?.expiresAt.getTime()).toBe(newExpiry.getTime());
    expect(renewed?.epoch).toBe('1');
  });

  it("refuses to renew someone else's live lease", async () => {
    const sessionId = randomUUID();
    await claimLease(pool, {
      sessionId,
      holder: 'voice:main',
      harness: 'voice',
      expiresAt: liveExpiry(),
    });

    const renewed = await renewLease(pool, sessionId, 'whatsapp:responder', liveExpiry());
    expect(renewed).toBeUndefined();
  });

  it('refuses to renew an EXPIRED lease even for its own holder', async () => {
    const sessionId = randomUUID();
    await claimLease(pool, {
      sessionId,
      holder: 'voice:main',
      harness: 'voice',
      expiresAt: pastExpiry(),
    });

    const renewed = await renewLease(pool, sessionId, 'voice:main', liveExpiry());
    expect(renewed).toBeUndefined();
  });
});

describe('sessions/store/leases — takeOverLease', () => {
  it('force-transfers a LIVE foreign lease: holder swapped, epoch bumped', async () => {
    const sessionId = randomUUID();
    await claimLease(pool, {
      sessionId,
      holder: 'voice:main',
      harness: 'voice',
      expiresAt: liveExpiry(),
    });

    const taken = await takeOverLease(pool, {
      sessionId,
      holder: 'cc-shadow:desktop',
      harness: 'cc-shadow',
      expiresAt: liveExpiry(),
      reason: 'operator grabbed the wheel',
    });

    expect(taken.holder).toBe('cc-shadow:desktop');
    expect(taken.harness).toBe('cc-shadow');
    expect(taken.epoch).toBe('2');
  });

  it('bumps the epoch even when the SAME holder takes over (a takeover is always a new writing era)', async () => {
    const sessionId = randomUUID();
    await claimLease(pool, {
      sessionId,
      holder: 'voice:main',
      harness: 'voice',
      expiresAt: liveExpiry(),
    });

    const taken = await takeOverLease(pool, {
      sessionId,
      holder: 'voice:main',
      harness: 'voice',
      expiresAt: liveExpiry(),
    });

    // Unconditional bump: fences any stale in-flight writer from the prior epoch, even though
    // the holder string is unchanged.
    expect(taken.holder).toBe('voice:main');
    expect(taken.epoch).toBe('2');
  });

  it('creates the lease at epoch 1 when no row exists', async () => {
    const sessionId = randomUUID();
    const taken = await takeOverLease(pool, {
      sessionId,
      holder: 'slack:bot',
      harness: 'slack',
      expiresAt: liveExpiry(),
    });

    expect(taken.sessionId).toBe(sessionId);
    expect(taken.holder).toBe('slack:bot');
    expect(taken.epoch).toBe('1');
  });
});

describe('sessions/store/leases — releaseLease', () => {
  it('lets the holder release, after which getLease returns undefined', async () => {
    const sessionId = randomUUID();
    await claimLease(pool, {
      sessionId,
      holder: 'voice:main',
      harness: 'voice',
      expiresAt: liveExpiry(),
    });

    expect(await releaseLease(pool, sessionId, 'voice:main')).toBe(true);
    expect(await getLease(pool, sessionId)).toBeUndefined();
  });

  it('refuses release by a non-holder, leaving the lease intact', async () => {
    const sessionId = randomUUID();
    await claimLease(pool, {
      sessionId,
      holder: 'voice:main',
      harness: 'voice',
      expiresAt: liveExpiry(),
    });

    expect(await releaseLease(pool, sessionId, 'whatsapp:responder')).toBe(false);

    const stillThere = await getLease(pool, sessionId);
    expect(stillThere?.holder).toBe('voice:main');
    expect(stillThere?.epoch).toBe('1');
  });
});
