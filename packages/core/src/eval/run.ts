/**
 * Recall benchmark runner. Seeds a synthetic brain, runs `memory.recall` over the gold query
 * set, and reports IR metrics (Recall@k / MRR / nDCG) plus small-model context stats. It is
 * the objective function for tuning retrieval — run it, change something, run it again.
 *
 *   BENCH_PROVIDER=ollama|fake|none  (default ollama — the production path)
 *   BENCH_LIMIT, BENCH_GRAPH_DEPTH, BENCH_SCORE_FLOOR, BENCH_RRF_K, BENCH_OBS  (recall knobs)
 *   BENCH_OUT=<path>       write the scorecard JSON here (default eval/results/latest.json)
 *   BENCH_BASELINE=<path>  compare against a previous scorecard and print the delta
 *   BENCH_LABEL=<string>   annotate the run
 *
 * Run: BENCH_PROVIDER=ollama node_modules/.bin/tsx packages/core/src/eval/run.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { EmbeddingProvider } from '../embeddings/provider.js';
import { OllamaEmbeddingProvider } from '../embeddings/ollama.js';
import { createMemory } from '../memory/facade.js';
import { renderRecallCompact } from '../memory/render.js';
import { OllamaRerankLlm, type RerankLlm } from '../rerank/index.js';
import { closeTestPool, getTestPool, resetDb } from '../test-helpers/db.js';
import { FakeEmbeddingProvider } from '../test-helpers/embeddings.js';
import ensureTestDb from '../test-helpers/global-setup.js';
import { GOLD, type CaseKind } from './dataset.js';
import { seedSyntheticBrain } from './fixtures.js';
import { mean, scoreCase, type CaseScore } from './metrics.js';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function buildProvider(kind: string): EmbeddingProvider | null {
  switch (kind) {
    case 'none':
      return null;
    case 'fake':
      return new FakeEmbeddingProvider();
    case 'ollama':
    default:
      return new OllamaEmbeddingProvider({
        baseUrl: process.env.OLLAMA_BASE_URL,
        model: process.env.OLLAMA_EMBEDDING_MODEL,
      });
  }
}

interface CaseRow extends CaseScore {
  id: string;
  kind: CaseKind;
  query: string;
  relevant: string[];
  retrieved: string[];
  entitiesReturned: number;
  compactChars: number;
}

interface Scorecard {
  label: string;
  provider: string;
  options: { limit: number; graphDepth: number; scoreFloor: number; rrfK: number; obs: number };
  score: number; // headline: mean composite
  aggregate: Record<string, number>;
  byKind: Record<string, number>;
  context: { avgEntitiesReturned: number; avgCompactChars: number };
  cases: CaseRow[];
}

const f = (x: number): string => x.toFixed(3);

async function main(): Promise<void> {
  const providerKind = process.env.BENCH_PROVIDER ?? 'ollama';
  const options = {
    limit: envInt('BENCH_LIMIT', 10),
    graphDepth: envInt('BENCH_GRAPH_DEPTH', 1),
    scoreFloor: envFloat('BENCH_SCORE_FLOOR', 0),
    rrfK: envInt('BENCH_RRF_K', 60),
    obs: envInt('BENCH_OBS', 3),
    nameW: envFloat('BENCH_NAME_W', 2),
    obsW: envFloat('BENCH_OBS_W', 1),
    vecW: envFloat('BENCH_VEC_W', 1),
    mul: envFloat('BENCH_MUL', 1.4),
    add: envFloat('BENCH_ADD', 0.15),
    exact: envFloat('BENCH_EXACT', 1),
  };
  const rerankLabel = process.env.BENCH_RERANK && process.env.BENCH_RERANK !== '0' ? '+rerank' : '';
  const label =
    process.env.BENCH_LABEL ??
    `${providerKind}${rerankLabel} mul=${options.mul} add=${options.add}`;

  await ensureTestDb();
  const pool = getTestPool();
  await resetDb(pool);

  const provider = buildProvider(providerKind);
  const rerankModel = process.env.BENCH_RERANK;
  const reranker: RerankLlm | null =
    rerankModel && rerankModel !== '0' && rerankModel !== 'none'
      ? new OllamaRerankLlm({
          baseUrl: process.env.OLLAMA_BASE_URL,
          model: rerankModel === '1' ? undefined : rerankModel,
        })
      : null;
  const memory = createMemory(pool, { embeddings: provider, reranker });
  const seed = await seedSyntheticBrain(memory);

  const rows: CaseRow[] = [];
  for (const c of GOLD) {
    const result = await memory.recall(c.query, {
      limit: options.limit,
      includeGraph: true,
      graphDepth: options.graphDepth,
      scoreFloor: options.scoreFloor,
      rrfK: options.rrfK,
      observationsPerEntity: options.obs,
      signalWeights: { name: options.nameW, observation: options.obsW, vector: options.vecW },
      graphBoostMul: options.mul,
      graphBoostAdd: options.add,
      exactMatchBonus: options.exact,
    });
    const retrieved = result.entities
      .map((e) => seed.keyById.get(e.entity.id))
      .filter((k): k is string => k !== undefined);
    const score = scoreCase(c.relevant, retrieved);
    const compactChars = renderRecallCompact(result, { maxChars: 1_000_000 }).length;
    rows.push({
      id: c.id,
      kind: c.kind,
      query: c.query,
      relevant: c.relevant,
      retrieved,
      entitiesReturned: result.entities.length,
      compactChars,
      ...score,
    });
  }

  const aggregate: Record<string, number> = {
    hit1: mean(rows.map((r) => r.hit1)),
    recall3: mean(rows.map((r) => r.recall3)),
    recall5: mean(rows.map((r) => r.recall5)),
    recall10: mean(rows.map((r) => r.recall10)),
    mrr: mean(rows.map((r) => r.mrr)),
    ndcg3: mean(rows.map((r) => r.ndcg3)),
    ndcg5: mean(rows.map((r) => r.ndcg5)),
  };
  const kinds = [...new Set(GOLD.map((c) => c.kind))];
  const byKind: Record<string, number> = {};
  for (const kind of kinds) {
    byKind[kind] = mean(rows.filter((r) => r.kind === kind).map((r) => r.composite));
  }
  const score = mean(rows.map((r) => r.composite));

  const card: Scorecard = {
    label,
    provider: provider ? provider.id : 'none',
    options,
    score,
    aggregate,
    byKind,
    context: {
      avgEntitiesReturned: mean(rows.map((r) => r.entitiesReturned)),
      avgCompactChars: mean(rows.map((r) => r.compactChars)),
    },
    cases: rows,
  };

  const outPath = resolve(process.env.BENCH_OUT ?? 'packages/core/src/eval/results/latest.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(card, null, 2));

  // Report
  process.stdout.write(`\n=== RAG recall benchmark — ${card.label} ===\n`);
  process.stdout.write(
    `provider=${card.provider}  entities=${seed.entityCount}  relations=${seed.relationCount}  cases=${rows.length}\n`,
  );
  process.stdout.write(`\nHEADLINE SCORE: ${f(score)}   (0.5*nDCG@3 + 0.3*MRR + 0.2*Recall@3)\n\n`);
  process.stdout.write(
    `aggregate:  ${Object.entries(aggregate)
      .map(([k, v]) => `${k}=${f(v)}`)
      .join('  ')}\n`,
  );
  process.stdout.write(
    `by kind:    ${Object.entries(byKind)
      .map(([k, v]) => `${k}=${f(v)}`)
      .join('  ')}\n`,
  );
  process.stdout.write(
    `context:    avgEntities=${f(card.context.avgEntitiesReturned)}  avgCompactChars=${f(card.context.avgCompactChars)}\n`,
  );

  // Show the worst cases — where the improvement work should focus.
  const worst = [...rows].sort((a, b) => a.composite - b.composite).slice(0, 6);
  process.stdout.write(`\nweakest cases:\n`);
  for (const r of worst) {
    process.stdout.write(
      `  [${r.kind}] ${r.id} "${r.query}"  comp=${f(r.composite)}  want=[${r.relevant.join(',')}]  got=[${r.retrieved.slice(0, 5).join(',')}]\n`,
    );
  }

  if (process.env.BENCH_BASELINE) {
    try {
      const base = JSON.parse(
        readFileSync(resolve(process.env.BENCH_BASELINE), 'utf8'),
      ) as Scorecard;
      const delta = score - base.score;
      const pct = base.score > 0 ? (delta / base.score) * 100 : 0;
      process.stdout.write(
        `\nvs baseline (${base.label}): ${f(base.score)} -> ${f(score)}  Δ=${delta >= 0 ? '+' : ''}${f(delta)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)\n`,
      );
    } catch (error) {
      process.stdout.write(`\n(could not read baseline: ${String(error)})\n`);
    }
  }
  process.stdout.write(`\nwrote ${outPath}\n`);

  await closeTestPool();
}

main().catch((error: unknown) => {
  process.stderr.write(`benchmark failed: ${String(error)}\n`);
  process.exitCode = 1;
  void closeTestPool();
});
