import type { Queryable } from '../db/pool.js';
import type { Uuid } from '../schema/index.js';

export interface ObservationHit {
  observationId: Uuid;
  entityId: Uuid;
  rank: number;
}

export interface KeywordObservationOptions {
  limit?: number;
  types?: string[];
  asOf?: Date;
}

/**
 * Full-text search over observation text (`tsvector`, english config). Joins to live
 * entities and applies type/point-in-time filters. Ranked by ts_rank.
 */
export async function keywordSearchObservations(
  q: Queryable,
  query: string,
  opts: KeywordObservationOptions = {},
): Promise<ObservationHit[]> {
  const values: unknown[] = [query];
  const conditions = [
    'o.deleted_at IS NULL',
    'e.deleted_at IS NULL',
    "o.search_tsv @@ websearch_to_tsquery('english', $1)",
  ];
  if (opts.types && opts.types.length > 0) {
    values.push(opts.types);
    conditions.push(`e.type = ANY($${values.length}::text[])`);
  }
  if (opts.asOf) {
    values.push(opts.asOf);
    const p = `$${values.length}`;
    conditions.push(`o.valid_from <= ${p} AND (o.valid_to IS NULL OR o.valid_to > ${p})`);
  }
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  values.push(limit);
  const limitParam = `$${values.length}`;

  const res = await q.query<{ id: string; entity_id: string; rank: number }>(
    `SELECT o.id, o.entity_id,
            ts_rank(o.search_tsv, websearch_to_tsquery('english', $1)) AS rank
     FROM observations o
     JOIN entities e ON e.id = o.entity_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY rank DESC, o.recorded_at DESC
     LIMIT ${limitParam}`,
    values,
  );
  return res.rows.map((r) => ({ observationId: r.id, entityId: r.entity_id, rank: r.rank }));
}

export interface EntityHit {
  entityId: Uuid;
  rank: number;
}

export interface KeywordEntityOptions {
  limit?: number;
  types?: string[];
}

/**
 * Full-text + fuzzy search over entity names and aliases (`tsvector` simple config plus
 * pg_trgm similarity on the name). Ranked by the stronger of the two signals.
 */
export async function keywordSearchEntities(
  q: Queryable,
  query: string,
  opts: KeywordEntityOptions = {},
): Promise<EntityHit[]> {
  const values: unknown[] = [query];
  const conditions = [
    'e.deleted_at IS NULL',
    "(e.search_tsv @@ websearch_to_tsquery('simple', $1) OR e.name % $1)",
  ];
  if (opts.types && opts.types.length > 0) {
    values.push(opts.types);
    conditions.push(`e.type = ANY($${values.length}::text[])`);
  }
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  values.push(limit);
  const limitParam = `$${values.length}`;

  const res = await q.query<{ id: string; rank: number }>(
    `SELECT e.id,
            GREATEST(
              ts_rank(e.search_tsv, websearch_to_tsquery('simple', $1)),
              similarity(e.name, $1)
            ) AS rank
     FROM entities e
     WHERE ${conditions.join(' AND ')}
     ORDER BY rank DESC, e.created_at DESC
     LIMIT ${limitParam}`,
    values,
  );
  return res.rows.map((r) => ({ entityId: r.id, rank: r.rank }));
}

/**
 * Entities whose name OR one of whose aliases equals the query exactly (case-insensitive).
 * A high-precision signal: when someone types an entity's actual name/alias, that entity
 * should win outright rather than compete on equal footing with fuzzy/semantic neighbours.
 */
export async function exactEntityMatches(
  q: Queryable,
  query: string,
  opts: { types?: string[] } = {},
): Promise<Uuid[]> {
  const values: unknown[] = [query.trim()];
  const conditions = [
    'e.deleted_at IS NULL',
    '(lower(e.name) = lower($1) OR EXISTS (SELECT 1 FROM unnest(e.aliases) a WHERE lower(a) = lower($1)))',
  ];
  if (opts.types && opts.types.length > 0) {
    values.push(opts.types);
    conditions.push(`e.type = ANY($${values.length}::text[])`);
  }
  const res = await q.query<{ id: string }>(
    `SELECT e.id FROM entities e WHERE ${conditions.join(' AND ')}`,
    values,
  );
  return res.rows.map((r) => r.id);
}
