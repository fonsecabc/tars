import type { Pool } from 'pg';

import { withTransaction } from '../db/tx.js';
import { EntityNotFoundError, ObservationNotFoundError, RelationNotFoundError } from '../errors.js';
import type { Source, Uuid } from '../schema/index.js';
import { appendAudit } from '../store/audit.js';
import * as entities from '../store/entities.js';
import * as observations from '../store/observations.js';
import * as registries from '../store/registries.js';
import * as relations from '../store/relations.js';

export type ForgetTargetKind = 'entity' | 'observation' | 'relation';

export interface ForgetInput {
  kind: ForgetTargetKind;
  id: Uuid;
  /** Hard-delete (permanent) instead of the default soft-delete. */
  hard?: boolean;
  source?: Source;
}

export interface ForgetResult {
  deleted: boolean;
  hard: boolean;
}

/**
 * Remove an entity, observation, or relation. Soft-delete by default (recoverable);
 * hard-delete permanently. Hard-deleting an entity cascades to its observations and
 * relations. Always audited.
 */
export async function forget(pool: Pool, input: ForgetInput): Promise<ForgetResult> {
  const source: Source = input.source ?? 'manual';
  const hard = input.hard ?? false;

  return withTransaction(pool, async (tx) => {
    let deleted = false;
    switch (input.kind) {
      case 'entity': {
        const entity = await entities.findEntityById(tx, input.id, { includeDeleted: true });
        if (!entity) {
          throw new EntityNotFoundError(input.id);
        }
        if (hard) {
          deleted = await entities.hardDeleteEntity(tx, input.id);
          if (deleted) {
            await registries.bumpEntityTypeUsage(tx, entity.type, -1);
          }
        } else {
          deleted = await entities.softDeleteEntity(tx, input.id);
        }
        break;
      }
      case 'observation': {
        const obs = await observations.getObservationById(tx, input.id, { includeDeleted: true });
        if (!obs) {
          throw new ObservationNotFoundError(input.id);
        }
        deleted = hard
          ? await observations.hardDeleteObservation(tx, input.id)
          : await observations.softDeleteObservation(tx, input.id);
        break;
      }
      case 'relation': {
        const relation = await relations.getRelationById(tx, input.id, { includeDeleted: true });
        if (!relation) {
          throw new RelationNotFoundError(input.id);
        }
        if (hard) {
          deleted = await relations.hardDeleteRelation(tx, input.id);
          if (deleted) {
            await registries.bumpRelationPredicateUsage(tx, relation.predicate, -1);
          }
        } else {
          deleted = await relations.softDeleteRelation(tx, input.id);
        }
        break;
      }
    }

    await appendAudit(tx, {
      action: `${input.kind}.${hard ? 'hard_delete' : 'soft_delete'}`,
      targetKind: input.kind,
      targetId: input.id,
      source,
      detail: {},
    });
    return { deleted, hard };
  });
}
