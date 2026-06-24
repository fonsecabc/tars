import type { Pool } from 'pg';

import { withTransaction } from '../db/tx.js';
import { normalizeRegistryName } from '../schema/common.js';
import type { EntityType, RelationPredicate, Source } from '../schema/index.js';
import { appendAudit } from '../store/audit.js';
import * as registries from '../store/registries.js';

/** Register or (re)describe an entity type. Types also auto-register on first use. */
export async function defineEntityType(
  pool: Pool,
  name: string,
  description?: string,
  source: Source = 'manual',
): Promise<EntityType> {
  const normalized = normalizeRegistryName(name);
  return withTransaction(pool, async (tx) => {
    const type = await registries.defineEntityType(tx, normalized, description);
    await appendAudit(tx, {
      action: 'entity_type.define',
      targetKind: 'entity_type',
      targetId: normalized,
      source,
      detail: { description: description ?? null },
    });
    return type;
  });
}

/** Register or (re)describe a relation predicate. Predicates also auto-register on first use. */
export async function defineRelationPredicate(
  pool: Pool,
  name: string,
  description?: string,
  source: Source = 'manual',
): Promise<RelationPredicate> {
  const normalized = normalizeRegistryName(name);
  return withTransaction(pool, async (tx) => {
    const predicate = await registries.defineRelationPredicate(tx, normalized, description);
    await appendAudit(tx, {
      action: 'relation_predicate.define',
      targetKind: 'relation_predicate',
      targetId: normalized,
      source,
      detail: { description: description ?? null },
    });
    return predicate;
  });
}
