import type { Queryable } from '../db/pool.js';
import type { Relation, Uuid } from '../schema/index.js';
import { affected, maybeOne, one } from './util.js';

type RelationRow = {
  id: string;
  from_entity: string;
  to_entity: string;
  predicate: string;
  valid_from: Date;
  valid_to: Date | null;
  recorded_at: Date;
  metadata: Record<string, unknown>;
  deleted_at: Date | null;
};

const COLUMNS =
  'id, from_entity, to_entity, predicate, valid_from, valid_to, recorded_at, metadata, deleted_at';

function mapRelation(r: RelationRow): Relation {
  return {
    id: r.id,
    fromEntity: r.from_entity,
    toEntity: r.to_entity,
    predicate: r.predicate,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    recordedAt: r.recorded_at,
    metadata: r.metadata,
    deletedAt: r.deleted_at,
  };
}

export interface InsertRelationParams {
  fromEntity: Uuid;
  toEntity: Uuid;
  predicate: string;
  validFrom?: Date;
  validTo?: Date | null;
  metadata?: Record<string, unknown>;
}

export async function insertRelation(
  q: Queryable,
  params: InsertRelationParams,
): Promise<Relation> {
  const res = await q.query<RelationRow>(
    `INSERT INTO relations (from_entity, to_entity, predicate, valid_from, valid_to, metadata)
     VALUES ($1, $2, $3, COALESCE($4, now()), $5, $6)
     RETURNING ${COLUMNS}`,
    [
      params.fromEntity,
      params.toEntity,
      params.predicate,
      params.validFrom ?? null,
      params.validTo ?? null,
      params.metadata ?? {},
    ],
  );
  return mapRelation(one(res));
}

export async function getRelationById(
  q: Queryable,
  id: Uuid,
  opts: { includeDeleted?: boolean } = {},
): Promise<Relation | undefined> {
  const res = await q.query<RelationRow>(
    `SELECT ${COLUMNS} FROM relations
     WHERE id = $1 ${opts.includeDeleted ? '' : 'AND deleted_at IS NULL'}`,
    [id],
  );
  const row = maybeOne(res);
  return row ? mapRelation(row) : undefined;
}

export type RelationDirection = 'out' | 'in' | 'both';

export interface ListRelationsOptions {
  direction?: RelationDirection;
  predicate?: string;
  includeDeleted?: boolean;
  limit?: number;
}

export async function listRelationsByEntity(
  q: Queryable,
  entityId: Uuid,
  opts: ListRelationsOptions = {},
): Promise<Relation[]> {
  const direction = opts.direction ?? 'both';
  const values: unknown[] = [entityId];
  const conditions: string[] = [];
  if (direction === 'out') {
    conditions.push('from_entity = $1');
  } else if (direction === 'in') {
    conditions.push('to_entity = $1');
  } else {
    conditions.push('(from_entity = $1 OR to_entity = $1)');
  }
  if (!opts.includeDeleted) {
    conditions.push('deleted_at IS NULL');
  }
  if (opts.predicate !== undefined) {
    values.push(opts.predicate);
    conditions.push(`predicate = $${values.length}`);
  }
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  values.push(limit);
  const limitParam = `$${values.length}`;
  const res = await q.query<RelationRow>(
    `SELECT ${COLUMNS} FROM relations
     WHERE ${conditions.join(' AND ')}
     ORDER BY recorded_at DESC
     LIMIT ${limitParam}`,
    values,
  );
  return res.rows.map(mapRelation);
}

export interface RelationsAmongOptions {
  predicates?: string[];
  asOf?: Date;
}

/** Active relations whose BOTH endpoints are in the given set — the connecting edges. */
export async function listRelationsAmong(
  q: Queryable,
  entityIds: readonly Uuid[],
  opts: RelationsAmongOptions = {},
): Promise<Relation[]> {
  if (entityIds.length === 0) {
    return [];
  }
  const values: unknown[] = [entityIds];
  const conditions = [
    'deleted_at IS NULL',
    'from_entity = ANY($1::uuid[])',
    'to_entity = ANY($1::uuid[])',
  ];
  if (opts.predicates && opts.predicates.length > 0) {
    values.push(opts.predicates);
    conditions.push(`predicate = ANY($${values.length}::text[])`);
  }
  if (opts.asOf) {
    values.push(opts.asOf);
    const p = `$${values.length}`;
    conditions.push(`valid_from <= ${p} AND (valid_to IS NULL OR valid_to > ${p})`);
  }
  const res = await q.query<RelationRow>(
    `SELECT ${COLUMNS} FROM relations
     WHERE ${conditions.join(' AND ')}
     ORDER BY recorded_at DESC`,
    values,
  );
  return res.rows.map(mapRelation);
}

export async function softDeleteRelation(q: Queryable, id: Uuid): Promise<boolean> {
  const res = await q.query(
    'UPDATE relations SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  return affected(res);
}

export async function hardDeleteRelation(q: Queryable, id: Uuid): Promise<boolean> {
  const res = await q.query('DELETE FROM relations WHERE id = $1', [id]);
  return affected(res);
}
