import { describe, expect, it } from 'vitest';

import type { EventKind, SessionEvent } from '../types.js';
import { describeMessage, dispatchMessages, type HarnessDeliverer } from './deliver.js';

// Pure suite — no DB. Synthetic events + a fake deliverer exercise the dispatch
// bookkeeping (message-only filter, keep-going-on-failure, consecutive-prefix watermark)
// and the defensive sender/body extraction.

const SESSION_ID = '00000000-0000-0000-0000-000000000001';

function makeEvent(
  seq: string,
  kind: EventKind,
  payload: Record<string, unknown> = {},
): SessionEvent {
  return {
    id: `00000000-0000-0000-0000-0000000000${seq.padStart(2, '0')}`,
    seq,
    sessionId: SESSION_ID,
    ts: new Date('2026-07-13T00:00:00Z'),
    harness: 'cron',
    actor: 'session:sender',
    kind,
    payload,
  };
}

function makeMessage(seq: string, payload: Record<string, unknown> = {}): SessionEvent {
  return makeEvent(seq, 'message', { body: `msg ${seq}`, from_harness: 'voice', ...payload });
}

/** Fake deliverer that records delivered seqs and throws on the configured ones. */
function makeDeliverer(failOnSeqs: string[] = []): {
  deliverer: HarnessDeliverer;
  deliveredSeqs: string[];
} {
  const deliveredSeqs: string[] = [];
  const deliverer: HarnessDeliverer = {
    harness: 'whatsapp',
    deliver(message: SessionEvent): Promise<void> {
      if (failOnSeqs.includes(message.seq)) {
        return Promise.reject(new Error(`boom on ${message.seq}`));
      }
      deliveredSeqs.push(message.seq);
      return Promise.resolve();
    },
  };
  return { deliverer, deliveredSeqs };
}

describe('dispatchMessages', () => {
  it('delivers only message events, oldest-first; signals/turn events are skipped', async () => {
    const { deliverer, deliveredSeqs } = makeDeliverer();
    const events = [
      makeMessage('1'),
      makeEvent('2', 'signal', { signal: 'ping' }),
      makeMessage('3'),
      makeEvent('4', 'turn_message', { text: 'not for delivery' }),
      makeMessage('5'),
    ];

    const result = await dispatchMessages(deliverer, events);

    expect(deliveredSeqs).toEqual(['1', '3', '5']);
    expect(result.delivered).toBe(3);
    expect(result.skipped).toBe(2);
    expect(result.failures).toEqual([]);
    expect(result.watermark).toBe('5');
  });

  it('failure on the second of three: rest still attempted, watermark stays at the prefix', async () => {
    const { deliverer, deliveredSeqs } = makeDeliverer(['2']);
    const events = [makeMessage('1'), makeMessage('2'), makeMessage('3')];

    const result = await dispatchMessages(deliverer, events);

    expect(deliveredSeqs).toEqual(['1', '3']);
    expect(result.delivered).toBe(2);
    expect(result.failures).toEqual([{ seq: '2', error: 'Error: boom on 2' }]);
    expect(result.watermark).toBe('1'); // consecutive prefix only — '3' does not advance it
  });

  it('failure on the first: watermark null, remaining messages still attempted', async () => {
    const { deliverer, deliveredSeqs } = makeDeliverer(['1']);
    const events = [makeMessage('1'), makeMessage('2'), makeMessage('3')];

    const result = await dispatchMessages(deliverer, events);

    expect(deliveredSeqs).toEqual(['2', '3']);
    expect(result.delivered).toBe(2);
    expect(result.failures).toEqual([{ seq: '1', error: 'Error: boom on 1' }]);
    expect(result.watermark).toBeNull();
  });

  it('all-success: watermark is the last seq and failures is empty', async () => {
    const { deliverer } = makeDeliverer();
    const events = [makeMessage('1'), makeMessage('2'), makeMessage('3')];

    const result = await dispatchMessages(deliverer, events);

    expect(result).toEqual({ delivered: 3, skipped: 0, failures: [], watermark: '3' });
  });

  it('empty input yields the zero result', async () => {
    const { deliverer } = makeDeliverer();

    const result = await dispatchMessages(deliverer, []);

    expect(result).toEqual({ delivered: 0, skipped: 0, failures: [], watermark: null });
  });

  it('deliver() throwing never escapes dispatchMessages', async () => {
    const explosive: HarnessDeliverer = {
      harness: 'voice',
      deliver(): Promise<void> {
        throw new Error('synchronous kaboom'); // thrown, not rejected
      },
    };
    const events = [makeMessage('1'), makeMessage('2')];

    await expect(dispatchMessages(explosive, events)).resolves.toEqual({
      delivered: 0,
      skipped: 0,
      failures: [
        { seq: '1', error: 'Error: synchronous kaboom' },
        { seq: '2', error: 'Error: synchronous kaboom' },
      ],
      watermark: null,
    });
  });
});

describe('describeMessage', () => {
  it('prefers from_session over from_harness and actor', () => {
    const event = makeMessage('1', {
      from_session: 'session-abc',
      from_harness: 'voice',
      body: 'hello',
    });

    expect(describeMessage(event)).toEqual({ from: 'session-abc', body: 'hello' });
  });

  it('falls back to harness:<from_harness> when from_session is absent', () => {
    const event = makeMessage('1', { from_harness: 'cron', body: 'wake report' });

    expect(describeMessage(event)).toEqual({ from: 'harness:cron', body: 'wake report' });
  });

  it('falls back to the event actor when both sender fields are missing or mis-typed', () => {
    const event = makeEvent('1', 'message', { from_session: 42, from_harness: null, body: 'x' });

    expect(describeMessage(event).from).toBe('session:sender');
  });

  it('stringifies non-string bodies and empty-strings a missing body', () => {
    const numeric = makeEvent('1', 'message', { from_harness: 'voice', body: 123 });
    expect(describeMessage(numeric).body).toBe('123');

    const missing = makeEvent('2', 'message', { from_harness: 'voice' });
    expect(describeMessage(missing).body).toBe('');
  });

  it('includes replyTo only when payload.reply_to is a string', () => {
    const withReply = makeMessage('1', { reply_to: '42' });
    expect(describeMessage(withReply).replyTo).toBe('42');

    const misTyped = makeMessage('2', { reply_to: 42 });
    expect('replyTo' in describeMessage(misTyped)).toBe(false);
  });

  it('tolerates a payload with none of the expected fields', () => {
    const bare = makeEvent('1', 'message', {});

    expect(describeMessage(bare)).toEqual({ from: 'session:sender', body: '' });
  });
});
