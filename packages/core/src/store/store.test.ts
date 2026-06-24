import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeTestPool, getTestPool, resetDb } from '../test-helpers/db.js';
import {
  appendAudit,
  ensureEntityType,
  findEntityById,
  hardDeleteEntity,
  insertEntity,
  insertObservation,
  listAudit,
  listEntities,
  listObservationsByEntity,
  restoreEntity,
  softDeleteEntity,
} from './index.js';

const pool = getTestPool();

beforeEach(async () => {
  await resetDb(pool);
});

afterAll(async () => {
  await closeTestPool();
});

describe('store/entities', () => {
  it('inserts and reads back an entity', async () => {
    await ensureEntityType(pool, 'person');
    const created = await insertEntity(pool, {
      type: 'person',
      name: 'Person:A',
      aliases: ['A'],
      metadata: { note: 'abstract' },
    });
    expect(typeof created.id).toBe('string');

    const fetched = await findEntityById(pool, created.id);
    expect(fetched?.name).toBe('Person:A');
    expect(fetched?.aliases).toEqual(['A']);
    expect(fetched?.metadata).toEqual({ note: 'abstract' });
    expect(fetched?.deletedAt).toBeNull();
  });

  it('soft-deletes (hidden by default, visible with includeDeleted) then restores', async () => {
    await ensureEntityType(pool, 'project');
    const entity = await insertEntity(pool, { type: 'project', name: 'Project:X' });

    expect(await softDeleteEntity(pool, entity.id)).toBe(true);
    expect(await findEntityById(pool, entity.id)).toBeUndefined();

    const withDeleted = await findEntityById(pool, entity.id, { includeDeleted: true });
    expect(withDeleted?.deletedAt).toBeInstanceOf(Date);

    expect(await restoreEntity(pool, entity.id)).toBe(true);
    expect(await findEntityById(pool, entity.id)).toBeDefined();
  });

  it('hard-deletes', async () => {
    await ensureEntityType(pool, 'trip');
    const entity = await insertEntity(pool, { type: 'trip', name: 'Trip:T1' });
    expect(await hardDeleteEntity(pool, entity.id)).toBe(true);
    expect(await findEntityById(pool, entity.id, { includeDeleted: true })).toBeUndefined();
  });

  it('lists entities filtered by type', async () => {
    await ensureEntityType(pool, 'person');
    await insertEntity(pool, { type: 'person', name: 'Person:A' });
    await insertEntity(pool, { type: 'person', name: 'Person:B' });
    const people = await listEntities(pool, { type: 'person' });
    expect(people).toHaveLength(2);
  });
});

describe('store/observations (bi-temporal listing)', () => {
  it('filters observations by asOf instant', async () => {
    await ensureEntityType(pool, 'person');
    const entity = await insertEntity(pool, { type: 'person', name: 'Person:A' });
    const t1 = new Date('2020-01-01T00:00:00Z');
    const t2 = new Date('2021-01-01T00:00:00Z');

    await insertObservation(pool, entity.id, { text: 'fact one', validFrom: t1, validTo: t2 });
    await insertObservation(pool, entity.id, { text: 'fact two', validFrom: t2 });

    const mid = await listObservationsByEntity(pool, entity.id, {
      asOf: new Date('2020-06-01T00:00:00Z'),
    });
    expect(mid.map((o) => o.text)).toEqual(['fact one']);

    const later = await listObservationsByEntity(pool, entity.id, {
      asOf: new Date('2021-06-01T00:00:00Z'),
    });
    expect(later.map((o) => o.text)).toEqual(['fact two']);
  });
});

describe('store/audit', () => {
  it('appends and lists audit records', async () => {
    await appendAudit(pool, {
      action: 'test.action',
      targetKind: 'entity',
      targetId: 'x',
      detail: { a: 1 },
    });
    const entries = await listAudit(pool, { targetId: 'x' });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.action).toBe('test.action');
    expect(entries[0]?.detail).toEqual({ a: 1 });
  });
});
