/**
 * Pure information-retrieval metrics for the recall benchmark. All functions take the set
 * of relevant item keys and the ranked list of retrieved keys; they never touch the DB or
 * the network, so they are unit-testable in isolation.
 */

/** Fraction of the relevant items that appear in the top-k retrieved. */
export function recallAtK(
  relevant: readonly string[],
  retrieved: readonly string[],
  k: number,
): number {
  if (relevant.length === 0) {
    return 1;
  }
  const top = new Set(retrieved.slice(0, k));
  let hit = 0;
  for (const r of relevant) {
    if (top.has(r)) {
      hit += 1;
    }
  }
  return hit / relevant.length;
}

/** Fraction of the top-k retrieved that are relevant (precision is capped by k, not by result size). */
export function precisionAtK(
  relevant: readonly string[],
  retrieved: readonly string[],
  k: number,
): number {
  if (k <= 0) {
    return 0;
  }
  const rel = new Set(relevant);
  const top = retrieved.slice(0, k);
  let hit = 0;
  for (const r of top) {
    if (rel.has(r)) {
      hit += 1;
    }
  }
  return hit / k;
}

/** Reciprocal rank of the first relevant hit (0 if none retrieved). */
export function reciprocalRank(relevant: readonly string[], retrieved: readonly string[]): number {
  const rel = new Set(relevant);
  for (let i = 0; i < retrieved.length; i++) {
    const item = retrieved[i];
    if (item !== undefined && rel.has(item)) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/** Normalized discounted cumulative gain at k with binary relevance. */
export function ndcgAtK(
  relevant: readonly string[],
  retrieved: readonly string[],
  k: number,
): number {
  const rel = new Set(relevant);
  let dcg = 0;
  const top = retrieved.slice(0, k);
  for (let i = 0; i < top.length; i++) {
    const item = top[i];
    if (item !== undefined && rel.has(item)) {
      dcg += 1 / Math.log2(i + 2);
    }
  }
  const idealHits = Math.min(relevant.length, k);
  let idcg = 0;
  for (let i = 0; i < idealHits; i++) {
    idcg += 1 / Math.log2(i + 2);
  }
  return idcg === 0 ? 0 : dcg / idcg;
}

export interface CaseScore {
  recall3: number;
  recall5: number;
  recall10: number;
  precision5: number;
  mrr: number;
  ndcg3: number;
  ndcg5: number;
  ndcg10: number;
  /** 1 if the top-ranked result is relevant, else 0. */
  hit1: number;
  /** Weighted headline score for this case (0–1). */
  composite: number;
}

export function scoreCase(relevant: readonly string[], retrieved: readonly string[]): CaseScore {
  const recall3 = recallAtK(relevant, retrieved, 3);
  const recall5 = recallAtK(relevant, retrieved, 5);
  const recall10 = recallAtK(relevant, retrieved, 10);
  const precision5 = precisionAtK(relevant, retrieved, 5);
  const mrr = reciprocalRank(relevant, retrieved);
  const ndcg3 = ndcgAtK(relevant, retrieved, 3);
  const ndcg5 = ndcgAtK(relevant, retrieved, 5);
  const ndcg10 = ndcgAtK(relevant, retrieved, 10);
  const hit1 = mrr === 1 ? 1 : 0;
  // Headline is TOP-HEAVY on purpose: a small model with a tight context budget only reads the
  // first few entities the compact renderer emits, so ranking the answer into the top 3 is what
  // actually matters — not merely retrieving it somewhere in the top 10. nDCG@3 dominates;
  // first-hit position (MRR) and top-3 coverage round it out.
  const composite = 0.5 * ndcg3 + 0.3 * mrr + 0.2 * recall3;
  return { recall3, recall5, recall10, precision5, mrr, ndcg3, ndcg5, ndcg10, hit1, composite };
}

export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}
