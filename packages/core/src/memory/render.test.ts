import { describe, expect, it } from 'vitest';

import type { Entity, Observation, Relation } from '../schema/index.js';
import type { RecallResult, RecalledEntity } from './recall.js';
import { NOTHING_RELEVANT, renderRecallCompact } from './render.js';

function entity(id: string, type: string, name: string): Entity {
  const now = new Date('2026-06-29T00:00:00Z');
  return {
    id,
    type,
    name,
    aliases: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

function obs(id: string, entityId: string, text: string): Observation {
  const now = new Date('2026-06-29T00:00:00Z');
  return {
    id,
    entityId,
    text,
    validFrom: now,
    validTo: null,
    recordedAt: now,
    source: 'manual',
    confidence: 1,
    tags: [],
    correctsId: null,
    deletedAt: null,
  };
}

function recalled(e: Entity, observations: Observation[]): RecalledEntity {
  return { entity: e, score: 1, hopDistance: 0, matchedVia: ['keyword'], observations };
}

function relation(id: string, fromEntity: string, toEntity: string, predicate: string): Relation {
  const now = new Date('2026-06-29T00:00:00Z');
  return {
    id,
    fromEntity,
    toEntity,
    predicate,
    validFrom: now,
    validTo: null,
    recordedAt: now,
    metadata: {},
    deletedAt: null,
  };
}

describe('renderRecallCompact', () => {
  it('renders entities as type:name — obs; obs', () => {
    const result: RecallResult = {
      query: 'maria',
      entities: [
        recalled(entity('e1', 'person', 'Maria'), [
          obs('o1', 'e1', 'runs the platform team'),
          obs('o2', 'e1', 'became my manager'),
        ]),
      ],
      relations: [],
    };
    const text = renderRecallCompact(result, { maxChars: 1000 });
    expect(text).toBe('person:Maria — runs the platform team; became my manager');
  });

  it('renders relations by name, not by id', () => {
    const result: RecallResult = {
      query: 'maria',
      entities: [
        recalled(entity('e1', 'person', 'Maria'), []),
        recalled(entity('e2', 'person', 'Caio'), []),
      ],
      relations: [relation('r1', 'e1', 'e2', 'manages')],
    };
    const text = renderRecallCompact(result, { maxChars: 1000 });
    expect(text).toContain('Maria —manages→ Caio');
    expect(text).not.toContain('e1');
    expect(text).not.toContain('r1');
  });

  it('skips a relation when an endpoint is not in the returned set', () => {
    const result: RecallResult = {
      query: 'maria',
      entities: [recalled(entity('e1', 'person', 'Maria'), [])],
      relations: [relation('r1', 'e1', 'eX', 'manages')],
    };
    const text = renderRecallCompact(result, { maxChars: 1000 });
    expect(text).toBe('person:Maria');
  });

  it('returns the sentinel for empty results', () => {
    const result: RecallResult = { query: 'nobody', entities: [], relations: [] };
    expect(renderRecallCompact(result, { maxChars: 1000 })).toBe(NOTHING_RELEVANT);
  });

  it('enforces the budget: keeps the top entity, drops the rest, appends the marker', () => {
    const entities = Array.from({ length: 5 }, (_, i) =>
      recalled(entity(`e${i}`, 'person', `Person${i}`), [obs(`o${i}`, `e${i}`, 'some fact here')]),
    );
    const result: RecallResult = { query: 'people', entities, relations: [] };
    // Budget large enough for ~1 line only.
    const text = renderRecallCompact(result, { maxChars: 40 });
    const lines = text.split('\n');
    expect(lines[0]).toContain('person:Person0');
    expect(text).toMatch(/… \(\d+ more omitted\)$/);
    // 4 entities dropped (relations: 0).
    expect(text).toContain('(4 more omitted)');
  });

  it('always emits the top entity even when it alone exceeds the budget', () => {
    const result: RecallResult = {
      query: 'x',
      entities: [
        recalled(entity('e1', 'person', 'Maria'), [
          obs('o1', 'e1', 'a very long observation that is well beyond the tiny budget given'),
        ]),
        recalled(entity('e2', 'person', 'Other'), []),
      ],
      relations: [],
    };
    const text = renderRecallCompact(result, { maxChars: 5 });
    expect(text.startsWith('person:Maria —')).toBe(true);
    expect(text).toContain('(1 more omitted)');
  });

  it('keeps content within budget when everything fits (no marker)', () => {
    const result: RecallResult = {
      query: 'maria',
      entities: [recalled(entity('e1', 'person', 'Maria'), [obs('o1', 'e1', 'fact')])],
      relations: [],
    };
    const text = renderRecallCompact(result, { maxChars: 1000 });
    expect(text.length).toBeLessThanOrEqual(1000);
    expect(text).not.toContain('omitted');
  });
});
