import {
  EMBEDDING_DIMENSIONS,
  backfillEmbeddings,
  createMemory,
  embeddingProviderFromEnv,
  embeddings,
  store,
} from '@tars/core';
import { FakeEmbeddingProvider, closeTestPool, getTestPool, resetDb } from '@tars/core/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const pool = getTestPool();

beforeEach(async () => {
  await resetDb(pool);
});

afterAll(async () => {
  await closeTestPool();
});

describe('embeddingProviderFromEnv', () => {
  it('returns null (disabled) by default', () => {
    expect(embeddingProviderFromEnv({})).toBeNull();
    expect(embeddingProviderFromEnv({ EMBEDDING_PROVIDER: 'null' })).toBeNull();
  });

  it('builds a local Ollama provider sized for the column', () => {
    const provider = embeddingProviderFromEnv({ EMBEDDING_PROVIDER: 'ollama' });
    expect(provider).toBeInstanceOf(embeddings.OllamaEmbeddingProvider);
    expect(provider?.id).toBe('ollama:nomic-embed-text');
    expect(provider?.dimensions).toBe(EMBEDDING_DIMENSIONS);
  });

  it('requires an API key for the hosted provider', () => {
    expect(() => embeddingProviderFromEnv({ EMBEDDING_PROVIDER: 'openai' })).toThrow(
      /OPENAI_API_KEY/,
    );
  });

  it('rejects an unknown provider', () => {
    expect(() => embeddingProviderFromEnv({ EMBEDDING_PROVIDER: 'bogus' })).toThrow();
  });
});

describe('toVectorLiteral', () => {
  it('formats a pgvector literal', () => {
    expect(embeddings.toVectorLiteral([0.5, -1, 2])).toBe('[0.5,-1,2]');
  });
});

describe('keyword-only mode (embeddings disabled)', () => {
  it('remembers and recalls without storing vectors', async () => {
    const memory = createMemory(pool);
    expect(memory.embeddingsEnabled).toBe(false);

    await memory.remember({
      entity: { type: 'person', name: 'Person:A' },
      observations: [{ text: 'enjoys mountain trekking' }],
    });

    const recalled = await memory.recall('trekking', { includeGraph: false });
    expect(recalled.entities[0]?.entity.name).toBe('Person:A');

    // Nothing embedded → the observation is on the backfill work-list.
    const pending = await store.listObservationsNeedingEmbedding(pool);
    expect(pending).toHaveLength(1);
  });
});

describe('vector retrieval (embeddings enabled)', () => {
  it('embeds on write and recalls semantically, beyond keyword reach', async () => {
    // Pin "cat" and "feline companion" to the same vector — cosine-identical.
    const fake = new FakeEmbeddingProvider({ cat: [1], 'feline companion': [1] });
    const memory = createMemory(pool, { embeddings: fake });
    expect(memory.embeddingsEnabled).toBe(true);

    await memory.remember({
      entity: { type: 'person', name: 'Person:A' },
      observations: [{ text: 'feline companion' }],
    });
    await memory.remember({
      entity: { type: 'person', name: 'Person:B' },
      observations: [{ text: 'loud machinery' }],
    });

    // Keyword search for "cat" matches neither observation nor entity name.
    const keywordOnly = createMemory(pool);
    const kw = await keywordOnly.recall('cat', { includeGraph: false });
    expect(kw.entities).toHaveLength(0);

    // The vector signal surfaces the semantically-nearest entity first.
    const recalled = await memory.recall('cat', { includeGraph: false });
    expect(recalled.entities[0]?.entity.name).toBe('Person:A');
    expect(recalled.entities[0]?.matchedVia).toContain('vector');

    // Everything was embedded on write.
    const pending = await store.listObservationsNeedingEmbedding(pool);
    expect(pending).toHaveLength(0);
  });
});

describe('backfillEmbeddings', () => {
  it('fills vectors for pre-existing observations, idempotently', async () => {
    // Write WITHOUT a provider so observations land with NULL embeddings.
    const writer = createMemory(pool);
    await writer.remember({
      entity: { type: 'project', name: 'Project:X' },
      observations: [{ text: 'alpha objective' }, { text: 'omega milestone' }],
    });
    expect(await store.listObservationsNeedingEmbedding(pool)).toHaveLength(2);

    const result = await backfillEmbeddings(pool, new FakeEmbeddingProvider());
    expect(result.embedded).toBe(2);
    expect(await store.listObservationsNeedingEmbedding(pool)).toHaveLength(0);

    // Running again is a no-op (nothing left to embed).
    expect((await backfillEmbeddings(pool, new FakeEmbeddingProvider())).embedded).toBe(0);
  });
});
