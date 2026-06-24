import type { Pool } from 'pg';

import type { Entity, Observation, Relation, Uuid } from '../schema/index.js';
import * as entitiesStore from '../store/entities.js';
import * as observationsStore from '../store/observations.js';
import * as relationsStore from '../store/relations.js';

export interface GetEntityOptions {
  asOf?: Date;
  observationsLimit?: number;
  includeDeleted?: boolean;
}

export interface EntityDetail {
  entity: Entity;
  observations: Observation[];
  relations: Relation[];
}

/** Fetch one entity with its observations and direct (incident) relations. */
export async function getEntity(
  pool: Pool,
  id: Uuid,
  options: GetEntityOptions = {},
): Promise<EntityDetail | undefined> {
  const entity = await entitiesStore.findEntityById(pool, id, {
    includeDeleted: options.includeDeleted,
  });
  if (!entity) {
    return undefined;
  }

  const observations = await observationsStore.listObservationsByEntity(pool, id, {
    asOf: options.asOf,
    limit: options.observationsLimit ?? 50,
    includeDeleted: options.includeDeleted,
  });

  const relations = await relationsStore.listRelationsByEntity(pool, id, {
    includeDeleted: options.includeDeleted,
  });

  return { entity, observations, relations };
}
