/**
 * Chronicle cron adapter — maps scheduled-routine runs (dream, briefing, session-reaper, …)
 * into turn events and ingests them via the shared kit.
 *
 * Frozen design decision: ONE session per routine NAME (`externalRef` = task name), and each
 * run = one turn (started → summary message → completed) — so "what has the briefing routine
 * been doing" is a single tailable session across runs.
 *
 * The adapter records runs post-hoc: a routine reports its outcome once, at the end. Live
 * turn-by-turn streaming from inside a running routine is activation-time work, out of scope.
 *
 * BUILD-DON'T-ACTIVATE: exercised against synthetic data only until the encryption-at-rest
 * gate is cleared — nothing here wires into the live scheduler.
 */
import type { AdapterEvent, IngestResult } from './adapter.js';
import { clipText, ingestBatch } from './adapter.js';
import type { SessionService } from '../service.js';

/** One completed run of a scheduled routine, as the scheduler reports it. */
export interface CronRun {
  /** Stable routine name, e.g. 'tars-briefing' — becomes the session external_ref. */
  taskName: string;
  /** Unique id of this run (timestamp/uuid from the scheduler). */
  runId: string;
  startedAt: Date;
  finishedAt?: Date;
  /** One-paragraph outcome summary the routine reports. */
  summary: string;
  status: 'ok' | 'error' | 'skipped';
}

export const CRON_HOLDER = 'cron:adapter';

/** Map one run to its turn events (started → summary message → completed). */
export function cronRunToEvents(run: CronRun): AdapterEvent[] {
  const events: AdapterEvent[] = [
    {
      harness: 'cron',
      actor: 'system',
      kind: 'turn_started',
      payload: { runId: run.runId, startedAt: run.startedAt.toISOString() },
    },
  ];

  const summary = run.summary.trim();
  if (summary !== '') {
    events.push({
      harness: 'cron',
      actor: 'assistant',
      kind: 'turn_message',
      payload: { text: clipText(summary), runId: run.runId },
    });
  }

  events.push({
    harness: 'cron',
    actor: 'system',
    kind: 'turn_completed',
    payload: {
      runId: run.runId,
      status: run.status,
      ...(run.finishedAt ? { finishedAt: run.finishedAt.toISOString() } : {}),
    },
  });

  return events;
}

/** Record a completed run into the routine's session (origin 'cron', tier 'owner'). */
export async function recordCronRun(service: SessionService, run: CronRun): Promise<IngestResult> {
  return ingestBatch(
    service,
    {
      origin: 'cron',
      externalRef: run.taskName,
      title: run.taskName,
      // Routines run as the owner's own automation: tier is always 'owner'.
      tier: 'owner',
    },
    CRON_HOLDER,
    cronRunToEvents(run),
  );
}
