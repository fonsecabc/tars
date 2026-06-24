/**
 * Reciprocal Rank Fusion. Combines several ranked lists of ids into one fused score
 * map. Only rank ORDER matters per list (not the raw per-signal scores), so signals on
 * different scales — keyword ts_rank, trigram similarity, vector distance — fuse cleanly.
 *
 * score(id) = Σ_lists 1 / (k + rank), with rank starting at 1. Higher is better.
 */
export function rrfFuse(lists: readonly (readonly string[])[], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    for (let i = 0; i < list.length; i++) {
      const id = list[i];
      if (id === undefined) {
        continue;
      }
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
    }
  }
  return scores;
}

/** Sort ids by fused score, highest first. */
export function rankByScore(scores: Map<string, number>): string[] {
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
