import type { Uuid } from '../../schema/common.js';
import { maybeOne, one } from '../../store/util.js';
import type {
  FindOrCreateSession,
  FindSessionByExternalRef,
  FindSessionById,
  Harness,
  ListSessions,
  ListSessionsOptions,
  Session,
  SessionStatus,
  SessionTier,
  UpdateSessionFields,
  UpdateSessionProjection,
} from '../types.js';

type SessionRow = {
  id: string;
  origin: string;
  external_ref: string | null;
  title: string | null;
  status: string;
  tier: string;
  /** bigint — node-pg surfaces it as a string; never coerce to number. */
  last_seq: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

const COLUMNS =
  'id, origin, external_ref, title, status, tier, last_seq, metadata, created_at, updated_at';

function mapSession(r: SessionRow): Session {
  return {
    id: r.id,
    // The origin/status/tier vocabularies are adapter-controlled (CHECK-constrained or
    // code-known at every write path), so a plain assertion is the accepted mapping.
    origin: r.origin as Harness,
    externalRef: r.external_ref,
    title: r.title,
    status: r.status as SessionStatus,
    tier: r.tier as SessionTier,
    lastSeq: r.last_seq,
    metadata: r.metadata,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Race-safe find-or-create keyed on harness-native identity (origin, external_ref).
 *
 * With a non-null externalRef, a single INSERT … ON CONFLICT targets the partial unique
 * index (its WHERE clause must be restated so Postgres matches the arbiter); the no-op-ish
 * DO UPDATE makes RETURNING yield the existing row on conflict. With no externalRef there
 * is no dedup identity, so it is a plain INSERT.
 */
export const findOrCreateSession: FindOrCreateSession = async (q, input) => {
  const externalRef = input.externalRef ?? null;
  const columns: string[] = [];
  const params: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown): void => {
    columns.push(column);
    values.push(value);
    params.push(`$${values.length}`);
  };
  if (input.id !== undefined) {
    add('id', input.id);
  }
  add('origin', input.origin);
  add('external_ref', externalRef);
  add('title', input.title ?? null);
  add('tier', input.tier ?? 'owner');
  add('metadata', input.metadata ?? {});

  const onConflict =
    externalRef !== null
      ? `ON CONFLICT (origin, external_ref) WHERE external_ref IS NOT NULL
         DO UPDATE SET updated_at = now()`
      : '';

  const res = await q.query<SessionRow>(
    `INSERT INTO sessions (${columns.join(', ')})
     VALUES (${params.join(', ')})
     ${onConflict}
     RETURNING ${COLUMNS}`,
    values,
  );
  return mapSession(one(res));
};

export const findSessionById: FindSessionById = async (q, id) => {
  const res = await q.query<SessionRow>(`SELECT ${COLUMNS} FROM sessions WHERE id = $1`, [id]);
  const row = maybeOne(res);
  return row ? mapSession(row) : undefined;
};

export const findSessionByExternalRef: FindSessionByExternalRef = async (
  q,
  origin,
  externalRef,
) => {
  const res = await q.query<SessionRow>(
    `SELECT ${COLUMNS} FROM sessions
     WHERE origin = $1 AND external_ref = $2`,
    [origin, externalRef],
  );
  const row = maybeOne(res);
  return row ? mapSession(row) : undefined;
};

export const listSessions: ListSessions = async (q, opts: ListSessionsOptions = {}) => {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (opts.status !== undefined) {
    values.push(opts.status);
    conditions.push(`status = $${values.length}`);
  }
  if (opts.origin !== undefined) {
    values.push(opts.origin);
    conditions.push(`origin = $${values.length}`);
  }
  if (opts.tier !== undefined) {
    values.push(opts.tier);
    conditions.push(`tier = $${values.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  values.push(limit);
  const limitParam = `$${values.length}`;

  const res = await q.query<SessionRow>(
    `SELECT ${COLUMNS} FROM sessions ${where}
     ORDER BY updated_at DESC
     LIMIT ${limitParam}`,
    values,
  );
  return res.rows.map(mapSession);
};

export const updateSessionProjection: UpdateSessionProjection = async (
  q,
  id: Uuid,
  fields: UpdateSessionFields,
) => {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (fields.title !== undefined) {
    values.push(fields.title);
    sets.push(`title = $${values.length}`);
  }
  if (fields.status !== undefined) {
    values.push(fields.status);
    sets.push(`status = $${values.length}`);
  }
  if (fields.tier !== undefined) {
    values.push(fields.tier);
    sets.push(`tier = $${values.length}`);
  }
  if (fields.lastSeq !== undefined) {
    values.push(fields.lastSeq);
    sets.push(`last_seq = $${values.length}::bigint`);
  }
  if (fields.metadata !== undefined) {
    values.push(fields.metadata);
    sets.push(`metadata = $${values.length}`);
  }
  if (sets.length === 0) {
    return findSessionById(q, id);
  }
  sets.push('updated_at = now()');
  values.push(id);
  const res = await q.query<SessionRow>(
    `UPDATE sessions SET ${sets.join(', ')}
     WHERE id = $${values.length}
     RETURNING ${COLUMNS}`,
    values,
  );
  const row = maybeOne(res);
  return row ? mapSession(row) : undefined;
};
