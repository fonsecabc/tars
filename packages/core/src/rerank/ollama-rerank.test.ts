/**
 * Hermetic tests for the Ollama-backed rerank LLM. `rerank.test.ts` covers the pure
 * reordering logic with a fake LLM; this covers the HTTP client around it — request shape,
 * the timeout guard, and the failure modes that must surface as throws so `rerankCandidates`
 * degrades to retrieval order instead of wedging recall.
 */
import { OllamaRerankLlm, rerankCandidates } from '@tars/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

function stubFetch(body: unknown, init: { ok?: boolean; status?: number; text?: string } = {}) {
  const spy = vi.fn(async () => ({
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

describe('OllamaRerankLlm', () => {
  it('defaults to a local base URL and the tuned instruct model', () => {
    expect(new OllamaRerankLlm().model).toBe('qwen2.5:14b-instruct');
  });

  it('posts a deterministic JSON-mode generate request and returns the completion', async () => {
    const spy = stubFetch({ response: '{"ranking":["c1"]}' });
    const out = await new OllamaRerankLlm({ baseUrl: 'http://gpu.local:11434/' }).complete(
      'rank this',
    );

    expect(out).toBe('{"ranking":["c1"]}');
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://gpu.local:11434/api/generate');
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent.stream).toBe(false);
    expect(sent.format).toBe('json');
    expect(sent.prompt).toBe('rank this');
    // temperature 0: reranking must be reproducible run to run.
    expect((sent.options as { temperature: number }).temperature).toBe(0);
    expect(init.signal).toBeDefined();
  });

  it('returns an empty string when the model omits a response field', async () => {
    stubFetch({});
    expect(await new OllamaRerankLlm().complete('p')).toBe('');
  });

  it('throws on a non-2xx, naming the model to pull', async () => {
    stubFetch({}, { ok: false, status: 404, text: 'model not found' });
    await expect(new OllamaRerankLlm({ model: 'missing:7b' }).complete('p')).rejects.toThrow(
      /ollama pull missing:7b/,
    );
  });

  it('aborts once the deadline passes rather than hanging recall', async () => {
    // A model that never answers: the AbortController must fire and reject.
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    await expect(new OllamaRerankLlm({ timeoutMs: 10 }).complete('p')).rejects.toThrow();
  });

  it('degrades to retrieval order when the backend fails', async () => {
    // The contract that matters end to end: a dead reranker must not lose candidates.
    stubFetch({}, { ok: false, status: 500, text: 'boom' });
    const candidates = [
      { id: 'a', label: 'person:A' },
      { id: 'b', label: 'person:B' },
    ];
    expect(await rerankCandidates('who', candidates, new OllamaRerankLlm())).toEqual(['a', 'b']);
  });
});
