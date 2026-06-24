import { toVectorLiteral } from '../embeddings/vector-literal.js';
import type { Queryable } from '../db/pool.js';
import type { Uuid } from '../schema/index.js';

export interface VectorHit {
  observationId: Uuid;
  entityId: Uuid;
  /** Cosine distance (0 = identical). Lower is closer. */
  distance: number;
}

export interface VectorSearchOptions {
  limit?: number;
  types?: string[];
  asOf?: Date;
}

/**
 * Vector similarity over observation embeddings (pgvector, cosine via `<=>`, HNSW-backed).
 * Joins to live entities and applies the same type/point-in-time filters as keyword search.
 * Returns the nearest observations; an empty query embedding yields none.
 */
export async function vectorSearchObservations(
  q: Queryable,
  embedding: readonly number[],
  opts: VectorSearchOptions = {},
): Promise<VectorHit[]> {
  if (embedding.length === 0) {
    return [];
  }
  const values: unknown[] = [toVectorLiteral(embedding)];
  const conditions = ['o.embedding IS NOT NULL', 'o.deleted_at IS NULL', 'e.deleted_at IS NULL'];
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

  const res = await q.query<{ id: string; entity_id: string; distance: number }>(
    `SELECT o.id, o.entity_id, (o.embedding <=> $1::vector) AS distance
     FROM observations o
     JOIN entities e ON e.id = o.entity_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY o.embedding <=> $1::vector
     LIMIT ${limitParam}`,
    values,
  );
  return res.rows.map((r) => ({
    observationId: r.id,
    entityId: r.entity_id,
    distance: r.distance,
  }));
}
