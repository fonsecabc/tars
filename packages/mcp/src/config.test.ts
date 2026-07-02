import { describe, expect, it } from 'vitest';

import { recallDefaultsFromEnv } from './config.js';

describe('recallDefaultsFromEnv', () => {
  it('returns engine-matching defaults for an empty env', () => {
    expect(recallDefaultsFromEnv({})).toEqual({
      format: 'json',
      maxChars: 4000,
      limit: 10,
      observationsPerEntity: 3,
      graphDepth: 1,
      scoreFloor: 0,
      rrfK: 60,
    });
  });

  it('applies overrides', () => {
    const d = recallDefaultsFromEnv({
      TARS_RECALL_FORMAT: 'compact',
      TARS_RECALL_MAX_CHARS: '1500',
      TARS_RECALL_LIMIT: '8',
      TARS_RECALL_OBS_PER_ENTITY: '2',
      TARS_RECALL_GRAPH_DEPTH: '2',
      TARS_RECALL_SCORE_FLOOR: '0.3',
      TARS_RRF_K: '40',
    });
    expect(d).toEqual({
      format: 'compact',
      maxChars: 1500,
      limit: 8,
      observationsPerEntity: 2,
      graphDepth: 2,
      scoreFloor: 0.3,
      rrfK: 40,
    });
  });

  it('ignores garbage values and an unknown format', () => {
    const d = recallDefaultsFromEnv({
      TARS_RECALL_FORMAT: 'yaml',
      TARS_RECALL_MAX_CHARS: 'nope',
      TARS_RECALL_SCORE_FLOOR: 'NaN',
    });
    expect(d.format).toBe('json');
    expect(d.maxChars).toBe(4000);
    expect(d.scoreFloor).toBe(0);
  });
});
