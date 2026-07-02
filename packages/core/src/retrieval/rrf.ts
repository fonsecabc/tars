/**
 * Reciprocal Rank Fusion. Combines several ranked lists of ids into one fused score
 * map. Only rank ORDER matters per list (not the raw per-signal scores), so signals on
 * different scales — keyword ts_rank, trigram similarity, vector distance — fuse cleanly.
 *
 * score(id) = Σ_lists w_list / (k + rank), with rank starting at 1. Higher is better.
 *
 * Per-list `weights` (default 1 each) let a caller trust one signal more than another —
 * e.g. weighting the entity name/alias list above the vector list so a strong lexical
 * match isn't diluted below semantically-adjacent noise.
 */
export function rrfFuse(
  lists: readonly (readonly string[])[],
  k = 60,
  weights?: readonly number[],
): Map<string, number> {
  const scores = new Map<string, number>();
  for (let l = 0; l < lists.length; l++) {
    const list = lists[l];
    if (list === undefined) {
      continue;
    }
    const weight = weights?.[l] ?? 1;
    for (let i = 0; i < list.length; i++) {
      const id = list[i];
      if (id === undefined) {
        continue;
      }
      scores.set(id, (scores.get(id) ?? 0) + weight / (k + i + 1));
    }
  }
  return scores;
}

/** Sort ids by fused score, highest first. */
export function rankByScore(scores: Map<string, number>): string[] {
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
