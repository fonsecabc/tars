import type { Pool } from 'pg';

import { withTransaction } from '../db/tx.js';
import { EntityNotFoundError } from '../errors.js';
import { normalizeRegistryName } from '../schema/common.js';
import type { Relation, Source, Uuid } from '../schema/index.js';
import { appendAudit } from '../store/audit.js';
import * as entities from '../store/entities.js';
import * as registries from '../store/registries.js';
import * as relations from '../store/relations.js';

export interface LinkInput {
  fromEntity: Uuid;
  toEntity: Uuid;
  predicate: string;
  validFrom?: Date;
  validTo?: Date | null;
  metadata?: Record<string, unknown>;
  source?: Source;
}

/**
 * Create a typed, directed relation between two existing entities, registering the
 * predicate if needed. Transactional and audited.
 */
export async function link(pool: Pool, input: LinkInput): Promise<Relation> {
  const predicate = normalizeRegistryName(input.predicate);
  const source: Source = input.source ?? 'manual';

  return withTransaction(pool, async (tx) => {
    const from = await entities.findEntityById(tx, input.fromEntity);
    if (!from) {
      throw new EntityNotFoundError(input.fromEntity);
    }
    const to = await entities.findEntityById(tx, input.toEntity);
    if (!to) {
      throw new EntityNotFoundError(input.toEntity);
    }

    await registries.ensureRelationPredicate(tx, predicate);
    const relation = await relations.insertRelation(tx, {
      fromEntity: from.id,
      toEntity: to.id,
      predicate,
      validFrom: input.validFrom,
      validTo: input.validTo ?? null,
      metadata: input.metadata ?? {},
    });
    await registries.bumpRelationPredicateUsage(tx, predicate, 1);
    await appendAudit(tx, {
      action: 'relation.create',
      targetKind: 'relation',
      targetId: relation.id,
      source,
      detail: { predicate, fromEntity: from.id, toEntity: to.id },
    });
    return relation;
  });
}
