export { EMBEDDING_DIMENSIONS, type EmbeddingProvider } from './provider.js';
export { toVectorLiteral } from './vector-literal.js';
export { OllamaEmbeddingProvider, type OllamaOptions } from './ollama.js';
export { OpenAIEmbeddingProvider, type OpenAIOptions } from './openai.js';
export { embeddingProviderFromEnv } from './config.js';
export {
  embedObservations,
  backfillEmbeddings,
  type BackfillOptions,
  type BackfillResult,
} from './backfill.js';
