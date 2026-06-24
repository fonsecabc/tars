/**
 * @tars/core — the transport-agnostic memory engine.
 *
 * Public surface: schema (types + zod validators), error types, the high-level memory
 * write operations (remember/link/correct/forget/define-*), the lower-level `store`
 * repositories (namespaced), and db helpers. Knows nothing about HTTP/OAuth/transport.
 */

export const CORE_VERSION = '0.0.0';

/** Sanity-check export retained from scaffolding; exercised by the package tests. */
export function coreName(): string {
  return 'tars-core';
}

export * from './errors.js';
export * from './schema/index.js';
export * from './memory/index.js';
export {
  createPool,
  withTransaction,
  runMigrations,
  databaseUrlFromEnv,
  type Queryable,
} from './db/index.js';
export * as store from './store/index.js';
export * as retrieval from './retrieval/index.js';
export * as embeddings from './embeddings/index.js';
export * as mirror from './mirror/index.js';
export * as extraction from './extraction/index.js';
export {
  extractFacts,
  applyProposal,
  extractionLlmFromEnv,
  type ExtractionLlm,
  type ExtractionProposal,
  type ApplyResult,
} from './extraction/index.js';
export {
  writeMirror,
  gitCommitMirror,
  type MirrorResult,
  type WriteMirrorOptions,
} from './mirror/index.js';
export {
  embeddingProviderFromEnv,
  backfillEmbeddings,
  embedObservations,
  EMBEDDING_DIMENSIONS,
  type EmbeddingProvider,
  type BackfillOptions,
  type BackfillResult,
} from './embeddings/index.js';
