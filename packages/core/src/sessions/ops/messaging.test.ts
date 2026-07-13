import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeTestPool, getTestPool } from '../../test-helpers/index.js';
import { HopCountExceededError, SessionNotFoundError } from '../errors.js';
import { openSession } from './append.js';
import {
  ensureInbox,
  listInbox,
  MAX_MESSAGE_BODY,
  resolveAddress,
  sendMessage,
  sendSignal,
} from './messaging.js';

const pool = getTestPool();

/** Session tables are outside the shared resetDb's scope — clear them explicitly. */
beforeEach(async () => {
  await pool.query('TRUNCATE session_events, sessions, session_leases RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await closeTestPool();
});

describe('resolveAddress (pure)', () => {
  it("resolves '@voice' to 'voice'", () => {
    expect(resolveAddress('@voice')).toBe('voice');
  });

  it('throws on an unknown harness, naming the valid harnesses', () => {
    expect(() => resolveAddress('@bogus')).toThrow(/voice.*whatsapp.*cron.*cc-shadow.*slack/);
  });

  it("throws on a bare name without the '@' prefix", () => {
    expect(() => resolveAddress('voice')).toThrow(/must start with '@'/);
  });
});

describe('ensureInbox', () => {
  it('creates the well-known inbox once and returns the SAME session on the second call', async () => {
    const first = await ensureInbox(pool, 'voice');
    expect(first.origin).toBe('voice');
    expect(first.externalRef).toBe('inbox');
    expect(first.tier).toBe('owner');

    const second = await ensureInbox(pool, 'voice');
    expect(second.id).toBe(first.id);

    // The found path logs NO resume marker: exactly one session_opened event exists.
    const opened = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM session_events
       WHERE session_id = $1 AND kind = 'session_opened'`,
      [first.id],
    );
    expect(Number(opened.rows[0]!.count)).toBe(1);
  });
});

describe('sendMessage', () => {
  it("delivers to '@whatsapp' inbox with body/from_harness/hop_count 0 and NO lease involved", async () => {
    const event = await sendMessage(pool, {
      to: '@whatsapp',
      fromHarness: 'cron',
      body: 'nightly digest ready',
    });

    const inbox = await ensureInbox(pool, 'whatsapp');
    expect(event.sessionId).toBe(inbox.id);
    expect(event.kind).toBe('message');
    expect(event.payload['body']).toBe('nightly digest ready');
    expect(event.payload['from_harness']).toBe('cron');
    expect(event.payload['hop_count']).toBe(0);
    // Actor falls back to the harness identity when there is no sending session.
    expect(event.actor).toBe('harness:cron');

    // Message lane is ungated — no lease row was ever created.
    const leases = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM session_leases',
    );
    expect(Number(leases.rows[0]!.count)).toBe(0);
  });

  it('uses the sending session id as actor and records from_session when fromSession is set', async () => {
    const { session: sender } = await openSession(pool, { origin: 'cron', externalRef: 'task-1' });

    const event = await sendMessage(pool, {
      to: '@voice',
      fromHarness: 'cron',
      fromSession: sender.id,
      body: 'routine done',
    });

    expect(event.actor).toBe(sender.id);
    expect(event.payload['from_session']).toBe(sender.id);
  });

  it('delivers to a concrete session id', async () => {
    const { session } = await openSession(pool, { origin: 'voice', externalRef: 'chat-1' });

    const event = await sendMessage(pool, {
      to: session.id,
      fromHarness: 'whatsapp',
      body: 'direct to session',
    });

    expect(event.sessionId).toBe(session.id);
    expect(event.kind).toBe('message');
  });

  it('throws SessionNotFoundError for an unknown concrete session id', async () => {
    await expect(
      sendMessage(pool, {
        to: '00000000-0000-0000-0000-000000000000',
        fromHarness: 'voice',
        body: 'hello?',
      }),
    ).rejects.toBeInstanceOf(SessionNotFoundError);
  });

  it('clips a body longer than MAX_MESSAGE_BODY and appends an ellipsis', async () => {
    const event = await sendMessage(pool, {
      to: '@voice',
      fromHarness: 'cron',
      body: 'x'.repeat(MAX_MESSAGE_BODY + 500),
    });

    const body = event.payload['body'] as string;
    expect(body.length).toBe(MAX_MESSAGE_BODY + 1);
    expect(body.endsWith('…')).toBe(true);
    expect(body.startsWith('xxx')).toBe(true);
  });

  it('rejects a whitespace-only body', async () => {
    await expect(
      sendMessage(pool, { to: '@voice', fromHarness: 'cron', body: '   \n\t ' }),
    ).rejects.toThrow(/empty|whitespace/);
  });

  it('rejects hopCount 5 with HopCountExceededError (appendEvent cap fires); hopCount 4 succeeds', async () => {
    await expect(
      sendMessage(pool, { to: '@voice', fromHarness: 'cron', body: 'looping', hopCount: 5 }),
    ).rejects.toBeInstanceOf(HopCountExceededError);

    const atCap = await sendMessage(pool, {
      to: '@voice',
      fromHarness: 'cron',
      body: 'last hop',
      hopCount: 4,
    });
    expect(atCap.payload['hop_count']).toBe(4);
  });

  it('threads replies: reply_to points at the parent message, hop_count carried', async () => {
    const m1 = await sendMessage(pool, { to: '@voice', fromHarness: 'cron', body: 'question' });

    const m2 = await sendMessage(pool, {
      to: '@cron',
      fromHarness: 'voice',
      body: 'answer',
      replyTo: m1.id,
      hopCount: 1,
    });

    expect(m2.payload['reply_to']).toBe(m1.id);
    expect(m2.payload['hop_count']).toBe(1);
  });
});

describe('sendSignal', () => {
  it("lands a signal event with payload.signal 'cancel'", async () => {
    const event = await sendSignal(pool, { to: '@voice', fromHarness: 'cron', signal: 'cancel' });

    expect(event.kind).toBe('signal');
    expect(event.payload['signal']).toBe('cancel');
    expect(event.payload['from_harness']).toBe('cron');
    expect(event.actor).toBe('harness:cron');
  });

  it('rejects an invalid signal name at runtime', async () => {
    await expect(
      sendSignal(pool, {
        to: '@voice',
        fromHarness: 'cron',
        // Runtime data won't respect the compile-time union — simulate a bad transport value.
        signal: 'explode' as never,
      }),
    ).rejects.toThrow(/unknown signal 'explode'/);
  });
});

describe('listInbox', () => {
  it('returns only message events (signals excluded), oldest first', async () => {
    const m1 = await sendMessage(pool, { to: '@slack', fromHarness: 'cron', body: 'first' });
    await sendSignal(pool, { to: '@slack', fromHarness: 'voice', signal: 'ping' });
    const m2 = await sendMessage(pool, { to: '@slack', fromHarness: 'voice', body: 'second' });

    const view = await listInbox(pool, 'slack');

    expect(view.session.externalRef).toBe('inbox');
    expect(view.messages.map((m) => m.id)).toEqual([m1.id, m2.id]);
    expect(view.messages.every((m) => m.kind === 'message')).toBe(true);
  });

  it('respects afterSeq as a cursor', async () => {
    const m1 = await sendMessage(pool, { to: '@slack', fromHarness: 'cron', body: 'first' });
    const m2 = await sendMessage(pool, { to: '@slack', fromHarness: 'cron', body: 'second' });

    const view = await listInbox(pool, 'slack', { afterSeq: m1.seq });

    expect(view.messages.map((m) => m.id)).toEqual([m2.id]);
  });
});
