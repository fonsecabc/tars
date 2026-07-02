/**
 * Recall defaults resolved from the environment. The MCP layer is the boundary that may
 * read `process.env` (core stays pure); these defaults shape the `memory_recall` output so
 * an operator can tune a deployment for small / local models without code changes. Per-call
 * tool arguments always override these.
 */
export interface RecallDefaults {
  /** Output shape: 'json' (full, with ids — for tool-using models) or 'compact' (terse text). */
  format: 'json' | 'compact';
  /** Character ceiling for compact rendering. */
  maxChars: number;
  /** Default max entities returned. */
  limit: number;
  /** Default observations attached per entity. */
  observationsPerEntity: number;
  /** Default graph expansion hops. */
  graphDepth: number;
  /** Default relevance floor (0 disables). */
  scoreFloor: number;
  /** RRF fusion constant k. */
  rrfK: number;
}

type Env = Record<string, string | undefined>;

function intFromEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function floatFromEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Read recall defaults from the environment, falling back to the same values the engine
 * uses today (so omitting every var leaves behaviour unchanged).
 */
// NOTE: the retrieval-quality constants tuned on the recall benchmark — signal weights,
// graph spreading-activation decay, and the exact-match bonus — are intentionally NOT env
// vars. They are baked defaults in `@tars/core`'s `recall()` (changing them shifts ranking
// quality, so they belong under the benchmark's guard, not loose operator config). Only the
// output-shape / budget knobs below are environment-tunable.
export function recallDefaultsFromEnv(env: Env = process.env): RecallDefaults {
  return {
    format: env.TARS_RECALL_FORMAT === 'compact' ? 'compact' : 'json',
    maxChars: intFromEnv(env.TARS_RECALL_MAX_CHARS, 4000),
    limit: intFromEnv(env.TARS_RECALL_LIMIT, 10),
    observationsPerEntity: intFromEnv(env.TARS_RECALL_OBS_PER_ENTITY, 3),
    graphDepth: intFromEnv(env.TARS_RECALL_GRAPH_DEPTH, 1),
    scoreFloor: floatFromEnv(env.TARS_RECALL_SCORE_FLOOR, 0),
    rrfK: intFromEnv(env.TARS_RRF_K, 60),
  };
}
