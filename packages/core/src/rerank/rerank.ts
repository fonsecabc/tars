/**
 * Optional LLM reranker — a second-stage re-scorer over the retrieved candidate pool. Pure
 * lexical/vector/graph retrieval ranks well for name and attribute queries but stumbles on
 * relational ("Bob's manager", "projects run by Acme") and collision ("the Alex who works at
 * Acme") queries, where the ANSWER is a weak surface match sitting next to strong ones. A
 * small local instruct model reorders the top-N candidates by actually reading the query and
 * the candidates' facts. It is injected (like the embedding provider) so `core` stays free of
 * transport/model specifics, and it is opt-in (off → retrieval order is returned unchanged).
 */

/** A text-completion backend (a local instruct model). Returns the model's raw completion. */
export interface RerankLlm {
  complete(prompt: string): Promise<string>;
}

export interface RerankCandidate {
  /** Stable id (entity UUID) to reorder by. */
  id: string;
  /** Compact one-line description shown to the model: `type:name — fact; fact`. */
  label: string;
}

const GUIDE = `You re-rank memory search results. Given a QUERY and a numbered list of CANDIDATES
(each a memory entity with facts), order the candidates from MOST to LEAST relevant to the query.
Reason about relationships and disambiguation:
- "X's manager", "who reports to X", "projects run by Y" — follow the relationship to the right entity.
- Disambiguate people who share a first name by their attributes (role, employer, location).
- Prefer the entity the query is truly ASKING FOR over entities merely mentioned by it.
Return ONLY JSON, no prose, no code fences: {"ranking": ["c3","c1",...]} listing candidate ids
best-first. Include every id exactly once.`;

function extractJsonObject(raw: string): unknown {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('rerank: no JSON object in completion');
  }
  return JSON.parse(raw.slice(start, end + 1));
}

/**
 * Reorder `candidates` by relevance to `query` using the LLM. Returns entity ids best-first.
 * Robust by construction: any model/parse failure falls back to the input order, and ids the
 * model drops are appended in their original order — so a rerank can only reorder, never lose
 * or invent a candidate.
 */
export async function rerankCandidates(
  query: string,
  candidates: readonly RerankCandidate[],
  llm: RerankLlm,
): Promise<string[]> {
  if (candidates.length <= 1) {
    return candidates.map((c) => c.id);
  }
  const idByRef = new Map<string, string>();
  const lines: string[] = [];
  candidates.forEach((c, i) => {
    const ref = `c${i + 1}`;
    idByRef.set(ref, c.id);
    lines.push(`${ref}) ${c.label}`);
  });
  const prompt = `${GUIDE}\n\nQUERY: "${query}"\n\nCANDIDATES:\n${lines.join('\n')}\n\nJSON:`;

  let ranking: string[] = [];
  try {
    const raw = await llm.complete(prompt);
    const parsed = extractJsonObject(raw);
    const order = (parsed as { ranking?: unknown }).ranking;
    if (Array.isArray(order)) {
      ranking = order.filter((r): r is string => typeof r === 'string');
    }
  } catch {
    return candidates.map((c) => c.id);
  }

  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const ref of ranking) {
    const id = idByRef.get(ref.trim());
    if (id !== undefined && !seen.has(id)) {
      ordered.push(id);
      seen.add(id);
    }
  }
  // Append any candidate the model omitted, preserving retrieval order — never drop a result.
  for (const c of candidates) {
    if (!seen.has(c.id)) {
      ordered.push(c.id);
      seen.add(c.id);
    }
  }
  return ordered;
}

export interface OllamaRerankOptions {
  baseUrl?: string | undefined;
  model?: string | undefined;
  /** Abort the generate call after this many ms so a slow model can't wedge recall. */
  timeoutMs?: number | undefined;
}

/**
 * Default rerank deadline. Sized to comfortably clear a healthy reranker (a 14b on GPU takes
 * ~3-4s over a full candidate pool) while still tripping the pathological case — a model
 * offloaded/thrashing at ~0.2 tok/s — before the MCP client's own request timeout fires and
 * makes recall look "down". Past this, retrieval order beats a stalled recall.
 */
const DEFAULT_RERANK_TIMEOUT_MS = 10000;

/** RerankLlm backed by Ollama's `/api/generate` (JSON mode), running on the Mac GPU. */
export class OllamaRerankLlm implements RerankLlm {
  readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: OllamaRerankOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://localhost:11434').replace(/\/+$/, '');
    this.model = options.model ?? 'qwen2.5:14b-instruct';
    this.timeoutMs = options.timeoutMs ?? DEFAULT_RERANK_TIMEOUT_MS;
  }

  async complete(prompt: string): Promise<string> {
    // Bound the call: a slow/overloaded model must fall back to retrieval order (the caller
    // treats any throw as "keep original order"), never block the whole recall path.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          format: 'json',
          options: { temperature: 0 },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Ollama generate failed (${response.status}): ${body.slice(0, 200)} ` +
          `(is the model "${this.model}" pulled? \`ollama pull ${this.model}\`)`,
      );
    }
    const data = (await response.json()) as { response?: string };
    return data.response ?? '';
  }
}
