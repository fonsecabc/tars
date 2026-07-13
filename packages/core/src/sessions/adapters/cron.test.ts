import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { MAX_TEXT_LENGTH } from './adapter.js';
import { CRON_HOLDER, cronRunToEvents, recordCronRun } from './cron.js';
import { closeTestPool, getTestPool } from '../../test-helpers/index.js';
import { createSessionService } from '../service.js';
import type { CronRun } from './cron.js';

const pool = getTestPool();
const service = createSessionService(pool);

/** Session tables are outside the shared resetDb's scope — clear them explicitly. */
beforeEach(async () => {
  await pool.query('TRUNCATE session_events, sessions, session_leases RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await closeTestPool();
});

function syntheticRun(overrides: Partial<CronRun> = {}): CronRun {
  return {
    taskName: 'routine-x',
    runId: 'run-1',
    startedAt: new Date('2026-01-02T03:04:05.000Z'),
    finishedAt: new Date('2026-01-02T03:05:06.000Z'),
    summary: 'synthetic run summary',
    status: 'ok',
    ...overrides,
  };
}

describe('cronRunToEvents (pure)', () => {
  it('maps a run to started → message → completed with correct kinds, actors, and payloads', () => {
    const events = cronRunToEvents(syntheticRun());

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({
      harness: 'cron',
      actor: 'system',
      kind: 'turn_started',
      payload: { runId: 'run-1', startedAt: '2026-01-02T03:04:05.000Z' },
    });
    expect(events[1]).toEqual({
      harness: 'cron',
      actor: 'assistant',
      kind: 'turn_message',
      payload: { text: 'synthetic run summary', runId: 'run-1' },
    });
    expect(events[2]).toEqual({
      harness: 'cron',
      actor: 'system',
      kind: 'turn_completed',
      payload: { runId: 'run-1', status: 'ok', finishedAt: '2026-01-02T03:05:06.000Z' },
    });
  });

  it('threads the runId and status through, and omits finishedAt when the run has none', () => {
    const events = cronRunToEvents(
      syntheticRun({ runId: 'run-2', status: 'error', finishedAt: undefined }),
    );

    expect(events.map((e) => e.payload!['runId'])).toEqual(['run-2', 'run-2', 'run-2']);
    expect(events[2]!.payload).toEqual({ runId: 'run-2', status: 'error' });
    expect(events[2]!.payload).not.toHaveProperty('finishedAt');
  });

  it('trims the summary and clips over-long text', () => {
    const long = 'x'.repeat(MAX_TEXT_LENGTH + 500);

    const trimmed = cronRunToEvents(syntheticRun({ summary: '  padded summary  ' }));
    expect(trimmed[1]!.payload!['text']).toBe('padded summary');

    const clipped = cronRunToEvents(syntheticRun({ summary: long }));
    const text = clipped[1]!.payload!['text'] as string;
    expect(text).toHaveLength(MAX_TEXT_LENGTH + 1);
    expect(text.endsWith('…')).toBe(true);
  });

  it('drops ONLY the message event on an empty summary — started and completed remain', () => {
    const events = cronRunToEvents(syntheticRun({ summary: '   \n\t' }));

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.kind)).toEqual(['turn_started', 'turn_completed']);
    expect(events.map((e) => e.actor)).toEqual(['system', 'system']);
  });
});

describe('recordCronRun', () => {
  it('creates ONE session per taskName (origin cron, externalRef = taskName) and appends 3 events', async () => {
    const result = await recordCronRun(service, syntheticRun());

    expect(result.sessionCreated).toBe(true);
    expect(result.session.origin).toBe('cron');
    expect(result.session.externalRef).toBe('routine-x');
    expect(result.session.title).toBe('routine-x');
    expect(result.session.tier).toBe('owner');
    expect(result.appended).toHaveLength(3);

    const events = await service.listEvents(result.session.id);
    expect(events.map((e) => e.kind)).toEqual([
      'session_opened',
      'turn_started',
      'turn_message',
      'turn_completed',
    ]);
  });

  it('reuses the SAME session for a second run and appends its events after the first', async () => {
    const first = await recordCronRun(service, syntheticRun({ runId: 'run-a' }));
    const second = await recordCronRun(
      service,
      syntheticRun({
        runId: 'run-b',
        startedAt: new Date('2026-01-03T03:04:05.000Z'),
        finishedAt: new Date('2026-01-03T03:05:06.000Z'),
        summary: 'second synthetic run summary',
        status: 'skipped',
      }),
    );

    expect(first.sessionCreated).toBe(true);
    expect(second.sessionCreated).toBe(false);
    expect(second.session.id).toBe(first.session.id);

    const events = await service.listEvents(first.session.id);
    // Exactly one genesis event — re-recording must NOT log a second session_opened.
    expect(events.filter((e) => e.kind === 'session_opened')).toHaveLength(1);
    // 6 turn-lane events (+1 session_opened), in seq order: run-a's turn then run-b's.
    expect(events.map((e) => e.kind)).toEqual([
      'session_opened',
      'turn_started',
      'turn_message',
      'turn_completed',
      'turn_started',
      'turn_message',
      'turn_completed',
    ]);
    const seqs = events.map((e) => BigInt(e.seq));
    expect([...seqs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(seqs);
    // Each run's runId lands in its own payloads.
    expect(events.slice(1, 4).map((e) => e.payload['runId'])).toEqual(['run-a', 'run-a', 'run-a']);
    expect(events.slice(4, 7).map((e) => e.payload['runId'])).toEqual(['run-b', 'run-b', 'run-b']);
    expect(events[6]!.payload['status']).toBe('skipped');
  });

  it('releases the lease after each record', async () => {
    const first = await recordCronRun(service, syntheticRun({ runId: 'run-a' }));
    expect(await service.getLease(first.session.id)).toBeUndefined();

    const second = await recordCronRun(service, syntheticRun({ runId: 'run-b' }));
    expect(CRON_HOLDER).toBe('cron:adapter');
    expect(await service.getLease(second.session.id)).toBeUndefined();
  });
});
