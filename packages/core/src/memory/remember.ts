import type { Pool } from 'pg';

import { withTransaction } from '../db/tx.js';
import { EntityNotFoundError } from '../errors.js';
import { normalizeRegistryName } from '../schema/common.js';
import type { CreateObservationInput, Entity, Observation, Source, Uuid } from '../schema/index.js';
import { appendAudit } from '../store/audit.js';
import * as entities from '../store/entities.js';
import * as observations from '../store/observations.js';
import * as registries from '../store/registries.js';

/** Either an existing entity (by id) or a descriptor to find-or-create. */
export type RememberEntityRef =
  | { id: Uuid }
  | { type: string; name: string; aliases?: string[]; metadata?: Record<string, unknown> };

export interface RememberInput {
  entity: RememberEntityRef;
  observations: CreateObservationInput[];
  /** Provenance recorded on observations and the audit log. */
  source?: Source;
}

export interface RememberResult {
  entity: Entity;
  entityCreated: boolean;
  observations: Observation[];
}

/**
 * Write one or more observations about an entity, creating the entity (and registering
 * its type) if needed. Entity matching by descriptor is exact type + case-insensitive
 * name. All work happens in one transaction and is audited.
 */
export async function remember(pool: Pool, input: RememberInput): Promise<RememberResult> {
  const source: Source = input.source ?? 'manual';

  return withTransaction(pool, async (tx) => {
    let entity: Entity;
    let entityCreated = false;

    if ('id' in input.entity) {
      const found = await entities.findEntityById(tx, input.entity.id);
      if (!found) {
        throw new EntityNotFoundError(input.entity.id);
      }
      entity = found;
    } else {
      const type = normalizeRegistryName(input.entity.type);
      const existing = await entities.findEntityByTypeName(tx, type, input.entity.name);
      if (existing) {
        entity = existing;
      } else {
        await registries.ensureEntityType(tx, type);
        entity = await entities.insertEntity(tx, {
          type,
          name: input.entity.name,
          aliases: input.entity.aliases ?? [],
          metadata: input.entity.metadata ?? {},
        });
        await registries.bumpEntityTypeUsage(tx, type, 1);
        entityCreated = true;
        await appendAudit(tx, {
          action: 'entity.create',
          targetKind: 'entity',
          targetId: entity.id,
          source,
          detail: { type: entity.type, name: entity.name },
        });
      }
    }

    const inserted: Observation[] = [];
    for (const obs of input.observations) {
      const created = await observations.insertObservation(tx, entity.id, obs, { source });
      inserted.push(created);
      await appendAudit(tx, {
        action: 'observation.create',
        targetKind: 'observation',
        targetId: created.id,
        source,
        detail: { entityId: entity.id },
      });
    }

    return { entity, entityCreated, observations: inserted };
  });
}
