/**
 * Chronicle graph projector — folds a session's append-only event log into the brain
 * knowledge-graph as a `session` entity with transcript-derived observations.
 *
 * The `session_events` log is the source of truth; the graph is a REBUILDABLE read-model.
 * This projector REPLACES the old ad-hoc capture path (tars-sessions.mjs / reaper / Dream),
 * so it must be idempotent: the CALLER (Dream/reaper/worker) tracks a per-session `sinceSeq`
 * watermark and passes it back in, and we only fold events with seq > sinceSeq. Re-running
 * with the last returned `projectedThroughSeq` writes nothing new and creates no second entity
 * (find-or-create matches on exact type + case-insensitive name).
 *
 * v1 scope: the Session entity + its transcript observations only. Graph-wiring the session to
 * the people / projects / orgs it mentions (entity resolution + extraction) is a SEPARATE
 * concern, deliberately DEFERRED — no relations are created here.
 */
import type { Pool } from 'pg';

import type { CreateObservationInput } from '../schema/index.js';
import type { Memory } from '../memory/facade.js';
import { SessionNotFoundError } from './errors.js';
import * as store from './store/index.js';
import type { SessionEvent, Uuid } from './types.js';

export interface ProjectionResult {
  entityId: Uuid;
  eventsProjected: number;
  /** The seq of the last event folded in (or the input sinceSeq if nothing new). bigint as string. */
  projectedThroughSeq: string;
  observationsWritten: number;
}

export interface ProjectOptions {
  /** Only project events with seq > sinceSeq. The CALLER tracks this watermark (Dream/reaper/worker). */
  sinceSeq?: string;
}

/** Max transcript text kept per turn observation — keeps observations atomic and bounded. */
const TURN_TEXT_LIMIT = 240;

/** Confidence stamped on projected observations (derived, not directly asserted by the user). */
const PROJECTED_CONFIDENCE = 0.9;

/**
 * Fold a session's NEW events (seq > opts.sinceSeq) into its graph `session` entity.
 *
 * @throws SessionNotFoundError when `sessionId` has no projection row.
 */
export async function projectSession(
  memory: Memory,
  pool: Pool,
  sessionId: Uuid,
  opts?: ProjectOptions,
): Promise<ProjectionResult> {
  const session = await store.findSessionById(pool, sessionId);
  if (!session) {
    throw new SessionNotFoundError(sessionId);
  }

  const events = await store.listSessionEvents(pool, sessionId, { afterSeq: opts?.sinceSeq });

  // Twin-proof, title-independent key: the graph entity name is stable across renames so a
  // later title edit never forks a second `session` entity.
  const name = `${session.origin}:${session.externalRef ?? sessionId}`;
  const metadata: Record<string, unknown> = {
    sessionId,
    origin: session.origin,
    externalRef: session.externalRef,
  };

  // Nothing new: still ensure the entity exists (find-or-create with no observations) so a
  // freshly-opened session is representable in the graph, but write no observations.
  if (events.length === 0) {
    const result = await memory.remember({
      entity: { type: 'session', name, metadata },
      observations: [],
      source: 'extraction',
    });
    return {
      entityId: result.entity.id,
      eventsProjected: 0,
      projectedThroughSeq: opts?.sinceSeq ?? '0',
      observationsWritten: 0,
    };
  }

  const observations = buildObservations(events, session.externalRef);

  // One remember call: find-or-create the entity AND write the batch of observations together,
  // so the entity is created exactly once.
  const result = await memory.remember({
    entity: { type: 'session', name, metadata },
    observations,
    source: 'extraction',
  });

  return {
    entityId: result.entity.id,
    eventsProjected: events.length,
    projectedThroughSeq: events[events.length - 1]!.seq,
    observationsWritten: observations.length,
  };
}

/**
 * Turn the NEW events into atomic, dated observations. Each observation is dated to its event's
 * `ts`, tagged `['session', <kind>]`, at PROJECTED_CONFIDENCE.
 *
 * Only the transcript-bearing kinds are projected in v1. `turn_started` / `turn_completed` /
 * `tool_result` / `checkpoint` / `message` / `signal` carry no standalone narrative value here
 * and are intentionally ignored.
 */
function buildObservations(
  events: SessionEvent[],
  externalRef: string | null,
): CreateObservationInput[] {
  const observations: CreateObservationInput[] = [];

  for (const event of events) {
    const text = observationText(event, externalRef);
    if (text === undefined) {
      continue;
    }
    observations.push({
      text,
      validFrom: event.ts,
      confidence: PROJECTED_CONFIDENCE,
      tags: ['session', event.kind],
    });
  }

  return observations;
}

/** The observation text for one event, or `undefined` to skip it. */
function observationText(event: SessionEvent, externalRef: string | null): string | undefined {
  const payload = event.payload;
  switch (event.kind) {
    case 'session_opened':
      return `Session opened via ${event.harness}${externalRef ? ` (ref ${externalRef})` : ''}`;
    case 'turn_message': {
      const raw = String(payload.text ?? payload.body ?? '');
      if (raw.length === 0) {
        return undefined;
      }
      return `${event.actor}: ${raw.slice(0, TURN_TEXT_LIMIT)}`;
    }
    case 'tool_call':
      return `Tool call: ${String(payload.name ?? 'unknown')}`;
    case 'session_closed':
      return 'Session closed';
    default:
      return undefined;
  }
}
