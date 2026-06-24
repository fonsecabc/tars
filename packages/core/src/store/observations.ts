import type { Queryable } from '../db/pool.js';
import type { CreateObservationInput, Observation, Source, Uuid } from '../schema/index.js';
import { EMBEDDING_DIMENSIONS } from '../embeddings/provider.js';
import { toVectorLiteral } from '../embeddings/vector-literal.js';
import { affected, maybeOne, one } from './util.js';

type ObservationRow = {
  id: string;
  entity_id: string;
  text: string;
  valid_from: Date;
  valid_to: Date | null;
  recorded_at: Date;
  source: Source;
  confidence: number;
  tags: string[];
  corrects_id: string | null;
  deleted_at: Date | null;
};

// Note: `embedding` is intentionally not selected (large; populated in Phase 4).
const COLUMNS =
  'id, entity_id, text, valid_from, valid_to, recorded_at, source, confidence, tags, corrects_id, deleted_at';

function mapObservation(r: ObservationRow): Observation {
  return {
    id: r.id,
    entityId: r.entity_id,
    text: r.text,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    recordedAt: r.recorded_at,
    source: r.source,
    confidence: r.confidence,
    tags: r.tags,
    correctsId: r.corrects_id,
    deletedAt: r.deleted_at,
  };
}

export interface InsertObservationExtra {
  correctsId?: Uuid | null;
  /** Overrides `input.source`; falls back to 'manual'. */
  source?: Source;
}

export async function insertObservation(
  q: Queryable,
  entityId: Uuid,
  input: CreateObservationInput,
  extra: InsertObservationExtra = {},
): Promise<Observation> {
  const source = extra.source ?? input.source ?? 'manual';
  const res = await q.query<ObservationRow>(
    `INSERT INTO observations
       (entity_id, text, valid_from, valid_to, source, confidence, tags, corrects_id)
     VALUES ($1, $2, COALESCE($3, now()), $4, $5, $6, $7, $8)
     RETURNING ${COLUMNS}`,
    [
      entityId,
      input.text,
      input.validFrom ?? null,
      input.validTo ?? null,
      source,
      input.confidence ?? 1,
      input.tags ?? [],
      extra.correctsId ?? null,
    ],
  );
  return mapObservation(one(res));
}

export async function getObservationById(
  q: Queryable,
  id: Uuid,
  opts: { includeDeleted?: boolean } = {},
): Promise<Observation | undefined> {
  const res = await q.query<ObservationRow>(
    `SELECT ${COLUMNS} FROM observations
     WHERE id = $1 ${opts.includeDeleted ? '' : 'AND deleted_at IS NULL'}`,
    [id],
  );
  const row = maybeOne(res);
  return row ? mapObservation(row) : undefined;
}

export interface ListObservationsOptions {
  includeDeleted?: boolean;
  /** Only facts valid at this instant (valid_from <= asOf < valid_to or open). */
  asOf?: Date;
  /** Only currently-open facts (valid_to IS NULL). */
  onlyCurrent?: boolean;
  limit?: number;
}

export async function listObservationsByEntity(
  q: Queryable,
  entityId: Uuid,
  opts: ListObservationsOptions = {},
): Promise<Observation[]> {
  const conditions = ['entity_id = $1'];
  const values: unknown[] = [entityId];
  if (!opts.includeDeleted) {
    conditions.push('deleted_at IS NULL');
  }
  if (opts.onlyCurrent) {
    conditions.push('valid_to IS NULL');
  }
  if (opts.asOf !== undefined) {
    values.push(opts.asOf);
    const p = `$${values.length}`;
    conditions.push(`valid_from <= ${p} AND (valid_to IS NULL OR valid_to > ${p})`);
  }
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  values.push(limit);
  const limitParam = `$${values.length}`;
  const res = await q.query<ObservationRow>(
    `SELECT ${COLUMNS} FROM observations
     WHERE ${conditions.join(' AND ')}
     ORDER BY valid_from DESC, recorded_at DESC
     LIMIT ${limitParam}`,
    values,
  );
  return res.rows.map(mapObservation);
}

/** Close an open observation's validity interval at `validTo`. */
export async function closeObservation(q: Queryable, id: Uuid, validTo: Date): Promise<boolean> {
  const res = await q.query(
    `UPDATE observations SET valid_to = $2
     WHERE id = $1 AND valid_to IS NULL AND deleted_at IS NULL`,
    [id, validTo],
  );
  return affected(res);
}

export async function softDeleteObservation(q: Queryable, id: Uuid): Promise<boolean> {
  const res = await q.query(
    'UPDATE observations SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  return affected(res);
}

export async function hardDeleteObservation(q: Queryable, id: Uuid): Promise<boolean> {
  const res = await q.query('DELETE FROM observations WHERE id = $1', [id]);
  return affected(res);
}

export interface TimelineItem {
  observation: Observation;
  entity: { id: Uuid; type: string; name: string };
}

export interface ListTimelineOptions {
  entityId?: Uuid;
  from?: Date;
  to?: Date;
  types?: string[];
  limit?: number;
}

/** Observations across the graph in reverse time order (by valid_from), with their entity. */
export async function listTimeline(
  q: Queryable,
  opts: ListTimelineOptions = {},
): Promise<TimelineItem[]> {
  const values: unknown[] = [];
  const conditions = ['o.deleted_at IS NULL', 'e.deleted_at IS NULL'];
  if (opts.entityId !== undefined) {
    values.push(opts.entityId);
    conditions.push(`o.entity_id = $${values.length}`);
  }
  if (opts.types && opts.types.length > 0) {
    values.push(opts.types);
    conditions.push(`e.type = ANY($${values.length}::text[])`);
  }
  if (opts.from) {
    values.push(opts.from);
    conditions.push(`o.valid_from >= $${values.length}`);
  }
  if (opts.to) {
    values.push(opts.to);
    conditions.push(`o.valid_from <= $${values.length}`);
  }
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  values.push(limit);
  const limitParam = `$${values.length}`;

  const res = await q.query<ObservationRow & { e_id: string; e_type: string; e_name: string }>(
    `SELECT o.id, o.entity_id, o.text, o.valid_from, o.valid_to, o.recorded_at, o.source,
            o.confidence, o.tags, o.corrects_id, o.deleted_at,
            e.id AS e_id, e.type AS e_type, e.name AS e_name
     FROM observations o
     JOIN entities e ON e.id = o.entity_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY o.valid_from DESC, o.recorded_at DESC
     LIMIT ${limitParam}`,
    values,
  );
  return res.rows.map((r) => ({
    observation: mapObservation(r),
    entity: { id: r.e_id, type: r.e_type, name: r.e_name },
  }));
}

// --- Embeddings (Phase 4) ---------------------------------------------------

/** Set (or clear, with null) an observation's embedding vector. Validates dimensionality. */
export async function updateObservationEmbedding(
  q: Queryable,
  id: Uuid,
  embedding: readonly number[] | null,
): Promise<boolean> {
  if (embedding && embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding has ${embedding.length} dimensions; the column expects ${EMBEDDING_DIMENSIONS}`,
    );
  }
  const res = await q.query('UPDATE observations SET embedding = $2::vector WHERE id = $1', [
    id,
    embedding ? toVectorLiteral(embedding) : null,
  ]);
  return affected(res);
}

export interface ObservationText {
  id: Uuid;
  text: string;
}

/** Live, undeleted observations that still lack an embedding — the backfill work-list. */
export async function listObservationsNeedingEmbedding(
  q: Queryable,
  opts: { limit?: number } = {},
): Promise<ObservationText[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
  const res = await q.query<{ id: string; text: string }>(
    `SELECT id, text FROM observations
     WHERE embedding IS NULL AND deleted_at IS NULL
     ORDER BY recorded_at ASC
     LIMIT $1`,
    [limit],
  );
  return res.rows.map((r) => ({ id: r.id, text: r.text }));
}
