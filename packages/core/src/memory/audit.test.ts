import { createMemory } from '@tars/core';
import { closeTestPool, getTestPool, resetDb } from '@tars/core/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const pool = getTestPool();

beforeEach(async () => {
  await resetDb(pool);
});

afterAll(async () => {
  await closeTestPool();
});

describe('audit log', () => {
  it('records every write and is filterable by action', async () => {
    const memory = createMemory(pool);
    const a = await memory.remember({
      entity: { type: 'person', name: 'Person:A' },
      observations: [{ text: 'first fact' }, { text: 'second fact' }],
    });

    const all = await memory.listAudit();
    expect(all.length).toBe(3); // entity.create + 2 × observation.create
    expect(all.filter((e) => e.action === 'observation.create')).toHaveLength(2);

    const creates = await memory.listAudit({ action: 'entity.create' });
    expect(creates).toHaveLength(1);
    expect(creates[0]?.targetId).toBe(a.entity.id);

    await memory.forget({ kind: 'entity', id: a.entity.id });
    const deletes = await memory.listAudit({ action: 'entity.soft_delete' });
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.targetId).toBe(a.entity.id);
  });
});
