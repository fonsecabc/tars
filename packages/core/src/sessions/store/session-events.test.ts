import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeTestPool, getTestPool } from '../../test-helpers/index.js';
import {
  getSessionEventById,
  insertSessionEvent,
  listEventsSince,
  listSessionEvents,
} from './session-events.js';

const pool = getTestPool();

beforeEach(async () => {
  // The shared resetDb does not touch the Chronicle tables — clear them ourselves.
  await pool.query('TRUNCATE session_events, sessions, session_leases RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await closeTestPool();
});

describe('sessions/store/session-events', () => {
  it('insert returns DB-assigned id/seq/ts and defaults payload to {}', async () => {
    const sessionId = randomUUID();
    const event = await insertSessionEvent(pool, {
      sessionId,
      harness: 'voice',
      actor: 'user',
      kind: 'session_opened',
    });

    expect(typeof event.id).toBe('string');
    expect(typeof event.seq).toBe('string'); // bigint surfaces as string — never a number
    expect(event.ts).toBeInstanceOf(Date);
    expect(event.sessionId).toBe(sessionId);
    expect(event.harness).toBe('voice');
    expect(event.actor).toBe('user');
    expect(event.kind).toBe('session_opened');
    expect(event.payload).toEqual({});
  });

  it('insert round-trips an explicit payload', async () => {
    const event = await insertSessionEvent(pool, {
      sessionId: randomUUID(),
      harness: 'whatsapp',
      actor: 'assistant',
      kind: 'turn_message',
      payload: { body: 'hello', hop_count: 1 },
    });
    expect(event.payload).toEqual({ body: 'hello', hop_count: 1 });
  });

  it('per-session list replays in seq ASC order and does not leak other sessions', async () => {
    const a = randomUUID();
    const b = randomUUID();
    const a1 = await insertSessionEvent(pool, {
      sessionId: a,
      harness: 'voice',
      actor: 'user',
      kind: 'session_opened',
    });
    await insertSessionEvent(pool, {
      sessionId: b,
      harness: 'cron',
      actor: 'system',
      kind: 'session_opened',
    });
    const a2 = await insertSessionEvent(pool, {
      sessionId: a,
      harness: 'voice',
      actor: 'assistant',
      kind: 'turn_message',
    });
    const a3 = await insertSessionEvent(pool, {
      sessionId: a,
      harness: 'voice',
      actor: 'assistant',
      kind: 'turn_completed',
    });

    const events = await listSessionEvents(pool, a);
    expect(events.map((e) => e.id)).toEqual([a1.id, a2.id, a3.id]);
    expect(events.every((e) => e.sessionId === a)).toBe(true);
  });

  it('per-session list respects the afterSeq cursor and limit', async () => {
    const sessionId = randomUUID();
    const first = await insertSessionEvent(pool, {
      sessionId,
      harness: 'slack',
      actor: 'user',
      kind: 'session_opened',
    });
    const second = await insertSessionEvent(pool, {
      sessionId,
      harness: 'slack',
      actor: 'assistant',
      kind: 'turn_message',
    });
    const third = await insertSessionEvent(pool, {
      sessionId,
      harness: 'slack',
      actor: 'assistant',
      kind: 'turn_completed',
    });

    const afterFirst = await listSessionEvents(pool, sessionId, { afterSeq: first.seq });
    expect(afterFirst.map((e) => e.id)).toEqual([second.id, third.id]);

    const limited = await listSessionEvents(pool, sessionId, { afterSeq: first.seq, limit: 1 });
    expect(limited.map((e) => e.id)).toEqual([second.id]);

    const afterLast = await listSessionEvents(pool, sessionId, { afterSeq: third.seq });
    expect(afterLast).toEqual([]);
  });

  it('listEventsSince tails across ALL sessions in global seq order', async () => {
    const a = randomUUID();
    const b = randomUUID();
    const e1 = await insertSessionEvent(pool, {
      sessionId: a,
      harness: 'voice',
      actor: 'user',
      kind: 'session_opened',
    });
    const e2 = await insertSessionEvent(pool, {
      sessionId: b,
      harness: 'cc-shadow',
      actor: 'system',
      kind: 'session_opened',
    });
    const e3 = await insertSessionEvent(pool, {
      sessionId: a,
      harness: 'whatsapp',
      actor: b,
      kind: 'message',
    });

    const all = await listEventsSince(pool, '0');
    expect(all.map((e) => e.id)).toEqual([e1.id, e2.id, e3.id]);

    const tail = await listEventsSince(pool, e1.seq);
    expect(tail.map((e) => e.id)).toEqual([e2.id, e3.id]);

    const limited = await listEventsSince(pool, e1.seq, { limit: 1 });
    expect(limited.map((e) => e.id)).toEqual([e2.id]);
  });

  it('getSessionEventById returns the event, or undefined on a miss', async () => {
    const inserted = await insertSessionEvent(pool, {
      sessionId: randomUUID(),
      harness: 'cron',
      actor: 'system',
      kind: 'signal',
      payload: { op: 'ping' },
    });

    const hit = await getSessionEventById(pool, inserted.id);
    expect(hit).toBeDefined();
    expect(hit?.seq).toBe(inserted.seq);
    expect(hit?.payload).toEqual({ op: 'ping' });

    const miss = await getSessionEventById(pool, randomUUID());
    expect(miss).toBeUndefined();
  });

  it('rejects a kind outside the CHECK constraint at the DB level', async () => {
    await expect(
      pool.query(
        `INSERT INTO session_events (session_id, harness, actor, kind)
         VALUES ($1, 'voice', 'user', 'not_a_real_kind')`,
        [randomUUID()],
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});
