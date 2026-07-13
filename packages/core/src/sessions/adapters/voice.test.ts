import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { MAX_TEXT_LENGTH } from './adapter.js';
import { VOICE_HOLDER, ingestVoiceTurns, voiceTurnsToEvents } from './voice.js';
import { closeTestPool, getTestPool } from '../../test-helpers/index.js';
import { createSessionService } from '../service.js';
import type { VoiceTurn } from './voice.js';

const pool = getTestPool();
const service = createSessionService(pool);

/** Session tables are outside the shared resetDb's scope — clear them explicitly. */
beforeEach(async () => {
  await pool.query('TRUNCATE session_events, sessions, session_leases RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await closeTestPool();
});

describe('voiceTurnsToEvents (pure)', () => {
  it('maps roles to actors and stamps kind/harness', () => {
    const turns: VoiceTurn[] = [
      { role: 'user', text: 'hello from user A' },
      { role: 'assistant', text: 'reply from assistant' },
    ];

    const events = voiceTurnsToEvents(turns);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      harness: 'voice',
      actor: 'user',
      kind: 'turn_message',
      payload: { text: 'hello from user A' },
    });
    expect(events[1]).toMatchObject({
      harness: 'voice',
      actor: 'assistant',
      kind: 'turn_message',
      payload: { text: 'reply from assistant' },
    });
  });

  it('clips over-long text and appends the ellipsis', () => {
    const long = 'x'.repeat(MAX_TEXT_LENGTH + 500);

    const events = voiceTurnsToEvents([{ role: 'user', text: long }]);

    const text = events[0]!.payload!['text'] as string;
    expect(text).toHaveLength(MAX_TEXT_LENGTH + 1);
    expect(text.endsWith('…')).toBe(true);
  });

  it('stamps ISO `at` when provided and carries `extra` into the payload', () => {
    const at = new Date('2026-01-02T03:04:05.000Z');

    const events = voiceTurnsToEvents([
      { role: 'user', text: 'timed turn', at, extra: { confidence: 0.9, wake: true } },
      { role: 'assistant', text: 'untimed turn' },
    ]);

    expect(events[0]!.payload).toEqual({
      text: 'timed turn',
      at: '2026-01-02T03:04:05.000Z',
      confidence: 0.9,
      wake: true,
    });
    expect(events[1]!.payload).toEqual({ text: 'untimed turn' });
  });

  it('drops whitespace-only turns and trims the rest', () => {
    const events = voiceTurnsToEvents([
      { role: 'user', text: '   ' },
      { role: 'assistant', text: '\n\t' },
      { role: 'user', text: '  kept turn  ' },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({ text: 'kept turn' });
  });
});

describe('ingestVoiceTurns', () => {
  it('creates the session (origin voice, externalRef, tier owner) and appends one turn_message per turn', async () => {
    const result = await ingestVoiceTurns(
      service,
      'conv-1',
      [
        { role: 'user', text: 'hello from user A' },
        { role: 'assistant', text: 'hello back from assistant' },
      ],
      { title: 'synthetic conversation' },
    );

    expect(result.sessionCreated).toBe(true);
    expect(result.session.origin).toBe('voice');
    expect(result.session.externalRef).toBe('conv-1');
    expect(result.session.tier).toBe('owner');
    expect(result.session.title).toBe('synthetic conversation');
    expect(result.appended).toHaveLength(2);

    const events = await service.listEvents(result.session.id);
    expect(events.map((e) => e.kind)).toEqual(['session_opened', 'turn_message', 'turn_message']);
    expect(events[1]!.actor).toBe('user');
    expect(events[1]!.payload).toEqual({ text: 'hello from user A' });
    expect(events[2]!.actor).toBe('assistant');
    expect(events[2]!.payload).toEqual({ text: 'hello back from assistant' });
  });

  it('reuses the session on a second ingest into the same conversationId', async () => {
    const first = await ingestVoiceTurns(service, 'conv-2', [
      { role: 'user', text: 'first batch turn' },
    ]);
    const second = await ingestVoiceTurns(service, 'conv-2', [
      { role: 'assistant', text: 'second batch turn' },
    ]);

    expect(first.sessionCreated).toBe(true);
    expect(second.sessionCreated).toBe(false);
    expect(second.session.id).toBe(first.session.id);

    const events = await service.listEvents(first.session.id);
    // Exactly one genesis event — re-ingest must NOT log a second session_opened.
    expect(events.filter((e) => e.kind === 'session_opened')).toHaveLength(1);
    // New turns land after the old ones.
    expect(events.map((e) => e.kind)).toEqual(['session_opened', 'turn_message', 'turn_message']);
    expect(events[1]!.payload).toEqual({ text: 'first batch turn' });
    expect(events[2]!.payload).toEqual({ text: 'second batch turn' });
  });

  it('releases the lease after ingest', async () => {
    const result = await ingestVoiceTurns(service, 'conv-3', [
      { role: 'user', text: 'lease check turn' },
    ]);

    expect(VOICE_HOLDER).toBe('voice:adapter');
    expect(await service.getLease(result.session.id)).toBeUndefined();
  });
});
