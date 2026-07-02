import type { RecallResult } from './recall.js';

/** Returned when recall surfaced nothing — a stable, model-friendly sentinel. */
export const NOTHING_RELEVANT = '(nothing relevant on file)';

export interface RenderCompactOptions {
  /** Hard ceiling on the rendered content size, in characters. */
  maxChars: number;
}

/**
 * Render a {@link RecallResult} as terse, id-free text for small / local models.
 *
 * Entities come first (already ordered seeds-first, graph-only last by `recall`), one per
 * line as `type:name — obs; obs; obs`. Relations follow, rendered BY NAME (`A —predicate→ B`)
 * so a model with no tool access can actually read them; a relation is skipped if either
 * endpoint is absent from the returned entity set.
 *
 * The output is bounded by `maxChars`: lines are kept in order until the next one would
 * overflow, at which point the rest are dropped and a short `… (N more omitted)` marker is
 * appended. The top entity is ALWAYS emitted, even if it alone exceeds the budget — recall
 * with nothing to show is worse than a single slightly-long line. (The truncation marker is
 * meta and may add a short suffix beyond `maxChars`.)
 */
export function renderRecallCompact(result: RecallResult, opts: RenderCompactOptions): string {
  const maxChars = Math.max(1, Math.floor(opts.maxChars));
  if (result.entities.length === 0) {
    return NOTHING_RELEVANT;
  }

  const nameById = new Map<string, string>();
  for (const recalled of result.entities) {
    nameById.set(recalled.entity.id, recalled.entity.name);
  }

  const entityLines = result.entities.map((recalled) => {
    const head = `${recalled.entity.type}:${recalled.entity.name}`;
    const obs = recalled.observations.map((o) => o.text.trim()).filter((t) => t.length > 0);
    return obs.length > 0 ? `${head} — ${obs.join('; ')}` : head;
  });

  const relationLines: string[] = [];
  for (const rel of result.relations) {
    const from = nameById.get(rel.fromEntity);
    const to = nameById.get(rel.toEntity);
    if (from === undefined || to === undefined) {
      continue;
    }
    relationLines.push(`${from} —${rel.predicate}→ ${to}`);
  }

  // entities.length > 0 was checked above, so the top line is always present.
  const topLine =
    entityLines[0] ?? `${result.entities[0]?.entity.type}:${result.entities[0]?.entity.name}`;
  const kept: string[] = [topLine];
  let used = topLine.length;
  let droppedEntities = 0;
  let droppedRelations = 0;

  // Adds a line if it fits (counting the joining newline); reports whether it was kept.
  const tryAdd = (line: string): boolean => {
    const cost = line.length + 1; // +1 for the '\n' that will join it
    if (used + cost > maxChars) {
      return false;
    }
    kept.push(line);
    used += cost;
    return true;
  };

  for (let i = 1; i < entityLines.length; i++) {
    const line = entityLines[i];
    if (line === undefined) {
      continue;
    }
    if (!tryAdd(line)) {
      droppedEntities = entityLines.length - i;
      break;
    }
  }

  // Only spend budget on relations once every entity fit; otherwise they're all dropped.
  if (droppedEntities === 0) {
    for (let i = 0; i < relationLines.length; i++) {
      const line = relationLines[i];
      if (line === undefined) {
        continue;
      }
      if (!tryAdd(line)) {
        droppedRelations = relationLines.length - i;
        break;
      }
    }
  } else {
    droppedRelations = relationLines.length;
  }

  const omitted = droppedEntities + droppedRelations;
  if (omitted > 0) {
    kept.push(`… (${omitted} more omitted)`);
  }

  return kept.join('\n');
}
