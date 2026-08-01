/**
 * LOCOMO benchmark runner for the Tars memory engine.
 *
 * For each LOCOMO conversation: wipe the brain, ingest every dialogue turn as a timestamped
 * observation on the speaker, then answer each QA using ONLY what `memory.recall` retrieves,
 * judge correctness with a local LLM, and score per category. This measures Tars end-to-end
 * (real Postgres retrieval + real local answerer/judge), NOT a bespoke retriever.
 *
 * Env knobs:
 *   LOCOMO_PATH          dataset file (default: the scratchpad locomo10.json)
 *   LOCOMO_SAMPLES       limit number of conversations (default: all)
 *   LOCOMO_QA_LIMIT      cap total QA per sample (applied after stratification)
 *   LOCOMO_QA_PER_CAT    stratified: N QA per category (1–5) per sample
 *   LOCOMO_RECALL_K      recall limit / entities per query (default 10)
 *   LOCOMO_OBS_PER_ENTITY  observations (turns) surfaced per entity (default 20, recall's cap)
 *   LOCOMO_ANSWER_MODEL  answerer model (default qwen2.5:14b-instruct)
 *   LOCOMO_JUDGE_MODEL   judge model (default qwen2.5:32b-instruct)
 *   LOCOMO_CTX_CHARS     max rendered-context chars fed to the answerer (default 8000)
 *   RERANK_ENABLED       "1"/model name to turn on the LLM reranker in recall
 *   OLLAMA_BASE_URL, OLLAMA_EMBEDDING_MODEL, LOCOMO_RERANK_MODEL
 *
 * Run: LOCOMO_SAMPLES=1 LOCOMO_QA_PER_CAT=3 node_modules/.bin/tsx packages/core/src/eval/locomo/run-locomo.ts
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { OllamaEmbeddingProvider } from '../../embeddings/ollama.js';
import { createMemory, type Memory } from '../../memory/facade.js';
import type { RecallResult } from '../../memory/recall.js';
import { OllamaRerankLlm, type RerankLlm } from '../../rerank/index.js';
import { closeTestPool, getTestPool, resetDb } from '../../test-helpers/db.js';
import ensureTestDb from '../../test-helpers/global-setup.js';
import {
  CATEGORY_LABELS,
  diaTextMap,
  loadLocomo,
  sessionsOf,
  type LocomoCategory,
  type LocomoQa,
  type LocomoSample,
} from './dataset.js';
import {
  answerFromContext,
  isAbstention,
  judgeAnswer,
  type OllamaChatOptions,
} from './ollama-chat.js';

const DEFAULT_LOCOMO_PATH =
  '/private/tmp/claude-501/-Users-fonsecabc-Projects-personal--tars--claude-worktrees-tars-open-source-launch-5b3f5a/95336350-a441-4555-8bb1-11c7f823b715/scratchpad/locomo10.json';

const CATEGORIES: LocomoCategory[] = [1, 2, 3, 4, 5];

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function goldAnswer(qa: LocomoQa): string {
  if (qa.answer !== undefined && qa.answer !== null) {
    return String(qa.answer);
  }
  if (qa.adversarial_answer !== undefined) {
    return qa.adversarial_answer;
  }
  return '';
}

/** Normalize for substring hit-testing: lowercase, collapse whitespace. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Render recalled observations WITH their dates so the answerer can resolve temporal questions.
 * Each line is `[YYYY-MM-DD] {speaker}: {text}` — surfacing the `validFrom` Tars already stores,
 * which the generic compact renderer drops. Budget-capped by char count.
 */
function renderDatedContext(recall: RecallResult, maxChars: number): string {
  const lines: string[] = [];
  let used = 0;
  for (const recalled of recall.entities) {
    for (const o of recalled.observations) {
      const text = o.text.trim();
      if (text.length === 0) {
        continue;
      }
      const day = o.validFrom.toISOString().slice(0, 10);
      const line = `[${day}] ${text}`;
      if (used + line.length + 1 > maxChars) {
        return lines.length > 0 ? lines.join('\n') : 'NOTHING RELEVANT';
      }
      lines.push(line);
      used += line.length + 1;
    }
  }
  return lines.length > 0 ? lines.join('\n') : 'NOTHING RELEVANT';
}

/** Pick the QA to run for one sample: stratified per-category and/or capped in total. */
function selectQa(sample: LocomoSample): LocomoQa[] {
  const perCat = envInt('LOCOMO_QA_PER_CAT', 0);
  const totalLimit = envInt('LOCOMO_QA_LIMIT', 0);

  let selected: LocomoQa[];
  if (perCat > 0) {
    selected = [];
    for (const cat of CATEGORIES) {
      const inCat = sample.qa.filter((q) => q.category === cat).slice(0, perCat);
      selected.push(...inCat);
    }
  } else {
    selected = [...sample.qa];
  }
  if (totalLimit > 0 && selected.length > totalLimit) {
    selected = selected.slice(0, totalLimit);
  }
  return selected;
}

/**
 * Ingest one sample into the (freshly reset) brain. Each turn becomes one observation
 * `"{speaker}: {text}"` on a person entity named after the speaker, timestamped with the
 * session date. Turns are grouped per (speaker, session) into a single `remember` call so the
 * embedding provider batches vectors — behaviourally identical to one call per turn.
 * Returns the number of observations written.
 */
async function ingestSample(memory: Memory, sample: LocomoSample): Promise<number> {
  let written = 0;
  for (const session of sessionsOf(sample)) {
    const bySpeaker = new Map<string, { text: string; validFrom?: Date }[]>();
    for (const turn of session.turns) {
      const text = `${turn.speaker}: ${turn.text}`.trim();
      if (text.length === 0) {
        continue;
      }
      const list = bySpeaker.get(turn.speaker) ?? [];
      list.push(session.date ? { text, validFrom: session.date } : { text });
      bySpeaker.set(turn.speaker, list);
    }
    for (const [speaker, observations] of bySpeaker) {
      if (observations.length === 0) {
        continue;
      }
      await memory.remember({
        entity: { type: 'person', name: speaker, aliases: [] },
        observations,
        source: 'manual',
      });
      written += observations.length;
    }
  }
  return written;
}

interface QaRecord {
  sampleId: string;
  category: LocomoCategory;
  question: string;
  gold: string;
  predicted: string;
  correct: boolean;
  retrievalHit: boolean;
  answerMs: number;
  judgeMs: number;
}

interface CategoryScore {
  category: LocomoCategory;
  label: string;
  total: number;
  correct: number;
  accuracy: number;
  retrievalHits: number;
  retrievalHitRate: number;
}

interface Scorecard {
  label: string;
  dataset: string;
  provider: string;
  answerModel: string;
  judgeModel: string;
  rerank: boolean;
  recallK: number;
  obsPerEntity: number;
  samples: number;
  totalQa: number;
  overallAccuracy: number;
  overallRetrievalHitRate: number;
  byCategory: CategoryScore[];
  timing: {
    ingestSeconds: number;
    avgAnswerMs: number;
    avgJudgeMs: number;
    avgSecondsPerQa: number;
    wallSeconds: number;
  };
  records: QaRecord[];
}

const f = (x: number): string => x.toFixed(3);
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

const PROGRESS_PATH = resolve(
  process.env.LOCOMO_PROGRESS ?? 'packages/core/src/eval/locomo/results/progress.json',
);

interface ProgressCategory {
  label: string;
  total: number;
  correct: number;
  accuracy: number;
  hitRate: number | null;
}

interface WriteProgressArgs {
  status: 'running' | 'done';
  records: QaRecord[];
  totalPlanned: number;
  samplesDone: number;
  samplesTotal: number;
  currentSample: string;
  startedAt: number;
  provider: string;
  answerModel: string;
  judgeModel: string;
  recallK: number;
  obsPerEntity: number;
  rerank: boolean;
}

/** Write a compact live snapshot after each batch/sample so a dashboard can follow the run. */
function writeProgress(args: WriteProgressArgs): void {
  const now = Date.now();
  const elapsedSec = (now - args.startedAt) / 1000;
  const qaDone = args.records.length;
  const overallCorrect = args.records.filter((r) => r.correct).length;

  const byCategory: Record<string, ProgressCategory> = {};
  for (const cat of CATEGORIES) {
    const inCat = args.records.filter((r) => r.category === cat);
    if (inCat.length === 0) continue;
    const correct = inCat.filter((r) => r.correct).length;
    const hits = inCat.filter((r) => r.retrievalHit).length;
    byCategory[String(cat)] = {
      label: CATEGORY_LABELS[cat],
      total: inCat.length,
      correct,
      accuracy: correct / inCat.length,
      hitRate: cat === 5 ? null : hits / inCat.length,
    };
  }

  const recent = args.records.slice(-10).map((r) => ({
    category: r.category,
    label: CATEGORY_LABELS[r.category],
    question: r.question.slice(0, 160),
    gold: r.gold.slice(0, 90),
    predicted: r.predicted.slice(0, 130),
    correct: r.correct,
  }));

  const payload = {
    status: args.status,
    updatedAt: new Date(now).toISOString(),
    startedAt: new Date(args.startedAt).toISOString(),
    elapsedSec,
    etaSec: qaDone > 0 ? (elapsedSec / qaDone) * (args.totalPlanned - qaDone) : 0,
    config: {
      provider: args.provider,
      answerModel: args.answerModel,
      judgeModel: args.judgeModel,
      recallK: args.recallK,
      obsPerEntity: args.obsPerEntity,
      rerank: args.rerank,
    },
    samplesDone: args.samplesDone,
    samplesTotal: args.samplesTotal,
    currentSample: args.currentSample,
    qaDone,
    qaTotal: args.totalPlanned,
    overall: {
      correct: overallCorrect,
      total: qaDone,
      accuracy: qaDone > 0 ? overallCorrect / qaDone : 0,
    },
    byCategory,
    recent,
  };

  mkdirSync(dirname(PROGRESS_PATH), { recursive: true });
  writeFileSync(PROGRESS_PATH, JSON.stringify(payload, null, 2));
}

async function main(): Promise<void> {
  const datasetPath = resolve(process.env.LOCOMO_PATH ?? DEFAULT_LOCOMO_PATH);
  const sampleLimit = envInt('LOCOMO_SAMPLES', 0);
  const recallK = envInt('LOCOMO_RECALL_K', 10);
  // Each speaker is a single entity, so the real retrieval unit is the observation (a turn).
  // Surface more observations per entity than the production default (3) — else the answerer
  // sees only ~6 turns. Capped at 20 by recall().
  const obsPerEntity = envInt('LOCOMO_OBS_PER_ENTITY', 20);
  const ctxChars = envInt('LOCOMO_CTX_CHARS', 8000);
  const answerModel = process.env.LOCOMO_ANSWER_MODEL ?? 'qwen2.5:14b-instruct';
  const judgeModel = process.env.LOCOMO_JUDGE_MODEL ?? 'qwen2.5:32b-instruct';
  const rerankEnabled = Boolean(process.env.RERANK_ENABLED) && process.env.RERANK_ENABLED !== '0';

  const answerOpts: OllamaChatOptions = { model: answerModel };
  const judgeOpts: OllamaChatOptions = { model: judgeModel };

  const allSamples = loadLocomo(datasetPath);
  const samples = sampleLimit > 0 ? allSamples.slice(0, sampleLimit) : allSamples;
  const totalPlanned = samples.reduce((acc, sm) => acc + selectQa(sm).length, 0);

  await ensureTestDb();
  const pool = getTestPool();

  const provider = new OllamaEmbeddingProvider({
    baseUrl: process.env.OLLAMA_BASE_URL,
    model: process.env.OLLAMA_EMBEDDING_MODEL,
  });
  const rerankModelEnv = process.env.LOCOMO_RERANK_MODEL ?? process.env.RERANK_ENABLED;
  const reranker: RerankLlm | null = rerankEnabled
    ? new OllamaRerankLlm({
        baseUrl: process.env.OLLAMA_BASE_URL,
        model:
          rerankModelEnv && rerankModelEnv !== '1' && rerankModelEnv !== '0'
            ? rerankModelEnv
            : undefined,
      })
    : null;
  const memory = createMemory(pool, { embeddings: provider, reranker });

  const records: QaRecord[] = [];
  let ingestSeconds = 0;
  const wallStart = Date.now();

  // Resume support: each completed sample's records are appended to a JSONL checkpoint. On
  // startup we reload them and skip those samples, so a killed run continues instead of
  // restarting from zero. Delete the checkpoint file to force a clean run.
  const checkpointPath = resolve(
    process.env.LOCOMO_CHECKPOINT ?? 'packages/core/src/eval/locomo/results/checkpoint.jsonl',
  );
  const completedSamples = new Set<string>();
  try {
    const prior = readFileSync(checkpointPath, 'utf8');
    for (const line of prior.split('\n')) {
      if (line.trim().length === 0) continue;
      const rec = JSON.parse(line) as QaRecord;
      records.push(rec);
      completedSamples.add(rec.sampleId);
    }
    if (completedSamples.size > 0) {
      process.stdout.write(
        `resuming from checkpoint: ${completedSamples.size} samples done, ${records.length} QA loaded\n`,
      );
    }
  } catch {
    // no checkpoint yet — fresh run
  }
  mkdirSync(dirname(checkpointPath), { recursive: true });

  const emitProgress = (
    status: 'running' | 'done',
    samplesDone: number,
    currentSample: string,
  ): void => {
    writeProgress({
      status,
      records,
      totalPlanned,
      samplesDone,
      samplesTotal: samples.length,
      currentSample,
      startedAt: wallStart,
      provider: provider.id,
      answerModel,
      judgeModel,
      recallK,
      obsPerEntity,
      rerank: rerankEnabled,
    });
  };
  emitProgress('running', 0, samples[0]?.sample_id ?? '');

  for (let s = 0; s < samples.length; s++) {
    const sample = samples[s];
    if (!sample) {
      continue;
    }
    if (completedSamples.has(sample.sample_id)) {
      process.stdout.write(
        `\n[sample ${s + 1}/${samples.length}] ${sample.sample_id}  (skipped — from checkpoint)\n`,
      );
      emitProgress('running', s + 1, sample.sample_id);
      continue;
    }
    const sessions = sessionsOf(sample);
    const diaMap = diaTextMap(sessions);
    const qaSet = selectQa(sample);

    process.stdout.write(
      `\n[sample ${s + 1}/${samples.length}] ${sample.sample_id}  sessions=${sessions.length}  QA=${qaSet.length}  ingesting…\n`,
    );

    await resetDb(pool);
    const ingestStart = Date.now();
    const obsCount = await ingestSample(memory, sample);
    const ingestElapsed = (Date.now() - ingestStart) / 1000;
    ingestSeconds += ingestElapsed;
    process.stdout.write(
      `  ingested ${obsCount} observations in ${ingestElapsed.toFixed(1)}s; answering…\n`,
    );

    for (let i = 0; i < qaSet.length; i++) {
      const qa = qaSet[i];
      if (!qa) {
        continue;
      }
      const gold = goldAnswer(qa);

      const recall = await memory.recall(qa.question, {
        limit: recallK,
        observationsPerEntity: obsPerEntity,
      });
      const context = renderDatedContext(recall, ctxChars);

      // Retrieval hit: did any gold-evidence turn's text survive into the retrieved context?
      const normContext = normalize(context);
      const evidence = qa.evidence ?? [];
      let retrievalHit = false;
      for (const dia of evidence) {
        const turnText = diaMap.get(dia);
        if (turnText && normContext.includes(normalize(turnText))) {
          retrievalHit = true;
          break;
        }
      }

      const answerStart = Date.now();
      const predicted = await answerFromContext(qa.question, context, answerOpts);
      const answerMs = Date.now() - answerStart;

      let correct: boolean;
      let judgeMs = 0;
      if (qa.category === 5) {
        // Adversarial: correct IFF the model abstained. Never sent to the judge.
        correct = isAbstention(predicted);
      } else if (isAbstention(predicted)) {
        // Abstaining on an answerable question is wrong; skip the judge call.
        correct = false;
      } else {
        const judgeStart = Date.now();
        correct = await judgeAnswer(qa.question, gold, predicted, judgeOpts);
        judgeMs = Date.now() - judgeStart;
      }

      records.push({
        sampleId: sample.sample_id,
        category: qa.category,
        question: qa.question,
        gold,
        predicted,
        correct,
        retrievalHit,
        answerMs,
        judgeMs,
      });

      if ((i + 1) % 5 === 0 || i === qaSet.length - 1) {
        const done = records.filter((r) => r.sampleId === sample.sample_id).length;
        const good = records.filter((r) => r.sampleId === sample.sample_id && r.correct).length;
        process.stdout.write(`  QA ${done}/${qaSet.length}  running acc=${pct(good / done)}\n`);
        emitProgress('running', s, sample.sample_id);
      }
    }
    // Checkpoint this sample's records so a killed run can resume past it.
    const sampleRecords = records.filter((r) => r.sampleId === sample.sample_id);
    appendFileSync(checkpointPath, sampleRecords.map((r) => JSON.stringify(r)).join('\n') + '\n');
    completedSamples.add(sample.sample_id);
    emitProgress('running', s + 1, sample.sample_id);
  }

  const wallSeconds = (Date.now() - wallStart) / 1000;

  // Aggregate.
  const byCategory: CategoryScore[] = [];
  for (const cat of CATEGORIES) {
    const inCat = records.filter((r) => r.category === cat);
    if (inCat.length === 0) {
      continue;
    }
    const correct = inCat.filter((r) => r.correct).length;
    const hits = inCat.filter((r) => r.retrievalHit).length;
    byCategory.push({
      category: cat,
      label: CATEGORY_LABELS[cat],
      total: inCat.length,
      correct,
      accuracy: correct / inCat.length,
      retrievalHits: hits,
      retrievalHitRate: inCat.length > 0 ? hits / inCat.length : 0,
    });
  }
  const total = records.length;
  const overallCorrect = records.filter((r) => r.correct).length;
  // Retrieval hit-rate excludes adversarial items (they have no meaningful gold evidence).
  const answerable = records.filter((r) => r.category !== 5);
  const overallHits = answerable.filter((r) => r.retrievalHit).length;
  const answerMsValues = records.map((r) => r.answerMs);
  const judged = records.filter((r) => r.judgeMs > 0);
  const avgAnswerMs =
    answerMsValues.length > 0
      ? answerMsValues.reduce((a, b) => a + b, 0) / answerMsValues.length
      : 0;
  const avgJudgeMs =
    judged.length > 0 ? judged.reduce((a, b) => a + b.judgeMs, 0) / judged.length : 0;

  const card: Scorecard = {
    label:
      process.env.LOCOMO_LABEL ??
      `locomo samples=${samples.length}${rerankEnabled ? ' +rerank' : ''}`,
    dataset: datasetPath,
    provider: provider.id,
    answerModel,
    judgeModel,
    rerank: rerankEnabled,
    recallK,
    obsPerEntity,
    samples: samples.length,
    totalQa: total,
    overallAccuracy: total > 0 ? overallCorrect / total : 0,
    overallRetrievalHitRate: answerable.length > 0 ? overallHits / answerable.length : 0,
    byCategory,
    timing: {
      ingestSeconds,
      avgAnswerMs,
      avgJudgeMs,
      avgSecondsPerQa: total > 0 ? wallSeconds / total : 0,
      wallSeconds,
    },
    records,
  };

  const outPath = resolve(
    process.env.LOCOMO_OUT ?? 'packages/core/src/eval/locomo/results/latest.json',
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(card, null, 2));
  emitProgress('done', samples.length, '');

  // Scorecard.
  process.stdout.write(`\n=== LOCOMO scorecard — ${card.label} ===\n`);
  process.stdout.write(
    `dataset=${card.dataset}\nprovider=${card.provider}  answer=${answerModel}  judge=${judgeModel}  rerank=${rerankEnabled ? 'on' : 'off'}  recallK=${recallK}  obsPerEntity=${obsPerEntity}\n`,
  );
  process.stdout.write(`samples=${card.samples}  QA=${total}\n\n`);
  process.stdout.write(`  category        n     acc     retrieval-hit\n`);
  for (const c of byCategory) {
    const label = `${c.category} ${c.label}`.padEnd(15);
    const hitCell = c.category === 5 ? '     n/a' : `  ${pct(c.retrievalHitRate)}`;
    process.stdout.write(
      `  ${label} ${String(c.total).padStart(3)}   ${pct(c.accuracy).padStart(6)}   ${hitCell}\n`,
    );
  }
  process.stdout.write(
    `\nOVERALL accuracy: ${pct(card.overallAccuracy)}  (${overallCorrect}/${total})\n`,
  );
  process.stdout.write(
    `OVERALL retrieval hit-rate (cat 1–4, temporal, open): ${pct(card.overallRetrievalHitRate)}  (${overallHits}/${answerable.length})\n`,
  );
  process.stdout.write(
    `\ntiming: ingest=${ingestSeconds.toFixed(1)}s  avgAnswer=${(avgAnswerMs / 1000).toFixed(2)}s  avgJudge=${(avgJudgeMs / 1000).toFixed(2)}s  avgPerQA=${card.timing.avgSecondsPerQa.toFixed(2)}s  wall=${wallSeconds.toFixed(1)}s\n`,
  );
  process.stdout.write(`\nwrote ${outPath}\n`);
  process.stdout.write(`(headline accuracy: ${f(card.overallAccuracy)})\n`);

  await closeTestPool();
}

main().catch((error: unknown) => {
  process.stderr.write(`locomo benchmark failed: ${String(error)}\n`);
  process.exitCode = 1;
  void closeTestPool();
});
