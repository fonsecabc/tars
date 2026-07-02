import { describe, expect, it } from 'vitest';

import { rerankCandidates, type RerankCandidate, type RerankLlm } from './rerank.js';

const CANDS: RerankCandidate[] = [
  { id: 'id-ana', label: 'person:Ana — engineer' },
  { id: 'id-bob', label: 'person:Bob — junior' },
  { id: 'id-grace', label: 'person:Grace — VP' },
];

/** A fake LLM that echoes a fixed ranking (no network) — keeps the test hermetic. */
class FakeLlm implements RerankLlm {
  constructor(private readonly raw: string) {}
  complete(): Promise<string> {
    return Promise.resolve(this.raw);
  }
}

describe('rerankCandidates', () => {
  it('reorders by the model ranking', async () => {
    const order = await rerankCandidates('x', CANDS, new FakeLlm('{"ranking":["c3","c1","c2"]}'));
    expect(order).toEqual(['id-grace', 'id-ana', 'id-bob']);
  });

  it('appends candidates the model omits, preserving retrieval order', async () => {
    const order = await rerankCandidates('x', CANDS, new FakeLlm('{"ranking":["c2"]}'));
    expect(order).toEqual(['id-bob', 'id-ana', 'id-grace']);
  });

  it('falls back to retrieval order on unparseable output', async () => {
    const order = await rerankCandidates('x', CANDS, new FakeLlm('not json at all'));
    expect(order).toEqual(['id-ana', 'id-bob', 'id-grace']);
  });

  it('ignores unknown/duplicate refs and never invents or drops ids', async () => {
    const order = await rerankCandidates(
      'x',
      CANDS,
      new FakeLlm('{"ranking":["c9","c2","c2","c1"]}'),
    );
    expect(order).toEqual(['id-bob', 'id-ana', 'id-grace']);
    expect(new Set(order)).toEqual(new Set(['id-ana', 'id-bob', 'id-grace']));
  });

  it('returns the single id without calling out for one candidate', async () => {
    const order = await rerankCandidates('x', [CANDS[0]!], new FakeLlm('boom'));
    expect(order).toEqual(['id-ana']);
  });
});
