import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { listAudit } from '../../store/audit.js';
import { closeTestPool, getTestPool } from '../../test-helpers/index.js';
import {
  LeaseConflictError,
  LeaseExpiredError,
  LeaseRequiredError,
  StaleLeaseError,
} from '../errors.js';
import { claimLease, takeOverLease } from '../store/leases.js';
import { appendEvent, checkpoint, openSession } from './append.js';

const pool = getTestPool();

/** Session tables are outside the shared resetDb's scope — clear them explicitly. */
beforeEach(async () => {
  await pool.query('TRUNCATE session_events, sessions, session_leases RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await closeTestPool();
});

const future = (): Date => new Date(Date.now() + 60_000);
const past = (): Date => new Date(Date.now() - 60_000);

/** Count of audit_log rows, for asserting appends do NOT audit. */
async function auditCount(): Promise<number> {
  const res = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM audit_log');
  return Number(res.rows[0]!.count);
}

describe('openSession', () => {
  it('creates a session + a session_opened event, sets lastSeq, writes a session.open audit row', async () => {
    const { session, event } = await openSession(pool, {
      origin: 'voice',
      externalRef: 'cc-123',
      title: 'first session',
    });

    expect(session.id).toBeDefined();
    expect(session.origin).toBe('voice');
    expect(event.kind).toBe('session_opened');
    expect(event.sessionId).toBe(session.id);

    // Projection watermark advanced to the genesis event's seq.
    const refreshed = await pool.query<{ last_seq: string | null }>(
      'SELECT last_seq FROM sessions WHERE id = $1',
      [session.id],
    );
    expect(refreshed.rows[0]!.last_seq).toBe(event.seq);

    const audit = await listAudit(pool, { targetKind: 'session', targetId: session.id });
    expect(audit.some((a) => a.action === 'session.open')).toBe(true);
  });
});

describe('appendEvent — message lane (ungated)', () => {
  it('appends a message-lane event with NO lease at all', async () => {
    const { session } = await openSession(pool, { origin: 'voice' });

    const event = await appendEvent(pool, {
      sessionId: session.id,
      harness: 'whatsapp',
      actor: 'session:other',
      kind: 'message',
      payload: { body: 'ping' },
    });

    expect(event.kind).toBe('message');
    expect(event.sessionId).toBe(session.id);
  });

  it('does NOT resurrect a closed/archived session (message lane never touches status)', async () => {
    const { session } = await openSession(pool, { origin: 'voice', externalRef: 'closed-1' });
    await pool.query(`UPDATE sessions SET status = 'closed' WHERE id = $1`, [session.id]);

    const event = await appendEvent(pool, {
      sessionId: session.id,
      harness: 'whatsapp',
      actor: 'session:other',
      kind: 'message',
      payload: { body: 'you there?' },
    });

    const row = await pool.query<{ status: string; last_seq: string | null }>(
      'SELECT status, last_seq FROM sessions WHERE id = $1',
      [session.id],
    );
    // Status stays closed (no silent resurrection by an ungated write)…
    expect(row.rows[0]!.status).toBe('closed');
    // …but the global watermark still advances to the message event.
    expect(row.rows[0]!.last_seq).toBe(event.seq);
  });
});

describe('appendEvent — turn lane gating', () => {
  it('throws LeaseRequiredError for a turn event with NO holder', async () => {
    const { session } = await openSession(pool, { origin: 'voice' });

    await expect(
      appendEvent(pool, {
        sessionId: session.id,
        harness: 'voice',
        actor: 'assistant',
        kind: 'turn_message',
      }),
    ).rejects.toBeInstanceOf(LeaseRequiredError);
  });

  it('throws LeaseRequiredError for a turn event with a holder but NO lease', async () => {
    const { session } = await openSession(pool, { origin: 'voice' });

    await expect(
      appendEvent(
        pool,
        { sessionId: session.id, harness: 'voice', actor: 'assistant', kind: 'turn_message' },
        { holder: 'voice:main' },
      ),
    ).rejects.toBeInstanceOf(LeaseRequiredError);
  });

  it('throws LeaseConflictError when the holder differs from the lease holder', async () => {
    const { session } = await openSession(pool, { origin: 'voice' });
    await claimLease(pool, {
      sessionId: session.id,
      holder: 'voice:main',
      harness: 'voice',
      expiresAt: future(),
    });

    await expect(
      appendEvent(
        pool,
        { sessionId: session.id, harness: 'whatsapp', actor: 'assistant', kind: 'turn_message' },
        { holder: 'whatsapp:x' },
      ),
    ).rejects.toBeInstanceOf(LeaseConflictError);
  });

  it('throws LeaseExpiredError when the lease has expired', async () => {
    const { session } = await openSession(pool, { origin: 'voice' });
    await claimLease(pool, {
      sessionId: session.id,
      holder: 'voice:main',
      harness: 'voice',
      expiresAt: past(),
    });

    await expect(
      appendEvent(
        pool,
        { sessionId: session.id, harness: 'voice', actor: 'assistant', kind: 'turn_message' },
        { holder: 'voice:main' },
      ),
    ).rejects.toBeInstanceOf(LeaseExpiredError);
  });

  it('fences a stale writer: expectedEpoch behind the live epoch throws StaleLeaseError', async () => {
    const { session } = await openSession(pool, { origin: 'voice' });
    const claimed = await claimLease(pool, {
      sessionId: session.id,
      holder: 'voice:main',
      harness: 'voice',
      expiresAt: future(),
    });
    expect(claimed?.epoch).toBe('1');

    // A take-over (even by the same holder identity) declares a new writing era and bumps the
    // fencing epoch to 2. The old incarnation, still believing it holds epoch 1, is now stale.
    const takenOver = await takeOverLease(pool, {
      sessionId: session.id,
      holder: 'voice:main',
      harness: 'voice',
      expiresAt: future(),
    });
    expect(takenOver.epoch).toBe('2');

    await expect(
      appendEvent(
        pool,
        { sessionId: session.id, harness: 'voice', actor: 'assistant', kind: 'turn_message' },
        { holder: 'voice:main', expectedEpoch: '1' },
      ),
    ).rejects.toBeInstanceOf(StaleLeaseError);
  });

  it('happy path: a live lease with the right holder + epoch appends and advances last_seq', async () => {
    const { session, event: opened } = await openSession(pool, { origin: 'voice' });
    const claimed = await claimLease(pool, {
      sessionId: session.id,
      holder: 'voice:main',
      harness: 'voice',
      expiresAt: future(),
    });

    const event = await appendEvent(
      pool,
      { sessionId: session.id, harness: 'voice', actor: 'assistant', kind: 'turn_message' },
      { holder: 'voice:main', expectedEpoch: claimed!.epoch },
    );

    expect(event.kind).toBe('turn_message');
    expect(BigInt(event.seq)).toBeGreaterThan(BigInt(opened.seq));

    const refreshed = await pool.query<{ last_seq: string | null }>(
      'SELECT last_seq FROM sessions WHERE id = $1',
      [session.id],
    );
    expect(refreshed.rows[0]!.last_seq).toBe(event.seq);
  });
});

describe('appendEvent — auditing', () => {
  it('does NOT write an audit row for a turn/message event', async () => {
    const { session } = await openSession(pool, { origin: 'voice' });
    await claimLease(pool, {
      sessionId: session.id,
      holder: 'voice:main',
      harness: 'voice',
      expiresAt: future(),
    });

    const before = await auditCount();
    await appendEvent(
      pool,
      { sessionId: session.id, harness: 'voice', actor: 'assistant', kind: 'turn_message' },
      { holder: 'voice:main' },
    );
    await appendEvent(pool, {
      sessionId: session.id,
      harness: 'whatsapp',
      actor: 'session:other',
      kind: 'message',
    });
    const after = await auditCount();

    expect(after).toBe(before);
  });
});

describe('appendEvent — session_opened exemption', () => {
  it('appends a raw session_opened turn event with no holder (genesis is exempt)', async () => {
    const { session } = await openSession(pool, { origin: 'voice' });

    const event = await appendEvent(pool, {
      sessionId: session.id,
      harness: 'voice',
      actor: 'system',
      kind: 'session_opened',
    });

    expect(event.kind).toBe('session_opened');
  });
});

describe('checkpoint', () => {
  it('goes through the turn-lane gate: no lease throws LeaseRequiredError', async () => {
    const { session } = await openSession(pool, { origin: 'voice' });

    await expect(
      checkpoint(pool, { sessionId: session.id, harness: 'voice', holder: 'voice:main' }),
    ).rejects.toBeInstanceOf(LeaseRequiredError);
  });

  it('logs a checkpoint event when a live lease is held', async () => {
    const { session } = await openSession(pool, { origin: 'voice' });
    await claimLease(pool, {
      sessionId: session.id,
      holder: 'voice:main',
      harness: 'voice',
      expiresAt: future(),
    });

    const event = await checkpoint(pool, {
      sessionId: session.id,
      harness: 'voice',
      holder: 'voice:main',
      payload: { snapshot: 'ok' },
    });

    expect(event.kind).toBe('checkpoint');
    expect(event.payload).toEqual({ snapshot: 'ok' });
  });
});
