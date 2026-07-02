import { describe, expect, it } from 'vitest';

import { rankByScore, rrfFuse } from './rrf.js';

describe('rrfFuse', () => {
  it('rewards items that appear in multiple lists', () => {
    const ranked = rankByScore(
      rrfFuse([
        ['x', 'y', 'z'],
        ['y', 'x', 'w'],
      ]),
    );
    // x and y appear in both lists; z and w in only one.
    expect(new Set(ranked.slice(0, 2))).toEqual(new Set(['x', 'y']));
    expect(ranked.indexOf('x')).toBeLessThan(ranked.indexOf('z'));
    expect(ranked.indexOf('y')).toBeLessThan(ranked.indexOf('w'));
  });

  it('ranks a top-of-both item above a top-of-one item', () => {
    const ranked = rankByScore(
      rrfFuse([
        ['top', 'other'],
        ['top', 'second'],
      ]),
    );
    expect(ranked[0]).toBe('top');
  });

  it('handles empty lists', () => {
    expect(rankByScore(rrfFuse([[], []]))).toEqual([]);
  });

  it('lets a per-list weight break a cross-list tie', () => {
    // 'a' leads list 0, 'b' leads list 1 — symmetric, so unweighted they tie.
    const lists = [
      ['a', 'b'],
      ['b', 'a'],
    ];
    // Weight list 0 higher: 'a' (top of the trusted list) must win.
    const ranked = rankByScore(rrfFuse(lists, 60, [3, 1]));
    expect(ranked[0]).toBe('a');
  });
});
