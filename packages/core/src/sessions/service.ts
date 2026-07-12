/**
 * Chronicle session service — the single bound interface the transport layer (server routes,
 * SSE tail) and adapters depend on, analogous to `Memory` for the graph. `createSessionService(pool)`
 * wires every session op/query to a connection pool so callers never touch `pg`, transactions,
 * or the store/ops split directly. Orchestrator-owned: it is the integration seam for Batch 3+.
 */
import type { Pool } from 'pg';

import * as ops from './ops/index.js';
import * as store from './store/index.js';
import type {
  ListEventsOptions,
  ListSessionsOptions,
  OpenSessionInput,
  Session,
  SessionEvent,
  SessionLease,
  Uuid,
} from './types.js';
import type {
  AcquireLeaseInput,
  AppendOptions,
  CheckpointInput,
  OpenSessionOptions,
  ReleaseLeaseInput,
  RenewLeaseInput,
  TakeOverLeaseInput,
} from './ops/index.js';
import type { AppendEventInput } from './types.js';

export interface SessionService {
  // Writes (transactional, via ops) --------------------------------------------------------
  open(
    input: OpenSessionInput,
    opts?: OpenSessionOptions,
  ): Promise<{ session: Session; event: SessionEvent }>;
  append(input: AppendEventInput, opts?: AppendOptions): Promise<SessionEvent>;
  checkpoint(input: CheckpointInput): Promise<SessionEvent>;
  acquireLease(input: AcquireLeaseInput): Promise<SessionLease>;
  renewLease(input: RenewLeaseInput): Promise<SessionLease>;
  takeOverLease(input: TakeOverLeaseInput): Promise<SessionLease>;
  releaseLease(input: ReleaseLeaseInput): Promise<boolean>;

  // Reads (via store) ----------------------------------------------------------------------
  getLease(sessionId: Uuid): Promise<SessionLease | undefined>;
  listSessions(opts?: ListSessionsOptions): Promise<Session[]>;
  getSession(id: Uuid): Promise<Session | undefined>;
  /** Per-session replay/tail: events with seq > opts.afterSeq, ascending. */
  listEvents(sessionId: Uuid, opts?: ListEventsOptions): Promise<SessionEvent[]>;
  /** Global tail across all sessions: events with seq > afterSeq (the SSE cursor). */
  listEventsSince(afterSeq: string, opts?: { limit?: number }): Promise<SessionEvent[]>;
}

/** Bind every session operation to a connection pool. */
export function createSessionService(pool: Pool): SessionService {
  return {
    open: (input, opts) => ops.openSession(pool, input, opts),
    append: (input, opts) => ops.appendEvent(pool, input, opts),
    checkpoint: (input) => ops.checkpoint(pool, input),
    acquireLease: (input) => ops.acquireLease(pool, input),
    renewLease: (input) => ops.renewLease(pool, input),
    takeOverLease: (input) => ops.takeOverLease(pool, input),
    releaseLease: (input) => ops.releaseLease(pool, input),

    getLease: (sessionId) => store.getLease(pool, sessionId),
    listSessions: (opts) => store.listSessions(pool, opts),
    getSession: (id) => store.findSessionById(pool, id),
    listEvents: (sessionId, opts) => store.listSessionEvents(pool, sessionId, opts),
    listEventsSince: (afterSeq, opts) => store.listEventsSince(pool, afterSeq, opts),
  };
}
