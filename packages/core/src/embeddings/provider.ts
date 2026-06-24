/**
 * Dimensionality of the observation `embedding vector(N)` column. Providers must emit
 * vectors of exactly this size to be storable; changing it requires a migration.
 * Sized for the default local model `nomic-embed-text` (768).
 */
export const EMBEDDING_DIMENSIONS = 768;

/**
 * Computes embedding vectors for text. Implementations: Ollama (local default), OpenAI
 * (hosted), or `null` — the disabled mode (keyword-only retrieval, zero external calls).
 * The factory {@link embeddingProviderFromEnv} returns `null` for the disabled mode.
 */
export interface EmbeddingProvider {
  /** Stable identifier, e.g. `ollama:nomic-embed-text`. */
  readonly id: string;
  /** Dimensionality of returned vectors; must equal {@link EMBEDDING_DIMENSIONS}. */
  readonly dimensions: number;
  /** Embed a batch of texts, returning one vector per input in the same order. */
  embed(texts: string[]): Promise<number[][]>;
}
