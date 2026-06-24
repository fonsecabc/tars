import type { Queryable } from '../db/pool.js';
import type { EntityType, RelationPredicate } from '../schema/index.js';
import { maybeOne } from './util.js';

type RegistryRow = {
  name: string;
  description: string | null;
  created_at: Date;
  usage_count: number;
};

function mapEntityType(r: RegistryRow): EntityType {
  return {
    name: r.name,
    description: r.description,
    createdAt: r.created_at,
    usageCount: r.usage_count,
  };
}

const mapRelationPredicate = mapEntityType as (r: RegistryRow) => RelationPredicate;

// --- Entity types -----------------------------------------------------------

/** Register an entity type if absent. Idempotent; never overwrites a description with null. */
export async function ensureEntityType(
  q: Queryable,
  name: string,
  description?: string,
): Promise<void> {
  await q.query(
    `INSERT INTO entity_types (name, description)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE
       SET description = COALESCE(EXCLUDED.description, entity_types.description)`,
    [name, description ?? null],
  );
}

/** Register or describe an entity type, returning the resulting row. */
export async function defineEntityType(
  q: Queryable,
  name: string,
  description?: string,
): Promise<EntityType> {
  const res = await q.query<RegistryRow>(
    `INSERT INTO entity_types (name, description)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE
       SET description = COALESCE(EXCLUDED.description, entity_types.description)
     RETURNING name, description, created_at, usage_count`,
    [name, description ?? null],
  );
  return mapEntityType(res.rows[0]!);
}

export async function getEntityType(q: Queryable, name: string): Promise<EntityType | undefined> {
  const res = await q.query<RegistryRow>(
    'SELECT name, description, created_at, usage_count FROM entity_types WHERE name = $1',
    [name],
  );
  const row = maybeOne(res);
  return row ? mapEntityType(row) : undefined;
}

export async function listEntityTypes(q: Queryable): Promise<EntityType[]> {
  const res = await q.query<RegistryRow>(
    'SELECT name, description, created_at, usage_count FROM entity_types ORDER BY name',
  );
  return res.rows.map(mapEntityType);
}

export async function bumpEntityTypeUsage(
  q: Queryable,
  name: string,
  delta: number,
): Promise<void> {
  await q.query(
    'UPDATE entity_types SET usage_count = GREATEST(usage_count + $2, 0) WHERE name = $1',
    [name, delta],
  );
}

// --- Relation predicates ----------------------------------------------------

export async function ensureRelationPredicate(
  q: Queryable,
  name: string,
  description?: string,
): Promise<void> {
  await q.query(
    `INSERT INTO relation_predicates (name, description)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE
       SET description = COALESCE(EXCLUDED.description, relation_predicates.description)`,
    [name, description ?? null],
  );
}

export async function defineRelationPredicate(
  q: Queryable,
  name: string,
  description?: string,
): Promise<RelationPredicate> {
  const res = await q.query<RegistryRow>(
    `INSERT INTO relation_predicates (name, description)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE
       SET description = COALESCE(EXCLUDED.description, relation_predicates.description)
     RETURNING name, description, created_at, usage_count`,
    [name, description ?? null],
  );
  return mapRelationPredicate(res.rows[0]!);
}

export async function listRelationPredicates(q: Queryable): Promise<RelationPredicate[]> {
  const res = await q.query<RegistryRow>(
    'SELECT name, description, created_at, usage_count FROM relation_predicates ORDER BY name',
  );
  return res.rows.map(mapRelationPredicate);
}

export async function bumpRelationPredicateUsage(
  q: Queryable,
  name: string,
  delta: number,
): Promise<void> {
  await q.query(
    'UPDATE relation_predicates SET usage_count = GREATEST(usage_count + $2, 0) WHERE name = $1',
    [name, delta],
  );
}
