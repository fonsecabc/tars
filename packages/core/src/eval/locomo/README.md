# LOCOMO benchmark harness

A reproducible [LOCOMO](https://github.com/snap-research/locomo) evaluation for the Tars memory
engine. It ingests each multi-session conversation into a **real Tars brain** (Postgres +
embeddings), answers the QA using **only what `memory.recall` retrieves**, judges correctness
with a local LLM, and scores per category.

> LOCOMO — Maharana, Lee, Tulyakov, Bansal, Barbieri, Fang. _"Evaluating Very Long-Term
> Conversational Memory of LLM Agents."_ ACL 2024. Data & paper: https://github.com/snap-research/locomo

This is an **end-to-end** measure of Tars (retrieval + a small local answerer + a local judge),
not of a bespoke retriever. See _Method & caveats_ below before quoting a number.

## Prerequisites

- Postgres dev stack up: `pnpm db:up` (the harness uses the `tars_test` DB and wipes it per sample).
- [Ollama](https://ollama.com) running at `http://localhost:11434` with:
  - `nomic-embed-text` (embeddings)
  - `qwen2.5:14b-instruct` (default answerer)
  - `qwen2.5:32b-instruct` (default judge)
- The dataset: `./download.sh` fetches `locomo10.json` into `./data/` (git-ignored).

## Run

```bash
# fetch the data (once)
packages/core/src/eval/locomo/download.sh

# smoke test — 1 conversation, 3 QA per category (~15 QA)
LOCOMO_PATH=packages/core/src/eval/locomo/data/locomo10.json \
LOCOMO_SAMPLES=1 LOCOMO_QA_PER_CAT=3 \
  node_modules/.bin/tsx packages/core/src/eval/locomo/run-locomo.ts

# stratified ~250-QA subset (5 QA per category × 5 categories × 10 samples = 250)
LOCOMO_PATH=packages/core/src/eval/locomo/data/locomo10.json \
LOCOMO_QA_PER_CAT=5 \
  node_modules/.bin/tsx packages/core/src/eval/locomo/run-locomo.ts

# full run — all 10 conversations, all 1,986 QA (long)
LOCOMO_PATH=packages/core/src/eval/locomo/data/locomo10.json \
  node_modules/.bin/tsx packages/core/src/eval/locomo/run-locomo.ts
```

## Env knobs

| Var                     | Default                    | Meaning                                                                                |
| ----------------------- | -------------------------- | -------------------------------------------------------------------------------------- |
| `LOCOMO_PATH`           | scratchpad `locomo10.json` | dataset file                                                                           |
| `LOCOMO_SAMPLES`        | all (10)                   | limit number of conversations                                                          |
| `LOCOMO_QA_LIMIT`       | none                       | cap total QA per sample (after stratification)                                         |
| `LOCOMO_QA_PER_CAT`     | none                       | stratified: N QA per category (1–5) per sample                                         |
| `LOCOMO_RECALL_K`       | 10                         | recall limit (entities returned per query)                                             |
| `LOCOMO_OBS_PER_ENTITY` | 20                         | observations (turns) surfaced per entity — the real retrieval unit here (capped at 20) |
| `LOCOMO_CTX_CHARS`      | 8000                       | max rendered-context chars fed to the answerer                                         |
| `LOCOMO_ANSWER_MODEL`   | `qwen2.5:14b-instruct`     | answerer model                                                                         |
| `LOCOMO_JUDGE_MODEL`    | `qwen2.5:32b-instruct`     | judge model                                                                            |
| `RERANK_ENABLED`        | off                        | `1` (or a model name) turns on the LLM reranker in recall                              |
| `OLLAMA_BASE_URL`       | `http://localhost:11434`   | Ollama endpoint                                                                        |

Results are written to `./results/latest.json` (git-ignored) and a scorecard is printed.

## What it does

1. **Ingest** — per sample, wipe the brain (`resetDb`), then for each session (chronological) write
   every turn as an observation `"{speaker}: {text}"` on a `person` entity named after the speaker,
   with `validFrom` = the session timestamp (exercises Tars's temporal model). Turns are grouped
   per (speaker, session) into one `remember` call so embeddings batch.
2. **Answer** — `memory.recall(question, { limit: k })` → `renderRecallCompact` → a strict
   "answer only from context, else `NO_ANSWER`" prompt to the answerer model.
3. **Judge** — LLM-as-judge (LOCOMO/mem0 standard): question + gold + prediction → YES/NO.
4. **Score** — accuracy per category (1 multi-hop, 2 temporal, 3 open-domain, 4 single-hop,
   5 adversarial) + overall, plus a Tars-specific **retrieval hit-rate** (fraction of answerable
   QA where at least one gold-evidence turn's text made it into the retrieved context).

## Method & caveats (disclose when publishing a number)

- **Ingestion choice.** Every dialogue turn is stored verbatim as its own timestamped observation
  on the speaker entity. We do **not** run fact-extraction/summarization first — this measures raw
  retrieval over the conversation, and is deliberately simpler than systems that pre-distill facts.
- **Entity granularity / `LOCOMO_OBS_PER_ENTITY`.** Because each speaker is a single entity, a
  conversation is just 2 entities and the meaningful retrieval unit is the observation (turn), not
  the entity. So `recall`'s per-entity observation cap — not the entity `limit` (`k`) — governs how
  many candidate turns reach the answerer. We raise it to 20 (recall's hard cap) by default; the
  production default of 3 would surface only ~6 turns and starve the answerer (measured: it drops
  overall accuracy and retrieval hit-rate materially). Disclose this knob's value alongside any
  published number.
- **Category 5 (adversarial) scoring.** These are unanswerable; the correct behaviour is to
  abstain. We score them **in code** (correct IFF the answerer emitted `NO_ANSWER` or a recognized
  abstention phrase) and never send them to the judge. Abstaining on an answerable question (cat
  1–4) is counted wrong without a judge call.
- **Local judge reliability.** The judge is a local `qwen2.5:32b-instruct`, not GPT-4. It is
  cheaper and fully offline but noisier than the hosted judges used in some published LOCOMO
  numbers, so absolute accuracy is not strictly comparable across papers. Keep answerer/judge
  models fixed when comparing Tars configurations.
- **Retrieval hit-rate** is a Tars-specific diagnostic (substring match of gold-evidence turn text
  in the rendered context), not a standard LOCOMO metric. It isolates retrieval quality from
  answerer quality. Adversarial items are excluded from it.
- **Determinism.** Answerer/judge run at temperature 0, but local-model sampling and recall
  fusion are not bit-reproducible across machines/model versions; treat small deltas as noise.
