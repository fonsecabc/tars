import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMemory, type Memory } from '../memory/facade.js';
import { closeTestPool, getTestPool, resetDb } from '../test-helpers/db.js';
import { FakeEmbeddingProvider } from '../test-helpers/embeddings.js';
import { GOLD, type CaseKind } from './dataset.js';
import { seedSyntheticBrain, type SeededBrain } from './fixtures.js';
import { mean, scoreCase } from './metrics.js';

/**
 * Hermetic RAG regression guard. Seeds the synthetic brain with the deterministic
 * FakeEmbeddingProvider (no Ollama / network) and asserts the recall benchmark stays above
 * tuned floors. The live-quality sweep uses real Ollama embeddings via `eval/run.ts`; this
 * test exists so a future change can't silently regress retrieval quality in CI.
 *
 * Floors are set well below the measured score (~0.88) to tolerate benign variance while
 * still catching a real regression (baseline before tuning was ~0.79 on this provider).
 */
const pool = getTestPool();
let seed: SeededBrain;
let memory: Memory;

beforeAll(async () => {
  await resetDb(pool);
  memory = createMemory(pool, { embeddings: new FakeEmbeddingProvider() });
  seed = await seedSyntheticBrain(memory);
});

afterAll(async () => {
  await closeTestPool();
});

async function runSuite(): Promise<{
  composite: number;
  byKind: Map<CaseKind, number>;
  recall10: number;
}> {
  const composites: number[] = [];
  const recalls: number[] = [];
  const byKindScores = new Map<CaseKind, number[]>();
  for (const c of GOLD) {
    const result = await memory.recall(c.query, { limit: 10 });
    const retrieved = result.entities
      .map((e) => seed.keyById.get(e.entity.id))
      .filter((k): k is string => k !== undefined);
    const score = scoreCase(c.relevant, retrieved);
    composites.push(score.composite);
    recalls.push(score.recall10);
    const arr = byKindScores.get(c.kind) ?? [];
    arr.push(score.composite);
    byKindScores.set(c.kind, arr);
  }
  const byKind = new Map<CaseKind, number>();
  for (const [kind, xs] of byKindScores) {
    byKind.set(kind, mean(xs));
  }
  return { composite: mean(composites), byKind, recall10: mean(recalls) };
}

describe('recall benchmark (hermetic)', () => {
  it('stays above tuned quality floors (retrieval-only, no LLM reranker)', async () => {
    const { composite, byKind, recall10 } = await runSuite();
    // Retrieval-only floor on the FakeEmbeddingProvider (measured ~0.71 on the top-heavy
    // composite; the live Ollama + LLM-rerank pipeline scores far higher). Guards regressions.
    expect(composite).toBeGreaterThanOrEqual(0.65);
    expect(recall10).toBeGreaterThanOrEqual(0.9);
    // Exact-name and alias queries must be perfectly ranked (the exact-match bonus guarantees it).
    expect(byKind.get('exact') ?? 0).toBeGreaterThanOrEqual(0.99);
    expect(byKind.get('alias') ?? 0).toBeGreaterThanOrEqual(0.99);
  });
});
