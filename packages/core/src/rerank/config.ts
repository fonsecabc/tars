import { OllamaRerankLlm, type RerankLlm } from './rerank.js';

/**
 * Build the local-LLM reranker from the environment, or `null` when disabled (the default).
 * Opt-in via `RERANK_ENABLED` because it adds an LLM call per recall (latency) and requires a
 * pulled Ollama instruct model. Worth it on the small-model serving path, where getting the
 * right few entities into a tight context matters more than the extra second.
 */
export function rerankLlmFromEnv(env: NodeJS.ProcessEnv = process.env): RerankLlm | null {
  const flag = (env.RERANK_ENABLED ?? '').trim().toLowerCase();
  if (flag !== '1' && flag !== 'true' && flag !== 'yes') {
    return null;
  }
  const timeoutRaw = Number(env.OLLAMA_RERANK_TIMEOUT_MS);
  return new OllamaRerankLlm({
    baseUrl: env.OLLAMA_BASE_URL,
    model: env.OLLAMA_RERANK_MODEL,
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : undefined,
  });
}
