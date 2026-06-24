import type { Memory } from '../memory/facade.js';
import type { Source } from '../schema/index.js';

import type { ExtractionProposal } from './types.js';

export interface ApplyResult {
  entitiesCreated: number;
  observationsAdded: number;
  relationsAdded: number;
}

/**
 * Persist a (confirmed) extraction proposal via the normal write path. Resolves the
 * proposal's local `ref` handles to created/found entity ids, then links relations. A
 * relation referencing an unknown ref is skipped — it never fabricates an entity it
 * wasn't told about. Provenance defaults to `extraction`.
 */
export async function applyProposal(
  memory: Memory,
  proposal: ExtractionProposal,
  source: Source = 'extraction',
): Promise<ApplyResult> {
  const observationsByRef = new Map<string, { text: string }[]>();
  for (const o of proposal.observations) {
    const list = observationsByRef.get(o.entityRef) ?? [];
    list.push({ text: o.text });
    observationsByRef.set(o.entityRef, list);
  }

  const idByRef = new Map<string, string>();
  let entitiesCreated = 0;
  let observationsAdded = 0;

  for (const entity of proposal.entities) {
    const observations = observationsByRef.get(entity.ref) ?? [];
    const result = await memory.remember({
      entity: { type: entity.type, name: entity.name, aliases: entity.aliases },
      observations: observations.map((o) => ({ text: o.text })),
      source,
    });
    idByRef.set(entity.ref, result.entity.id);
    if (result.entityCreated) {
      entitiesCreated += 1;
    }
    observationsAdded += result.observations.length;
  }

  let relationsAdded = 0;
  for (const relation of proposal.relations) {
    const fromEntity = idByRef.get(relation.fromRef);
    const toEntity = idByRef.get(relation.toRef);
    if (!fromEntity || !toEntity) {
      continue;
    }
    await memory.link({ fromEntity, toEntity, predicate: relation.predicate, source });
    relationsAdded += 1;
  }

  return { entitiesCreated, observationsAdded, relationsAdded };
}
