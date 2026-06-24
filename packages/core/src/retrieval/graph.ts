import type { Queryable } from '../db/pool.js';
import type { Uuid } from '../schema/index.js';

export interface GraphNode {
  entityId: Uuid;
  /** 0 = a seed; ≥1 = hops away from the nearest seed. */
  depth: number;
}

/**
 * Expand outward from seed entities along active relations using a recursive CTE,
 * up to `maxHops` (1–2). Returns each reachable live entity with its minimum hop
 * distance (seeds included at depth 0). Traversal is undirected (follows edges either
 * way) and skips soft-deleted entities/relations; the depth bound prevents cycles.
 */
export async function expandGraph(
  q: Queryable,
  seedIds: readonly Uuid[],
  opts: { maxHops?: number; predicates?: string[] } = {},
): Promise<GraphNode[]> {
  if (seedIds.length === 0) {
    return [];
  }
  const maxHops = Math.min(Math.max(opts.maxHops ?? 1, 1), 2);
  const values: unknown[] = [seedIds, maxHops];
  let predicateFilter = '';
  if (opts.predicates && opts.predicates.length > 0) {
    values.push(opts.predicates);
    predicateFilter = `AND r.predicate = ANY($${values.length}::text[])`;
  }

  const res = await q.query<{ entity_id: string; depth: number }>(
    `WITH RECURSIVE walk(entity_id, depth) AS (
       SELECT id, 0
       FROM entities
       WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
       UNION
       SELECT CASE WHEN r.from_entity = w.entity_id THEN r.to_entity ELSE r.from_entity END,
              w.depth + 1
       FROM walk w
       JOIN relations r
         ON (r.from_entity = w.entity_id OR r.to_entity = w.entity_id)
        AND r.deleted_at IS NULL
        ${predicateFilter}
       JOIN entities e
         ON e.id = (CASE WHEN r.from_entity = w.entity_id THEN r.to_entity ELSE r.from_entity END)
        AND e.deleted_at IS NULL
       WHERE w.depth < $2
     )
     SELECT entity_id, min(depth) AS depth
     FROM walk
     GROUP BY entity_id`,
    values,
  );
  return res.rows.map((r) => ({ entityId: r.entity_id, depth: r.depth }));
}
