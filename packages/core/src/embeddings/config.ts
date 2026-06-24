import { OllamaEmbeddingProvider } from './ollama.js';
import { OpenAIEmbeddingProvider } from './openai.js';
import { EMBEDDING_DIMENSIONS, type EmbeddingProvider } from './provider.js';

/**
 * Build an embedding provider from the environment. `EMBEDDING_PROVIDER`:
 *   - `null` (default) / `none` / `disabled` → returns `null`: keyword-only retrieval,
 *     zero external calls.
 *   - `ollama` → local Ollama (`OLLAMA_BASE_URL`, `OLLAMA_EMBEDDING_MODEL`).
 *   - `openai` → hosted OpenAI (`OPENAI_API_KEY`, `OPENAI_EMBEDDING_MODEL`, `OPENAI_BASE_URL`).
 *
 * Returning `null` is the "null impl" of the provider — callers treat it as disabled.
 */
export function embeddingProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): EmbeddingProvider | null {
  const kind = (env.EMBEDDING_PROVIDER ?? 'null').trim().toLowerCase();
  switch (kind) {
    case '':
    case 'null':
    case 'none':
    case 'disabled':
      return null;
    case 'ollama':
      return new OllamaEmbeddingProvider({
        baseUrl: env.OLLAMA_BASE_URL,
        model: env.OLLAMA_EMBEDDING_MODEL,
      });
    case 'openai': {
      const apiKey = env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('EMBEDDING_PROVIDER=openai requires OPENAI_API_KEY to be set');
      }
      return new OpenAIEmbeddingProvider({
        apiKey,
        model: env.OPENAI_EMBEDDING_MODEL,
        baseUrl: env.OPENAI_BASE_URL,
        dimensions: EMBEDDING_DIMENSIONS,
      });
    }
    default:
      throw new Error(`Unknown EMBEDDING_PROVIDER "${kind}" (expected: null | ollama | openai)`);
  }
}
