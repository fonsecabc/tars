/**
 * Chronicle — the FROZEN contract for cross-harness shared sessions (WU-0).
 *
 * Architecture: the `session_events` log is the source of truth (event sourcing + CQRS);
 * `sessions` and `session_leases` are rebuildable operational projections / live state.
 * Every builder in Batches 1–5 imports the interfaces and store fn signatures from this
 * file. It is deliberately dependency-light (only `Queryable` + `Uuid` types) so it can be
 * imported from store/, ops/, server, adapters, and the graph projector alike.
 *
 * bigint columns (`seq`, `epoch`, `last_seq`) surface as STRINGS in node-pg, matching the
 * existing `AuditEntry.id` convention — never coerce them to `number`.
 */

import type { Queryable } from '../db/pool.js';
import type { Uuid } from '../schema/common.js';

// --- Harnesses --------------------------------------------------------------

/**
 * A TARS harness that can own/produce session activity. Closed at the TS contract (widening
 * it later is non-breaking); the DB `harness`/`origin` columns stay plain `text` so the
 * vocabulary can grow without a migration.
 */
export type Harness = 'voice' | 'whatsapp' | 'cron' | 'cc-shadow' | 'slack';

// --- Event kinds + lanes ----------------------------------------------------

/**
 * TURN lane: single-writer, lease-gated. The conversational/work spine of a session.
 * `session_opened` is the genesis event (it may itself claim the lease); `checkpoint` marks
 * a snapshot boundary that bounds replay cost.
 */
export const TURN_LANE_KINDS = [
  'session_opened',
  'session_closed',
  'turn_started',
  'turn_message',
  'turn_completed',
  'tool_call',
  'tool_result',
  'checkpoint',
] as const;

/**
 * MESSAGE lane: append-by-any-authenticated-harness, NOT lease-gated, ordered purely by
 * Postgres append. `message` = inter-session agent-to-agent (payload carries
 * from_session/from_harness/body/reply_to/hop_count ≤ 4); `signal` = control channel
 * (ping/pause/cancel/wake). Token-delta streaming is intentionally NOT a kind here — deltas
 * live on an ephemeral live channel that never persists.
 */
export const MESSAGE_LANE_KINDS = ['message', 'signal'] as const;

export type TurnLaneKind = (typeof TURN_LANE_KINDS)[number];
export type MessageLaneKind = (typeof MESSAGE_LANE_KINDS)[number];
export type EventKind = TurnLaneKind | MessageLaneKind;

/** Every kind, in lane order. Mirrors the CHECK constraint in the migration. */
export const EVENT_KINDS = [...TURN_LANE_KINDS, ...MESSAGE_LANE_KINDS] as const;

export type Lane = 'turn' | 'message';

/** Runtime lane membership — the append op gates by lane, not by a blanket lease check. */
export const TURN_LANE: ReadonlySet<EventKind> = new Set(TURN_LANE_KINDS);
export const MESSAGE_LANE: ReadonlySet<EventKind> = new Set(MESSAGE_LANE_KINDS);

/** Which lane a kind belongs to. */
export function laneOf(kind: EventKind): Lane {
  return MESSAGE_LANE.has(kind) ? 'message' : 'turn';
}

// --- Row shapes (camelCase projections of the tables) -----------------------

/** One immutable entry in the append-only log. `seq`/`ts` are assigned by the DB on insert. */
export interface SessionEvent {
  id: Uuid;
  /** Global monotonic order + replay cursor. bigint serialized as string. */
  seq: string;
  sessionId: Uuid;
  ts: Date;
  harness: Harness;
  /** 'user' | 'assistant' | 'tool' | 'system', or a session/harness id for message-lane events. */
  actor: string;
  kind: EventKind;
  payload: Record<string, unknown>;
}

export type SessionStatus = 'active' | 'idle' | 'closed' | 'archived';
export type SessionTier = 'owner' | 'trusted' | 'guest';

/** The operational session projection (fast read-model off the log). */
export interface Session {
  id: Uuid;
  origin: Harness;
  /** Harness-native identity (CC sessionId, cron task id, 'inbox', …), or null. */
  externalRef: string | null;
  title: string | null;
  status: SessionStatus;
  tier: SessionTier;
  /** Watermark: seq of the latest folded event. bigint as string, or null before any event. */
  lastSeq: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/** The single-writer write token for a session's turn lane. */
export interface SessionLease {
  sessionId: Uuid;
  holder: string;
  harness: Harness;
  /** Fencing token, bumped on every take-over. bigint as string. */
  epoch: string;
  acquiredAt: Date;
  renewedAt: Date;
  expiresAt: Date;
}

// --- Input shapes (what the store fns accept) -------------------------------

export interface AppendEventInput {
  sessionId: Uuid;
  harness: Harness;
  actor: string;
  kind: EventKind;
  payload?: Record<string, unknown>;
}

export interface ListEventsOptions {
  /** Only events with seq strictly greater than this cursor (bigint as string). */
  afterSeq?: string;
  limit?: number;
}

export interface OpenSessionInput {
  /** Explicit id (must equal the session_id used on its events). Omit to let the DB mint one. */
  id?: Uuid;
  origin: Harness;
  externalRef?: string | null;
  title?: string | null;
  tier?: SessionTier;
  metadata?: Record<string, unknown>;
}

export interface ListSessionsOptions {
  status?: SessionStatus;
  origin?: Harness;
  tier?: SessionTier;
  limit?: number;
}

export interface UpdateSessionFields {
  title?: string | null;
  status?: SessionStatus;
  tier?: SessionTier;
  /** Advance the projection watermark. bigint as string. */
  lastSeq?: string;
  metadata?: Record<string, unknown>;
}

export interface ClaimLeaseInput {
  sessionId: Uuid;
  holder: string;
  harness: Harness;
  /** Absolute TTL deadline (ops layer owns the clock/policy that computes it). */
  expiresAt: Date;
}

export interface TakeOverInput {
  sessionId: Uuid;
  holder: string;
  harness: Harness;
  expiresAt: Date;
  reason?: string;
}

// --- Store fn signatures (the Batch 1 API every later batch imports) --------
//
// Batch 1 builders implement functions matching these exact signatures, e.g.
//   export const insertSessionEvent: InsertSessionEvent = async (q, input) => { … }
// or an equivalent `export async function insertSessionEvent(q, input) { … }`.

// store/session-events.ts
export type InsertSessionEvent = (q: Queryable, input: AppendEventInput) => Promise<SessionEvent>;
export type ListSessionEvents = (
  q: Queryable,
  sessionId: Uuid,
  opts?: ListEventsOptions,
) => Promise<SessionEvent[]>;
/** Global tail: events across all sessions with seq > afterSeq, ascending (the SSE cursor). */
export type ListEventsSince = (
  q: Queryable,
  afterSeq: string,
  opts?: { limit?: number },
) => Promise<SessionEvent[]>;
export type GetSessionEventById = (q: Queryable, id: Uuid) => Promise<SessionEvent | undefined>;

// store/sessions.ts
export type FindOrCreateSession = (q: Queryable, input: OpenSessionInput) => Promise<Session>;
export type FindSessionById = (q: Queryable, id: Uuid) => Promise<Session | undefined>;
export type FindSessionByExternalRef = (
  q: Queryable,
  origin: Harness,
  externalRef: string,
) => Promise<Session | undefined>;
export type ListSessions = (q: Queryable, opts?: ListSessionsOptions) => Promise<Session[]>;
export type UpdateSessionProjection = (
  q: Queryable,
  id: Uuid,
  fields: UpdateSessionFields,
) => Promise<Session | undefined>;

// store/leases.ts
export type GetLease = (q: Queryable, sessionId: Uuid) => Promise<SessionLease | undefined>;
/** Claim a free/expired lease. Resolves to undefined if a live lease is held by someone else. */
export type ClaimLease = (
  q: Queryable,
  input: ClaimLeaseInput,
) => Promise<SessionLease | undefined>;
export type RenewLease = (
  q: Queryable,
  sessionId: Uuid,
  holder: string,
  expiresAt: Date,
) => Promise<SessionLease | undefined>;
/** Force-transfer the lease to a new holder, bumping the fencing epoch. */
export type TakeOverLease = (q: Queryable, input: TakeOverInput) => Promise<SessionLease>;
export type ReleaseLease = (q: Queryable, sessionId: Uuid, holder: string) => Promise<boolean>;
