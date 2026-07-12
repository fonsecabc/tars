import type { Queryable } from '../../db/pool.js';
import type { Uuid } from '../../schema/common.js';
import { maybeOne, one } from '../../store/util.js';
import type {
  AppendEventInput,
  EventKind,
  Harness,
  ListEventsOptions,
  SessionEvent,
} from '../types.js';

type SessionEventRow = {
  id: string;
  /** bigint — surfaces as a string from node-pg. */
  seq: string;
  session_id: string;
  ts: Date;
  harness: string;
  actor: string;
  kind: string;
  payload: Record<string, unknown>;
};

const COLUMNS = 'id, seq, session_id, ts, harness, actor, kind, payload';

function mapSessionEvent(r: SessionEventRow): SessionEvent {
  return {
    id: r.id,
    seq: r.seq,
    sessionId: r.session_id,
    ts: r.ts,
    // The DB columns are plain text; the vocabulary is adapter-controlled, so a
    // straight assertion onto the contract unions is the accepted mapping here.
    harness: r.harness as Harness,
    actor: r.actor,
    kind: r.kind as EventKind,
    payload: r.payload,
  };
}

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 200, 1), 1000);
}

/** Append one immutable event to the log. `id`/`seq`/`ts` are DB-assigned. */
export async function insertSessionEvent(
  q: Queryable,
  input: AppendEventInput,
): Promise<SessionEvent> {
  const res = await q.query<SessionEventRow>(
    `INSERT INTO session_events (session_id, harness, actor, kind, payload)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${COLUMNS}`,
    [input.sessionId, input.harness, input.actor, input.kind, input.payload ?? {}],
  );
  return mapSessionEvent(one(res));
}

/** One session's events in replay order (seq ASC), optionally after a cursor. */
export async function listSessionEvents(
  q: Queryable,
  sessionId: Uuid,
  opts: ListEventsOptions = {},
): Promise<SessionEvent[]> {
  const conditions = ['session_id = $1'];
  const values: unknown[] = [sessionId];
  if (opts.afterSeq !== undefined) {
    values.push(opts.afterSeq);
    conditions.push(`seq > $${values.length}::bigint`);
  }
  values.push(clampLimit(opts.limit));
  const limitParam = `$${values.length}`;
  const res = await q.query<SessionEventRow>(
    `SELECT ${COLUMNS} FROM session_events
     WHERE ${conditions.join(' AND ')}
     ORDER BY seq ASC
     LIMIT ${limitParam}`,
    values,
  );
  return res.rows.map(mapSessionEvent);
}

/** Global tail across ALL sessions: events with seq > afterSeq, ascending (the SSE cursor). */
export async function listEventsSince(
  q: Queryable,
  afterSeq: string,
  opts: { limit?: number } = {},
): Promise<SessionEvent[]> {
  const res = await q.query<SessionEventRow>(
    `SELECT ${COLUMNS} FROM session_events
     WHERE seq > $1::bigint
     ORDER BY seq ASC
     LIMIT $2`,
    [afterSeq, clampLimit(opts.limit)],
  );
  return res.rows.map(mapSessionEvent);
}

export async function getSessionEventById(
  q: Queryable,
  id: Uuid,
): Promise<SessionEvent | undefined> {
  const res = await q.query<SessionEventRow>(
    `SELECT ${COLUMNS} FROM session_events WHERE id = $1`,
    [id],
  );
  const row = maybeOne(res);
  return row ? mapSessionEvent(row) : undefined;
}
