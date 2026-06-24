import type { Pool } from 'pg';

import { normalizeRegistryName } from '../schema/common.js';
import type { Entity, Observation, Relation } from '../schema/index.js';
import * as entitiesStore from '../store/entities.js';
import * as observationsStore from '../store/observations.js';
import * as relationsStore from '../store/relations.js';

export interface ExportOptions {
  /** Restrict to one entity type. */
  type?: string;
  /** Max entities to include (default 100, capped at 1000). */
  limit?: number;
}

export interface ExportedEntity {
  entity: Entity;
  observations: Observation[];
  /** Outgoing relations only, to avoid listing each edge twice. */
  relations: Relation[];
}

export interface ExportDump {
  exportedAt: string;
  entityCount: number;
  /** True if more entities exist than were included. */
  truncated: boolean;
  entities: ExportedEntity[];
}

/**
 * A portable JSON dump of all (or part of) the graph. Bounded by `limit`. Phase 6 adds
 * a Markdown rendering and a file/git-mirror writer for full, unbounded export.
 */
export async function exportMemory(
  pool: Pool,
  options: ExportOptions = {},
  now: Date = new Date(),
): Promise<ExportDump> {
  const type = options.type ? normalizeRegistryName(options.type) : undefined;
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000);

  const fetched = await entitiesStore.listEntities(pool, { type, limit: limit + 1 });
  const truncated = fetched.length > limit;
  const entities = fetched.slice(0, limit);

  const exported: ExportedEntity[] = [];
  for (const entity of entities) {
    const observations = await observationsStore.listObservationsByEntity(pool, entity.id, {
      limit: 500,
    });
    const relations = await relationsStore.listRelationsByEntity(pool, entity.id, {
      direction: 'out',
    });
    exported.push({ entity, observations, relations });
  }

  return {
    exportedAt: now.toISOString(),
    entityCount: exported.length,
    truncated,
    entities: exported,
  };
}
