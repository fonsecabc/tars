/**
 * Hermetic tests for the two embedding providers and the env-driven config resolvers.
 * No Postgres and no network: `fetch` is stubbed per-test, so these cover the HTTP shapes
 * (batching, non-2xx, malformed/short responses) that the integration suite never exercises.
 */
import { databaseUrlFromEnv, embeddings, extractionLlmFromEnv, rerankLlmFromEnv } from '@tars/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { OllamaEmbeddingProvider, OpenAIEmbeddingProvider } = embeddings;

/** Stub global fetch with a canned response; returns the spy so callers can assert the request. */
function stubFetch(body: unknown, init: { ok?: boolean; status?: number; text?: string } = {}) {
  // Declare the (url, init) params so `spy.mock.calls[0][0]` is typed as the request URL.
  const spy = vi.fn(async (_url: string, _requestInit?: RequestInit) => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => init.text ?? JSON.stringify(body),
  }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('databaseUrlFromEnv', () => {
  it('prefers an explicit DATABASE_URL', () => {
    expect(databaseUrlFromEnv({ DATABASE_URL: 'postgresql://u:p@h:1/db' })).toBe(
      'postgresql://u:p@h:1/db',
    );
  });

  it('assembles a URL from the discrete POSTGRES_* vars', () => {
    expect(
      databaseUrlFromEnv({
        POSTGRES_USER: 'alice',
        POSTGRES_PASSWORD: 'secret',
        POSTGRES_HOST: 'db.internal',
        POSTGRES_PORT: '6543',
        POSTGRES_DB: 'brain',
      }),
    ).toBe('postgresql://alice:secret@db.internal:6543/brain');
  });

  it('falls back to dev defaults when nothing is set', () => {
    expect(databaseUrlFromEnv({})).toBe(
      'postgresql://tars:tars_dev_password_change_me@localhost:5432/tars',
    );
  });
});

describe('rerankLlmFromEnv', () => {
  it('is disabled by default', () => {
    expect(rerankLlmFromEnv({})).toBeNull();
    expect(rerankLlmFromEnv({ RERANK_ENABLED: '0' })).toBeNull();
  });

  it('accepts the documented truthy spellings, case-insensitively', () => {
    for (const flag of ['1', 'true', 'YES', ' True ']) {
      expect(rerankLlmFromEnv({ RERANK_ENABLED: flag })).not.toBeNull();
    }
  });

  it('ignores a non-numeric or non-positive timeout rather than passing it through', () => {
    // Guards the `Number.isFinite && > 0` branch: a bad value must fall back to the default,
    // never become NaN/0 and abort every rerank instantly.
    for (const bad of ['abc', '0', '-5']) {
      expect(
        rerankLlmFromEnv({ RERANK_ENABLED: '1', OLLAMA_RERANK_TIMEOUT_MS: bad }),
      ).not.toBeNull();
    }
  });
});

describe('extractionLlmFromEnv', () => {
  it('is disabled by default', () => {
    expect(extractionLlmFromEnv({})).toBeNull();
    expect(extractionLlmFromEnv({ EXTRACTION_ENABLED: 'no' })).toBeNull();
  });

  it('builds an extractor when explicitly enabled', () => {
    expect(extractionLlmFromEnv({ EXTRACTION_ENABLED: 'true' })).not.toBeNull();
  });
});

describe('OllamaEmbeddingProvider', () => {
  it('derives its id from the model and trims a trailing slash off the base URL', async () => {
    const provider = new OllamaEmbeddingProvider({ baseUrl: 'http://host:11434///' });
    expect(provider.id).toBe('ollama:nomic-embed-text');

    const spy = stubFetch({ embeddings: [[1, 2]] });
    await provider.embed(['a']);
    expect(spy.mock.calls[0]?.[0]).toBe('http://host:11434/api/embed');
  });

  it('short-circuits an empty batch without calling the network', async () => {
    const spy = stubFetch({});
    expect(await new OllamaEmbeddingProvider().embed([])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns one vector per input', async () => {
    stubFetch({ embeddings: [[1], [2]] });
    expect(await new OllamaEmbeddingProvider().embed(['a', 'b'])).toEqual([[1], [2]]);
  });

  it('throws on a non-2xx response', async () => {
    stubFetch({}, { ok: false, status: 500, text: 'boom' });
    await expect(new OllamaEmbeddingProvider().embed(['a'])).rejects.toThrow(/500/);
  });

  it('throws when the count does not match, naming the model to pull', async () => {
    stubFetch({ embeddings: [[1]] });
    await expect(new OllamaEmbeddingProvider().embed(['a', 'b'])).rejects.toThrow(
      /ollama pull nomic-embed-text/,
    );
  });
});

describe('OpenAIEmbeddingProvider', () => {
  it('sends the key, model and requested dimensions', async () => {
    const spy = stubFetch({ data: [{ embedding: [0.5] }] });
    const provider = new OpenAIEmbeddingProvider({
      apiKey: 'sk-test',
      model: 'text-embedding-3-large',
    });
    expect(provider.id).toBe('openai:text-embedding-3-large');

    await provider.embed(['hello']);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/embeddings');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent.model).toBe('text-embedding-3-large');
    expect(sent.dimensions).toBe(provider.dimensions);
  });

  it('honours an OpenAI-compatible base URL', async () => {
    const spy = stubFetch({ data: [{ embedding: [1] }] });
    await new OpenAIEmbeddingProvider({ apiKey: 'k', baseUrl: 'https://proxy.local/v1/' }).embed([
      'a',
    ]);
    expect(spy.mock.calls[0]?.[0]).toBe('https://proxy.local/v1/embeddings');
  });

  it('short-circuits an empty batch without calling the network', async () => {
    const spy = stubFetch({});
    expect(await new OpenAIEmbeddingProvider({ apiKey: 'k' }).embed([])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws on a non-2xx response', async () => {
    stubFetch({}, { ok: false, status: 401, text: 'unauthorized' });
    await expect(new OpenAIEmbeddingProvider({ apiKey: 'bad' }).embed(['a'])).rejects.toThrow(
      /401/,
    );
  });

  it('throws when the provider returns fewer rows than inputs', async () => {
    stubFetch({ data: [{ embedding: [1] }] });
    await expect(new OpenAIEmbeddingProvider({ apiKey: 'k' }).embed(['a', 'b'])).rejects.toThrow(
      /1 embeddings for 2 inputs/,
    );
  });
});
