/**
 * Chronicle append op — the correctness-critical write path onto the `session_events` log.
 *
 * The turn lane is single-writer: turn-lane appends are gated on a held, live, non-fenced
 * lease. The message lane is ungated (append-by-any-authenticated-harness; tier gating lands
 * in a later batch). Every op here owns exactly ONE transaction, composes pure store fns, and
 * advances the `sessions` projection watermark best-effort — the event log stays source of
 * truth, so a missing projection row never fails the append.
 *
 * NOTE ON AUDIT: session_events IS the append-only ledger. We deliberately do NOT write an
 * audit_log row per turn/tool/message event — at open-mic voice volume that would bloat the
 * audit trail with no added provenance. Only control-plane genesis (openSession) is audited.
 */
import type { Pool } from 'pg';

import { withTransaction } from '../../db/tx.js';
import { appendAudit } from '../../store/audit.js';
import {
  HopCountExceededError,
  LeaseConflictError,
  LeaseExpiredError,
  LeaseRequiredError,
  StaleLeaseError,
} from '../errors.js';
import type { Uuid } from '../../schema/common.js';
import * as store from '../store/index.js';
import { laneOf, MAX_MESSAGE_HOPS } from '../types.js';
import type {
  AppendEventInput,
  Harness,
  OpenSessionInput,
  Session,
  SessionEvent,
} from '../types.js';

export interface AppendOptions {
  /** Required for lease-gated turn-lane events (all turn kinds except session_opened). */
  holder?: string;
  /** The fencing token the caller believes it holds. If the live lease has moved past it, the write is rejected. */
  expectedEpoch?: string;
}

/**
 * Append one event to a session's log, enforcing the turn-lane single-writer contract.
 *
 * Turn-lane events (except the genesis `session_opened`) must present a holder that matches a
 * live, non-fenced lease. Message-lane events skip the lease gate entirely.
 */
export async function appendEvent(
  pool: Pool,
  input: AppendEventInput,
  opts?: AppendOptions,
): Promise<SessionEvent> {
  return withTransaction(pool, async (tx) => {
    const lane = laneOf(input.kind);

    // Turn-lane gating. `session_opened` is the genesis event and is exempt (it may itself be
    // what claims the lease). Message-lane events skip ALL of this.
    if (lane === 'turn' && input.kind !== 'session_opened') {
      const lease = await store.getLease(tx, input.sessionId);
      if (!opts?.holder) {
        throw new LeaseRequiredError(input.sessionId);
      }
      if (!lease) {
        throw new LeaseRequiredError(input.sessionId);
      }
      if (lease.expiresAt.getTime() <= Date.now()) {
        throw new LeaseExpiredError(input.sessionId);
      }
      if (lease.holder !== opts.holder) {
        throw new LeaseConflictError(input.sessionId, lease.holder, opts.holder);
      }
      if (opts.expectedEpoch !== undefined && lease.epoch !== opts.expectedEpoch) {
        throw new StaleLeaseError(input.sessionId, opts.expectedEpoch, lease.epoch);
      }
    }

    // Loop cap — enforced HERE (the single choke point) so every append path is covered,
    // whether it comes through the messaging ops or the raw HTTP /events route. An A→B→C…
    // agent-to-agent chain dies after MAX_MESSAGE_HOPS.
    if (input.kind === 'message') {
      const rawHops = input.payload?.['hop_count'];
      const hopCount = typeof rawHops === 'number' ? rawHops : 0;
      if (hopCount > MAX_MESSAGE_HOPS) {
        throw new HopCountExceededError(input.sessionId, hopCount, MAX_MESSAGE_HOPS);
      }
    }

    const event = await store.insertSessionEvent(tx, input);

    // Advance the projection watermark best-effort — do NOT throw if the projection row is
    // missing. The event log is the source of truth; openSession is what creates projections.
    // Status is a TURN-LANE concern only: the ungated message lane delivers data (inter-session
    // `message`, control `signal`) and must never mutate lifecycle state — otherwise a guest
    // signal or agent-to-agent message could silently resurrect a closed/archived session with
    // no lease held. `lastSeq` still advances on message events (seq is a global watermark).
    const statusUpdate: { status?: 'active' | 'closed' } =
      lane === 'turn' ? { status: input.kind === 'session_closed' ? 'closed' : 'active' } : {};
    await store.updateSessionProjection(tx, input.sessionId, {
      lastSeq: event.seq,
      ...statusUpdate,
    });

    // No per-event audit row: session_events IS the append-only ledger (see file header).
    return event;
  });
}

export interface OpenSessionOptions {
  actor?: string;
  payload?: Record<string, unknown>;
}

/**
 * Genesis: find-or-create the session ROW and log a `session_opened` event.
 *
 * openSession is intentionally NOT event-idempotent — each call logs a `session_opened` (an
 * open/resume marker). Adapters call it once per session lifecycle; the session ROW itself is
 * find-or-created (race-safe) so no duplicate row appears even across repeated opens.
 */
export async function openSession(
  pool: Pool,
  input: OpenSessionInput,
  opts?: OpenSessionOptions,
): Promise<{ session: Session; event: SessionEvent }> {
  return withTransaction(pool, async (tx) => {
    const session = await store.findOrCreateSession(tx, input);

    const event = await store.insertSessionEvent(tx, {
      sessionId: session.id,
      harness: session.origin,
      actor: opts?.actor ?? 'system',
      kind: 'session_opened',
      payload: {
        origin: session.origin,
        externalRef: session.externalRef,
        title: session.title,
        tier: session.tier,
        ...(opts?.payload ?? {}),
      },
    });

    await store.updateSessionProjection(tx, session.id, { lastSeq: event.seq });

    await appendAudit(tx, {
      action: 'session.open',
      targetKind: 'session',
      targetId: session.id,
      source: 'chat',
      detail: { origin: session.origin, externalRef: session.externalRef },
    });

    return { session, event };
  });
}

export interface CheckpointInput {
  sessionId: Uuid;
  harness: Harness;
  holder: string;
  expectedEpoch?: string;
  actor?: string;
  payload?: Record<string, unknown>;
}

/**
 * Log a `checkpoint` snapshot marker. Checkpoint is turn-lane, so it goes through the full
 * lease gate via appendEvent. No separate audit — it lives in the event log, queryable by
 * kind = 'checkpoint'.
 */
export async function checkpoint(pool: Pool, input: CheckpointInput): Promise<SessionEvent> {
  return appendEvent(
    pool,
    {
      sessionId: input.sessionId,
      harness: input.harness,
      actor: input.actor ?? 'system',
      kind: 'checkpoint',
      payload: input.payload,
    },
    { holder: input.holder, expectedEpoch: input.expectedEpoch },
  );
}
