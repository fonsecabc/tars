import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { CC_SHADOW_HOLDER, ccTranscriptLinesToEvents, ingestCcTranscript } from './cc-shadow.js';
import { closeTestPool, getTestPool } from '../../test-helpers/index.js';
import { createSessionService } from '../service.js';

const pool = getTestPool();
const service = createSessionService(pool);

/** Session tables are outside the shared resetDb's scope — clear them explicitly. */
beforeEach(async () => {
  await pool.query('TRUNCATE session_events, sessions, session_leases RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await closeTestPool();
});

// --- Synthetic CC transcript lines (never read from a real ~/.claude transcript) ----------

const userStringLine = JSON.stringify({
  type: 'user',
  timestamp: '2026-01-02T03:04:05.000Z',
  message: { role: 'user', content: 'please run the checks' },
});

const assistantArrayLine = JSON.stringify({
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [
      { type: 'text', text: 'Running the checks now.' },
      {
        type: 'tool_use',
        id: 'toolu_01',
        name: 'Bash',
        input: { command: 'cat /etc/super-secret-config' },
      },
    ],
  },
});

const summaryLine = JSON.stringify({ type: 'summary', summary: 'a compacted summary' });

const malformedLine = 'this is {not valid json';

const emptyTextLine = JSON.stringify({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text: '   \n\t' }] },
});

describe('ccTranscriptLinesToEvents (pure)', () => {
  it('maps user string content to a turn_message with actor user', () => {
    const events = ccTranscriptLinesToEvents([userStringLine]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      harness: 'cc-shadow',
      actor: 'user',
      kind: 'turn_message',
      payload: { text: 'please run the checks' },
    });
  });

  it('maps assistant array content to text turn_messages plus name-only tool_calls', () => {
    const events = ccTranscriptLinesToEvents([assistantArrayLine]);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      harness: 'cc-shadow',
      actor: 'assistant',
      kind: 'turn_message',
      payload: { text: 'Running the checks now.' },
    });
    expect(events[1]).toMatchObject({
      harness: 'cc-shadow',
      actor: 'assistant',
      kind: 'tool_call',
    });
    // The shadow records THAT a tool ran, never its arguments — no input echoed.
    expect(events[1]!.payload).toEqual({ name: 'Bash' });
    expect(Object.keys(events[1]!.payload!)).toEqual(['name']);
  });

  it('skips a malformed non-JSON line without throwing', () => {
    expect(() => ccTranscriptLinesToEvents([malformedLine])).not.toThrow();
    expect(ccTranscriptLinesToEvents([malformedLine])).toEqual([]);
  });

  it('skips non-user/assistant entry types (summary)', () => {
    expect(ccTranscriptLinesToEvents([summaryLine])).toEqual([]);
  });

  it('skips whitespace-only text (string content and text blocks)', () => {
    const blankString = JSON.stringify({ type: 'user', message: { content: '   ' } });

    expect(ccTranscriptLinesToEvents([blankString, emptyTextLine])).toEqual([]);
  });

  it('skips tool_result and unknown block types', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_01', content: 'huge output' },
          { type: 'mystery_block', text: 'kept? no.' },
        ],
      },
    });

    expect(ccTranscriptLinesToEvents([line])).toEqual([]);
  });

  it('propagates a valid string timestamp to payload.at, and only then', () => {
    const untimed = JSON.stringify({
      type: 'user',
      timestamp: 12345, // mis-shaped: not a string → ignored
      message: { content: 'untimed entry' },
    });

    const events = ccTranscriptLinesToEvents([userStringLine, untimed]);

    expect(events[0]!.payload).toEqual({
      text: 'please run the checks',
      at: '2026-01-02T03:04:05.000Z',
    });
    expect(events[1]!.payload).toEqual({ text: 'untimed entry' });
  });

  it('processes a mixed batch, keeping only the parseable user/assistant events in order', () => {
    const events = ccTranscriptLinesToEvents([
      userStringLine,
      assistantArrayLine,
      summaryLine,
      malformedLine,
      emptyTextLine,
    ]);

    expect(events.map((e) => e.kind)).toEqual(['turn_message', 'turn_message', 'tool_call']);
  });
});

describe('ingestCcTranscript', () => {
  it('creates the shadow session (origin cc-shadow, externalRef, metadata.cwd) and lands events in order', async () => {
    const result = await ingestCcTranscript(
      service,
      'cc-session-1',
      [userStringLine, assistantArrayLine],
      { title: 'synthetic cc session', cwd: '/synthetic/project' },
    );

    expect(result.sessionCreated).toBe(true);
    expect(result.session.origin).toBe('cc-shadow');
    expect(result.session.externalRef).toBe('cc-session-1');
    expect(result.session.tier).toBe('owner');
    expect(result.session.title).toBe('synthetic cc session');
    expect(result.session.metadata).toEqual({ cwd: '/synthetic/project' });
    expect(result.appended).toHaveLength(3);

    const events = await service.listEvents(result.session.id);
    expect(events.map((e) => e.kind)).toEqual([
      'session_opened',
      'turn_message',
      'turn_message',
      'tool_call',
    ]);
    expect(events[1]!.actor).toBe('user');
    expect(events[2]!.actor).toBe('assistant');
    expect(events[3]!.payload).toEqual({ name: 'Bash' });
  });

  it('supports the caller-watermark model: ingesting only the new tail reuses the session and appends after', async () => {
    const lines = [userStringLine, assistantArrayLine, emptyTextLine, userStringLine];

    // The tailer's watermark said 2 lines were already ingested…
    const first = await ingestCcTranscript(service, 'cc-session-2', lines.slice(0, 2));
    // …so the next sweep hands over ONLY the tail.
    const second = await ingestCcTranscript(service, 'cc-session-2', lines.slice(2));

    expect(first.sessionCreated).toBe(true);
    expect(second.sessionCreated).toBe(false);
    expect(second.session.id).toBe(first.session.id);

    const events = await service.listEvents(first.session.id);
    // Exactly one genesis event — re-ingest must NOT log a second session_opened.
    expect(events.filter((e) => e.kind === 'session_opened')).toHaveLength(1);
    // Tail events land strictly after the first batch.
    expect(events.map((e) => e.kind)).toEqual([
      'session_opened',
      'turn_message', // first batch: user string line
      'turn_message', // first batch: assistant text block
      'tool_call', //    first batch: assistant tool_use block
      'turn_message', // tail: user string line (emptyTextLine yields nothing)
    ]);
    const seqs = events.map((e) => BigInt(e.seq));
    expect(seqs[4]!).toBeGreaterThan(seqs[3]!);
  });

  it('releases the lease after ingest', async () => {
    const result = await ingestCcTranscript(service, 'cc-session-3', [userStringLine]);

    expect(CC_SHADOW_HOLDER).toBe('cc-shadow:adapter');
    expect(await service.getLease(result.session.id)).toBeUndefined();
  });
});
