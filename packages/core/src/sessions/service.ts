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
  Harness,
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
  InboxView,
  OpenSessionOptions,
  ReleaseLeaseInput,
  RenewLeaseInput,
  SendMessageInput,
  SendSignalInput,
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

  // Messaging (message/signal lanes — ungated by leases) -----------------------------------
  sendMessage(input: SendMessageInput): Promise<SessionEvent>;
  sendSignal(input: SendSignalInput): Promise<SessionEvent>;
  ensureInbox(harness: Harness): Promise<Session>;
  listInbox(harness: Harness, opts?: { afterSeq?: string; limit?: number }): Promise<InboxView>;

  // Reads (via store) ----------------------------------------------------------------------
  getLease(sessionId: Uuid): Promise<SessionLease | undefined>;
  listSessions(opts?: ListSessionsOptions): Promise<Session[]>;
  getSession(id: Uuid): Promise<Session | undefined>;
  /**
   * Look up a session by its harness-native identity WITHOUT opening it — unlike `open`,
   * this never logs a `session_opened` resume marker. Adapters use it for find-or-open.
   */
  getSessionByRef(origin: Harness, externalRef: string): Promise<Session | undefined>;
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

    sendMessage: (input) => ops.sendMessage(pool, input),
    sendSignal: (input) => ops.sendSignal(pool, input),
    ensureInbox: (harness) => ops.ensureInbox(pool, harness),
    listInbox: (harness, opts) => ops.listInbox(pool, harness, opts),

    getLease: (sessionId) => store.getLease(pool, sessionId),
    listSessions: (opts) => store.listSessions(pool, opts),
    getSession: (id) => store.findSessionById(pool, id),
    getSessionByRef: (origin, externalRef) =>
      store.findSessionByExternalRef(pool, origin, externalRef),
    listEvents: (sessionId, opts) => store.listSessionEvents(pool, sessionId, opts),
    listEventsSince: (afterSeq, opts) => store.listEventsSince(pool, afterSeq, opts),
  };
}
