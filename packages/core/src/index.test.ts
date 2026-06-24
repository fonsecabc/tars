import { describe, expect, it } from 'vitest';

import { CORE_VERSION, coreName } from './index.js';

describe('core scaffold', () => {
  it('exposes a version', () => {
    expect(CORE_VERSION).toBe('0.0.0');
  });

  it('returns its name', () => {
    expect(coreName()).toBe('tars-core');
  });
});
