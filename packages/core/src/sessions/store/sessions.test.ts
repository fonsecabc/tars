import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeTestPool, getTestPool } from '../../test-helpers/index.js';
import {
  findOrCreateSession,
  findSessionByExternalRef,
  findSessionById,
  listSessions,
  updateSessionProjection,
} from './sessions.js';

const pool = getTestPool();

beforeEach(async () => {
  // The shared resetDb does not cover the Chronicle tables — clear them here.
  await pool.query('TRUNCATE session_events, sessions, session_leases RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await closeTestPool();
});

describe('sessions/store/sessions — findOrCreateSession', () => {
  it('creates a session with defaults applied', async () => {
    const session = await findOrCreateSession(pool, { origin: 'voice', externalRef: 'ref-1' });
    expect(typeof session.id).toBe('string');
    expect(session.origin).toBe('voice');
    expect(session.externalRef).toBe('ref-1');
    expect(session.title).toBeNull();
    expect(session.status).toBe('active');
    expect(session.tier).toBe('owner');
    expect(session.lastSeq).toBeNull();
    expect(session.metadata).toEqual({});
    expect(session.createdAt).toBeInstanceOf(Date);
    expect(session.updatedAt).toBeInstanceOf(Date);
  });

  it('find-or-create on the same (origin, externalRef) returns the SAME row', async () => {
    const first = await findOrCreateSession(pool, {
      origin: 'cron',
      externalRef: 'task-42',
      title: 'Original title',
    });
    const second = await findOrCreateSession(pool, {
      origin: 'cron',
      externalRef: 'task-42',
      title: 'A different title that must NOT overwrite',
    });
    expect(second.id).toBe(first.id);
    expect(second.title).toBe('Original title');

    const all = await listSessions(pool);
    expect(all).toHaveLength(1);
  });

  it('same externalRef under a different origin is a distinct session', async () => {
    const voice = await findOrCreateSession(pool, { origin: 'voice', externalRef: 'inbox' });
    const slack = await findOrCreateSession(pool, { origin: 'slack', externalRef: 'inbox' });
    expect(slack.id).not.toBe(voice.id);

    const all = await listSessions(pool);
    expect(all).toHaveLength(2);
  });

  it('null/omitted externalRef always inserts a fresh session', async () => {
    const a = await findOrCreateSession(pool, { origin: 'whatsapp', externalRef: null });
    const b = await findOrCreateSession(pool, { origin: 'whatsapp', externalRef: null });
    const c = await findOrCreateSession(pool, { origin: 'whatsapp' });
    expect(b.id).not.toBe(a.id);
    expect(c.id).not.toBe(a.id);
    expect(c.id).not.toBe(b.id);

    const all = await listSessions(pool);
    expect(all).toHaveLength(3);
  });

  it('honors an explicit input.id', async () => {
    const id = randomUUID();
    const session = await findOrCreateSession(pool, {
      id,
      origin: 'cc-shadow',
      externalRef: 'cc-session-7',
    });
    expect(session.id).toBe(id);
    expect((await findSessionById(pool, id))?.externalRef).toBe('cc-session-7');
  });

  it('applies explicit title, tier and metadata on create', async () => {
    const session = await findOrCreateSession(pool, {
      origin: 'slack',
      externalRef: 'channel-1',
      title: 'Slack thread',
      tier: 'guest',
      metadata: { channel: 'general' },
    });
    expect(session.title).toBe('Slack thread');
    expect(session.tier).toBe('guest');
    expect(session.metadata).toEqual({ channel: 'general' });
  });
});

describe('sessions/store/sessions — finders', () => {
  it('findSessionById returns the row or undefined', async () => {
    const created = await findOrCreateSession(pool, { origin: 'voice', externalRef: 'ref-x' });
    expect((await findSessionById(pool, created.id))?.id).toBe(created.id);
    expect(await findSessionById(pool, randomUUID())).toBeUndefined();
  });

  it('findSessionByExternalRef hit and miss', async () => {
    const created = await findOrCreateSession(pool, { origin: 'cron', externalRef: 'task-9' });

    const hit = await findSessionByExternalRef(pool, 'cron', 'task-9');
    expect(hit?.id).toBe(created.id);

    expect(await findSessionByExternalRef(pool, 'cron', 'task-10')).toBeUndefined();
    expect(await findSessionByExternalRef(pool, 'voice', 'task-9')).toBeUndefined();
  });
});

describe('sessions/store/sessions — listSessions', () => {
  it('filters by status, origin and tier', async () => {
    const a = await findOrCreateSession(pool, { origin: 'voice', externalRef: 'a' });
    await findOrCreateSession(pool, { origin: 'slack', externalRef: 'b', tier: 'trusted' });
    await findOrCreateSession(pool, { origin: 'voice', externalRef: 'c' });
    await updateSessionProjection(pool, a.id, { status: 'closed' });

    const closed = await listSessions(pool, { status: 'closed' });
    expect(closed.map((s) => s.id)).toEqual([a.id]);

    const voice = await listSessions(pool, { origin: 'voice' });
    expect(voice).toHaveLength(2);
    expect(voice.every((s) => s.origin === 'voice')).toBe(true);

    const trusted = await listSessions(pool, { tier: 'trusted' });
    expect(trusted).toHaveLength(1);
    expect(trusted[0]?.externalRef).toBe('b');

    const activeVoice = await listSessions(pool, { status: 'active', origin: 'voice' });
    expect(activeVoice.map((s) => s.externalRef)).toEqual(['c']);
  });

  it('orders by updated_at DESC and respects limit', async () => {
    const a = await findOrCreateSession(pool, { origin: 'cron', externalRef: 'first' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await findOrCreateSession(pool, { origin: 'cron', externalRef: 'second' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Touching the oldest row bumps it to the front of the list.
    await updateSessionProjection(pool, a.id, { title: 'touched' });

    const all = await listSessions(pool);
    expect(all.map((s) => s.externalRef)).toEqual(['first', 'second']);

    const limited = await listSessions(pool, { limit: 1 });
    expect(limited.map((s) => s.externalRef)).toEqual(['first']);
  });
});

describe('sessions/store/sessions — updateSessionProjection', () => {
  it('advances lastSeq as a bigint string round-trip', async () => {
    const created = await findOrCreateSession(pool, { origin: 'whatsapp', externalRef: 'w1' });
    expect(created.lastSeq).toBeNull();

    const big = '9007199254740993'; // > Number.MAX_SAFE_INTEGER — must survive as a string
    const updated = await updateSessionProjection(pool, created.id, { lastSeq: big });
    expect(updated?.lastSeq).toBe(big);
    expect(typeof updated?.lastSeq).toBe('string');
  });

  it('transitions status and bumps updated_at', async () => {
    const created = await findOrCreateSession(pool, { origin: 'voice', externalRef: 'v1' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const updated = await updateSessionProjection(pool, created.id, { status: 'idle' });
    expect(updated?.status).toBe('idle');
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
  });

  it('updates title (including back to null), tier and metadata', async () => {
    const created = await findOrCreateSession(pool, {
      origin: 'slack',
      externalRef: 's1',
      title: 'Named',
    });
    const updated = await updateSessionProjection(pool, created.id, {
      title: null,
      tier: 'trusted',
      metadata: { k: 'v' },
    });
    expect(updated?.title).toBeNull();
    expect(updated?.tier).toBe('trusted');
    expect(updated?.metadata).toEqual({ k: 'v' });
  });

  it('returns undefined for an unknown id', async () => {
    expect(await updateSessionProjection(pool, randomUUID(), { status: 'closed' })).toBeUndefined();
  });

  it('empty fields returns the current row unchanged', async () => {
    const created = await findOrCreateSession(pool, { origin: 'cron', externalRef: 'noop' });
    const same = await updateSessionProjection(pool, created.id, {});
    expect(same?.id).toBe(created.id);
    expect(same?.updatedAt.getTime()).toBe(created.updatedAt.getTime());
  });
});
