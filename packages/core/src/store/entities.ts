import type { Queryable } from '../db/pool.js';
import type { CreateEntityInput, Entity, Uuid } from '../schema/index.js';
import { affected, maybeOne, one } from './util.js';

type EntityRow = {
  id: string;
  type: string;
  name: string;
  aliases: string[];
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
};

const COLUMNS = 'id, type, name, aliases, metadata, created_at, updated_at, deleted_at';

function mapEntity(r: EntityRow): Entity {
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    aliases: r.aliases,
    metadata: r.metadata,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

export async function insertEntity(q: Queryable, input: CreateEntityInput): Promise<Entity> {
  const res = await q.query<EntityRow>(
    `INSERT INTO entities (type, name, aliases, metadata)
     VALUES ($1, $2, $3, $4)
     RETURNING ${COLUMNS}`,
    [input.type, input.name, input.aliases ?? [], input.metadata ?? {}],
  );
  return mapEntity(one(res));
}

export async function findEntityById(
  q: Queryable,
  id: Uuid,
  opts: { includeDeleted?: boolean } = {},
): Promise<Entity | undefined> {
  const res = await q.query<EntityRow>(
    `SELECT ${COLUMNS} FROM entities
     WHERE id = $1 ${opts.includeDeleted ? '' : 'AND deleted_at IS NULL'}`,
    [id],
  );
  const row = maybeOne(res);
  return row ? mapEntity(row) : undefined;
}

/** Find a live entity by exact type and case-insensitive name (for find-or-create). */
export async function findEntityByTypeName(
  q: Queryable,
  type: string,
  name: string,
): Promise<Entity | undefined> {
  const res = await q.query<EntityRow>(
    `SELECT ${COLUMNS} FROM entities
     WHERE type = $1 AND lower(name) = lower($2) AND deleted_at IS NULL
     ORDER BY created_at ASC
     LIMIT 1`,
    [type, name],
  );
  const row = maybeOne(res);
  return row ? mapEntity(row) : undefined;
}

export interface ListEntitiesOptions {
  type?: string;
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
}

export async function listEntities(
  q: Queryable,
  opts: ListEntitiesOptions = {},
): Promise<Entity[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (!opts.includeDeleted) {
    conditions.push('deleted_at IS NULL');
  }
  if (opts.type !== undefined) {
    values.push(opts.type);
    conditions.push(`type = $${values.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  values.push(limit);
  const limitParam = `$${values.length}`;
  values.push(Math.max(opts.offset ?? 0, 0));
  const offsetParam = `$${values.length}`;

  const res = await q.query<EntityRow>(
    `SELECT ${COLUMNS} FROM entities ${where}
     ORDER BY created_at DESC
     LIMIT ${limitParam} OFFSET ${offsetParam}`,
    values,
  );
  return res.rows.map(mapEntity);
}

export interface UpdateEntityFields {
  name?: string;
  aliases?: string[];
  metadata?: Record<string, unknown>;
}

export async function updateEntity(
  q: Queryable,
  id: Uuid,
  fields: UpdateEntityFields,
): Promise<Entity | undefined> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (fields.name !== undefined) {
    values.push(fields.name);
    sets.push(`name = $${values.length}`);
  }
  if (fields.aliases !== undefined) {
    values.push(fields.aliases);
    sets.push(`aliases = $${values.length}`);
  }
  if (fields.metadata !== undefined) {
    values.push(fields.metadata);
    sets.push(`metadata = $${values.length}`);
  }
  if (sets.length === 0) {
    return findEntityById(q, id);
  }
  sets.push('updated_at = now()');
  values.push(id);
  const res = await q.query<EntityRow>(
    `UPDATE entities SET ${sets.join(', ')}
     WHERE id = $${values.length} AND deleted_at IS NULL
     RETURNING ${COLUMNS}`,
    values,
  );
  const row = maybeOne(res);
  return row ? mapEntity(row) : undefined;
}

export async function softDeleteEntity(q: Queryable, id: Uuid): Promise<boolean> {
  const res = await q.query(
    `UPDATE entities SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return affected(res);
}

export async function restoreEntity(q: Queryable, id: Uuid): Promise<boolean> {
  const res = await q.query(
    `UPDATE entities SET deleted_at = NULL, updated_at = now()
     WHERE id = $1 AND deleted_at IS NOT NULL`,
    [id],
  );
  return affected(res);
}

/** Hard-delete an entity. Cascades to its observations and relations (FK ON DELETE CASCADE). */
export async function hardDeleteEntity(q: Queryable, id: Uuid): Promise<boolean> {
  const res = await q.query('DELETE FROM entities WHERE id = $1', [id]);
  return affected(res);
}
