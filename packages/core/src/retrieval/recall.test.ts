import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { link, recall, remember } from '../index.js';
import { closeTestPool, getTestPool, resetDb } from '../test-helpers/db.js';

const pool = getTestPool();

beforeEach(async () => {
  await resetDb(pool);
});

afterAll(async () => {
  await closeTestPool();
});

describe('recall — keyword', () => {
  it('ranks the entity whose observation matches the query', async () => {
    await remember(pool, {
      entity: { type: 'person', name: 'Person:A' },
      observations: [{ text: 'loves hiking in the mountains' }],
    });
    await remember(pool, {
      entity: { type: 'person', name: 'Person:B' },
      observations: [{ text: 'enjoys cooking pasta at home' }],
    });

    const result = await recall(pool, 'hiking', { includeGraph: false });
    expect(result.entities[0]?.entity.name).toBe('Person:A');
    expect(result.entities.map((e) => e.entity.name)).not.toContain('Person:B');
  });

  it('matches an entity by name (full-text / trigram)', async () => {
    await remember(pool, {
      entity: { type: 'project', name: 'Project:Apollo' },
      observations: [{ text: 'a moonshot' }],
    });
    const result = await recall(pool, 'Apollo', { includeGraph: false });
    expect(result.entities[0]?.entity.name).toBe('Project:Apollo');
  });

  it('filters by entity type', async () => {
    await remember(pool, {
      entity: { type: 'person', name: 'Alpha' },
      observations: [{ text: 'shared distinctive token' }],
    });
    await remember(pool, {
      entity: { type: 'project', name: 'Beta' },
      observations: [{ text: 'shared distinctive token' }],
    });
    const result = await recall(pool, 'distinctive token', {
      includeGraph: false,
      types: ['project'],
    });
    expect(result.entities.map((e) => e.entity.type)).toEqual(['project']);
  });
});

describe('recall — graph expansion + RRF', () => {
  it('pulls in graph-connected entities and returns connecting relations', async () => {
    const a = await remember(pool, {
      entity: { type: 'person', name: 'Person:A' },
      observations: [{ text: 'trained as an astronaut' }],
    });
    const x = await remember(pool, {
      entity: { type: 'project', name: 'Project:X' },
      observations: [{ text: 'a rocket program' }],
    });
    await link(pool, { fromEntity: a.entity.id, toEntity: x.entity.id, predicate: 'works_on' });

    const result = await recall(pool, 'astronaut', { includeGraph: true, graphDepth: 1 });
    const names = result.entities.map((e) => e.entity.name);
    expect(names).toContain('Person:A');
    expect(names).toContain('Project:X');

    const projectX = result.entities.find((e) => e.entity.name === 'Project:X');
    expect(projectX?.hopDistance).toBe(1);
    expect(projectX?.matchedVia).toContain('graph');

    expect(result.relations.some((r) => r.predicate === 'works_on')).toBe(true);
  });

  it('ranks an entity matched by both name and observation above one matched by only an observation', async () => {
    await remember(pool, {
      entity: { type: 'event', name: 'Aurora' },
      observations: [{ text: 'aurora borealis display' }],
    });
    await remember(pool, {
      entity: { type: 'person', name: 'Person:B' },
      observations: [{ text: 'witnessed an aurora once' }],
    });
    const result = await recall(pool, 'aurora', { includeGraph: false });
    expect(result.entities[0]?.entity.name).toBe('Aurora');
  });
});

describe('recall — bi-temporal', () => {
  it('respects asOf for point-in-time recall', async () => {
    const a = await remember(pool, {
      entity: { type: 'person', name: 'Person:A' },
      observations: [
        {
          text: 'lived in the northern city',
          validFrom: new Date('2018-01-01T00:00:00Z'),
          validTo: new Date('2020-01-01T00:00:00Z'),
        },
      ],
    });
    await remember(pool, {
      entity: { id: a.entity.id },
      observations: [
        { text: 'lived in the southern town', validFrom: new Date('2020-01-01T00:00:00Z') },
      ],
    });

    const past = await recall(pool, 'lived', {
      includeGraph: false,
      asOf: new Date('2019-01-01T00:00:00Z'),
    });
    const texts = past.entities[0]?.observations.map((o) => o.text) ?? [];
    expect(texts).toContain('lived in the northern city');
    expect(texts).not.toContain('lived in the southern town');
  });
});
