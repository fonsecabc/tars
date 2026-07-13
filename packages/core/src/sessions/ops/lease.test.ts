import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeTestPool, getTestPool } from '../../test-helpers/index.js';
import { listAudit } from '../../store/audit.js';
import { LeaseConflictError, LeaseNotRenewableError } from '../errors.js';
import { claimLease as storeClaimLease, getLease as storeGetLease } from '../store/leases.js';
import { acquireLease, releaseLease, renewLease, takeOverLease } from './lease.js';

const pool = getTestPool();

beforeEach(async () => {
  await pool.query('TRUNCATE session_events, sessions, session_leases RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await closeTestPool();
});

/** Lease audit rows scoped to one session, newest-first. */
async function leaseAudit(sessionId: string) {
  return listAudit(pool, { targetKind: 'session', targetId: sessionId });
}

describe('lease.acquireLease', () => {
  it('claims a free session, returns epoch 1, and writes a lease.claim audit row', async () => {
    const sessionId = randomUUID();
    const lease = await acquireLease(pool, {
      sessionId,
      holder: 'holder-a',
      harness: 'voice',
    });

    expect(lease.holder).toBe('holder-a');
    expect(lease.epoch).toBe('1');

    const audit = await leaseAudit(sessionId);
    const claim = audit.find((a) => a.action === 'lease.claim');
    expect(claim).toBeDefined();
    expect(claim?.detail).toMatchObject({ holder: 'holder-a', harness: 'voice', epoch: '1' });
  });

  it('throws LeaseConflictError naming the live holder when a different holder holds it', async () => {
    const sessionId = randomUUID();
    await acquireLease(pool, { sessionId, holder: 'holder-a', harness: 'voice' });

    await expect(
      acquireLease(pool, { sessionId, holder: 'holder-b', harness: 'cron' }),
    ).rejects.toMatchObject({ heldBy: 'holder-a', requestedBy: 'holder-b' });
    await expect(
      acquireLease(pool, { sessionId, holder: 'holder-b', harness: 'cron' }),
    ).rejects.toBeInstanceOf(LeaseConflictError);
  });

  it('lets the same holder re-claim a live lease, keeping epoch 1', async () => {
    const sessionId = randomUUID();
    await acquireLease(pool, { sessionId, holder: 'holder-a', harness: 'voice' });
    const again = await acquireLease(pool, { sessionId, holder: 'holder-a', harness: 'voice' });

    expect(again.holder).toBe('holder-a');
    expect(again.epoch).toBe('1');
  });
});

describe('lease.renewLease', () => {
  it('extends the expiry for the holder, keeps epoch, and writes NO new audit row', async () => {
    const sessionId = randomUUID();
    const acquired = await acquireLease(pool, {
      sessionId,
      holder: 'holder-a',
      harness: 'voice',
      ttlSeconds: 60,
    });
    const auditBefore = await leaseAudit(sessionId);

    const renewed = await renewLease(pool, { sessionId, holder: 'holder-a', ttlSeconds: 120 });

    expect(renewed.epoch).toBe(acquired.epoch);
    expect(renewed.expiresAt.getTime()).toBeGreaterThan(acquired.expiresAt.getTime());

    const auditAfter = await leaseAudit(sessionId);
    expect(auditAfter).toHaveLength(auditBefore.length);
  });

  it('throws LeaseNotRenewableError for a non-holder', async () => {
    const sessionId = randomUUID();
    await acquireLease(pool, { sessionId, holder: 'holder-a', harness: 'voice' });

    await expect(renewLease(pool, { sessionId, holder: 'holder-b' })).rejects.toBeInstanceOf(
      LeaseNotRenewableError,
    );
  });

  it('throws LeaseNotRenewableError when the lease has expired', async () => {
    const sessionId = randomUUID();
    // Seed a lease already in the past — an expired lease is not renewable.
    await storeClaimLease(pool, {
      sessionId,
      holder: 'holder-a',
      harness: 'voice',
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(renewLease(pool, { sessionId, holder: 'holder-a' })).rejects.toBeInstanceOf(
      LeaseNotRenewableError,
    );
  });
});

describe('lease.takeOverLease', () => {
  it('force-transfers a live foreign lease, bumps epoch to 2, and audits the seizure', async () => {
    const sessionId = randomUUID();
    await acquireLease(pool, { sessionId, holder: 'holder-a', harness: 'voice' });

    const seized = await takeOverLease(pool, {
      sessionId,
      holder: 'holder-b',
      harness: 'cron',
      reason: 'grab the wheel',
    });

    expect(seized.holder).toBe('holder-b');
    expect(seized.epoch).toBe('2');

    const audit = await leaseAudit(sessionId);
    const takeover = audit.find((a) => a.action === 'lease.takeover');
    expect(takeover).toBeDefined();
    expect(takeover?.detail).toMatchObject({
      holder: 'holder-b',
      harness: 'cron',
      epoch: '2',
      previousHolder: 'holder-a',
      reason: 'grab the wheel',
    });
  });
});

describe('lease.releaseLease', () => {
  it('releases for the holder, returns true, and writes a lease.release audit row', async () => {
    const sessionId = randomUUID();
    await acquireLease(pool, { sessionId, holder: 'holder-a', harness: 'voice' });

    const released = await releaseLease(pool, { sessionId, holder: 'holder-a' });
    expect(released).toBe(true);

    const audit = await leaseAudit(sessionId);
    expect(audit.some((a) => a.action === 'lease.release')).toBe(true);
    expect(await storeGetLease(pool, sessionId)).toBeUndefined();
  });

  it('is a no-op for a non-holder: returns false, writes no audit, leaves the lease intact', async () => {
    const sessionId = randomUUID();
    await acquireLease(pool, { sessionId, holder: 'holder-a', harness: 'voice' });

    const released = await releaseLease(pool, { sessionId, holder: 'holder-b' });
    expect(released).toBe(false);

    const audit = await leaseAudit(sessionId);
    expect(audit.some((a) => a.action === 'lease.release')).toBe(false);

    const live = await storeGetLease(pool, sessionId);
    expect(live?.holder).toBe('holder-a');
  });
});
