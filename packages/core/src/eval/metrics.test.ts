import { describe, expect, it } from 'vitest';

import { ndcgAtK, precisionAtK, recallAtK, reciprocalRank, scoreCase } from './metrics.js';

describe('recall benchmark metrics', () => {
  it('recallAtK counts relevant within top-k', () => {
    expect(recallAtK(['a', 'b'], ['a', 'x', 'b', 'y'], 2)).toBe(0.5);
    expect(recallAtK(['a', 'b'], ['a', 'x', 'b', 'y'], 4)).toBe(1);
    expect(recallAtK([], ['x'], 3)).toBe(1); // vacuous
  });

  it('precisionAtK divides by k', () => {
    expect(precisionAtK(['a'], ['a', 'x', 'y', 'z', 'w'], 5)).toBeCloseTo(0.2);
    expect(precisionAtK(['a', 'b'], ['a', 'b', 'x', 'y', 'z'], 5)).toBeCloseTo(0.4);
  });

  it('reciprocalRank returns 1/rank of first hit', () => {
    expect(reciprocalRank(['b'], ['a', 'b', 'c'])).toBeCloseTo(0.5);
    expect(reciprocalRank(['a'], ['a', 'b'])).toBe(1);
    expect(reciprocalRank(['z'], ['a', 'b'])).toBe(0);
  });

  it('ndcgAtK rewards ranking relevant items higher', () => {
    const top = ndcgAtK(['a'], ['a', 'x', 'y'], 3);
    const low = ndcgAtK(['a'], ['x', 'y', 'a'], 3);
    expect(top).toBe(1);
    expect(low).toBeLessThan(top);
    expect(low).toBeGreaterThan(0);
    expect(ndcgAtK(['a'], ['x', 'y', 'z'], 3)).toBe(0);
  });

  it('scoreCase composite is 0 for a total miss and 1 for a perfect single hit', () => {
    expect(scoreCase(['a'], ['x', 'y', 'z']).composite).toBe(0);
    const perfect = scoreCase(['a'], ['a']);
    expect(perfect.composite).toBeCloseTo(1);
  });
});
