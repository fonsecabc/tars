import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { EntityNotFoundError } from '../errors.js';
import {
  correct,
  defineEntityType,
  defineRelationPredicate,
  forget,
  link,
  remember,
} from './index.js';
import { closeTestPool, getTestPool, resetDb } from '../test-helpers/db.js';
import * as store from '../store/index.js';

const pool = getTestPool();

beforeEach(async () => {
  await resetDb(pool);
});

afterAll(async () => {
  await closeTestPool();
});

describe('memory.remember', () => {
  it('creates an entity + observations, auto-registers the type, bumps usage, audits', async () => {
    const result = await remember(pool, {
      entity: { type: 'person', name: 'Person:A' },
      observations: [{ text: 'likes tea' }, { text: 'works remotely' }],
      source: 'manual',
    });

    expect(result.entityCreated).toBe(true);
    expect(result.observations).toHaveLength(2);

    const type = await store.getEntityType(pool, 'person');
    expect(type?.usageCount).toBe(1);

    const audit = await store.listAudit(pool, { targetKind: 'entity' });
    expect(audit.some((a) => a.action === 'entity.create')).toBe(true);
    const obsAudit = await store.listAudit(pool, { targetKind: 'observation' });
    expect(obsAudit.filter((a) => a.action === 'observation.create')).toHaveLength(2);
  });

  it('reuses an existing entity when matched by type + name (case-insensitive)', async () => {
    const first = await remember(pool, {
      entity: { type: 'person', name: 'Person:A' },
      observations: [{ text: 'first' }],
    });
    const second = await remember(pool, {
      entity: { type: 'person', name: 'person:a' },
      observations: [{ text: 'second' }],
    });

    expect(second.entityCreated).toBe(false);
    expect(second.entity.id).toBe(first.entity.id);

    const type = await store.getEntityType(pool, 'person');
    expect(type?.usageCount).toBe(1);

    const observations = await store.listObservationsByEntity(pool, first.entity.id);
    expect(observations).toHaveLength(2);
  });

  it('normalizes invented entity types to snake_case', async () => {
    const result = await remember(pool, {
      entity: { type: 'Health Event', name: 'Checkup' },
      observations: [{ text: 'routine' }],
    });
    expect(result.entity.type).toBe('health_event');
    const type = await store.getEntityType(pool, 'health_event');
    expect(type).toBeDefined();
  });

  it('throws when remembering against an unknown entity id', async () => {
    await expect(
      remember(pool, {
        entity: { id: '00000000-0000-0000-0000-000000000000' },
        observations: [{ text: 'orphan' }],
      }),
    ).rejects.toBeInstanceOf(EntityNotFoundError);
  });
});

describe('memory.link', () => {
  it('links two entities, registers the predicate, bumps usage, audits', async () => {
    const a = await remember(pool, {
      entity: { type: 'person', name: 'Person:A' },
      observations: [],
    });
    const x = await remember(pool, {
      entity: { type: 'project', name: 'Project:X' },
      observations: [],
    });

    const relation = await link(pool, {
      fromEntity: a.entity.id,
      toEntity: x.entity.id,
      predicate: 'works on',
    });
    expect(relation.predicate).toBe('works_on');

    const predicates = await store.listRelationPredicates(pool);
    expect(predicates.find((p) => p.name === 'works_on')?.usageCount).toBe(1);

    const relations = await store.listRelationsByEntity(pool, a.entity.id);
    expect(relations).toHaveLength(1);

    const audit = await store.listAudit(pool, { targetKind: 'relation' });
    expect(audit[0]?.action).toBe('relation.create');
  });

  it('throws when an endpoint does not exist', async () => {
    const a = await remember(pool, {
      entity: { type: 'person', name: 'Person:A' },
      observations: [],
    });
    await expect(
      link(pool, {
        fromEntity: a.entity.id,
        toEntity: '00000000-0000-0000-0000-000000000000',
        predicate: 'knows',
      }),
    ).rejects.toBeInstanceOf(EntityNotFoundError);
  });
});

describe('memory.correct (bi-temporal supersede)', () => {
  it('closes the old fact, links the new one, and preserves point-in-time history', async () => {
    const a = await remember(pool, {
      entity: { type: 'person', name: 'Person:A' },
      observations: [{ text: 'lives in Place:1', validFrom: new Date('2020-01-01T00:00:00Z') }],
    });
    const original = a.observations[0]!;

    const at = new Date('2022-01-01T00:00:00Z');
    const { superseded, created } = await correct(pool, {
      observationId: original.id,
      text: 'lives in Place:2',
      validFrom: at,
    });

    expect(superseded.validTo?.toISOString()).toBe(at.toISOString());
    expect(created.correctsId).toBe(original.id);
    expect(created.validTo).toBeNull();

    // What was true in 2021 vs now.
    const past = await store.listObservationsByEntity(pool, a.entity.id, {
      asOf: new Date('2021-01-01T00:00:00Z'),
    });
    expect(past.map((o) => o.text)).toEqual(['lives in Place:1']);

    const current = await store.listObservationsByEntity(pool, a.entity.id, { onlyCurrent: true });
    expect(current.map((o) => o.text)).toEqual(['lives in Place:2']);

    const audit = await store.listAudit(pool, { targetKind: 'observation' });
    expect(audit.some((entry) => entry.action === 'observation.supersede')).toBe(true);
  });
});

describe('memory.forget', () => {
  it('soft-deletes an entity by default (recoverable, hidden, audited)', async () => {
    const a = await remember(pool, {
      entity: { type: 'person', name: 'Person:A' },
      observations: [{ text: 'fact' }],
    });

    const result = await forget(pool, { kind: 'entity', id: a.entity.id });
    expect(result).toEqual({ deleted: true, hard: false });
    expect(await store.findEntityById(pool, a.entity.id)).toBeUndefined();
    expect(await store.findEntityById(pool, a.entity.id, { includeDeleted: true })).toBeDefined();

    const audit = await store.listAudit(pool, { targetId: a.entity.id });
    expect(audit.some((entry) => entry.action === 'entity.soft_delete')).toBe(true);
  });

  it('hard-deletes an entity, cascading observations and decrementing type usage', async () => {
    const a = await remember(pool, {
      entity: { type: 'person', name: 'Person:A' },
      observations: [{ text: 'fact' }],
    });
    expect((await store.getEntityType(pool, 'person'))?.usageCount).toBe(1);

    const result = await forget(pool, { kind: 'entity', id: a.entity.id, hard: true });
    expect(result.deleted).toBe(true);
    expect(await store.findEntityById(pool, a.entity.id, { includeDeleted: true })).toBeUndefined();
    expect(await store.listObservationsByEntity(pool, a.entity.id)).toHaveLength(0);
    expect((await store.getEntityType(pool, 'person'))?.usageCount).toBe(0);
  });
});

describe('memory.define*', () => {
  it('describes an entity type and a relation predicate, with audit', async () => {
    const type = await defineEntityType(pool, 'recipe', 'A set of cooking instructions.');
    expect(type.name).toBe('recipe');
    expect(type.description).toBe('A set of cooking instructions.');

    const predicate = await defineRelationPredicate(
      pool,
      'introduced_by',
      'X was introduced by Y.',
    );
    expect(predicate.name).toBe('introduced_by');

    const audit = await store.listAudit(pool);
    expect(audit.some((entry) => entry.action === 'entity_type.define')).toBe(true);
    expect(audit.some((entry) => entry.action === 'relation_predicate.define')).toBe(true);
  });
});
