import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createMemory } from '../memory/facade.js';
import * as coreStore from '../store/index.js';
import { closeTestPool, getTestPool, resetDb } from '../test-helpers/index.js';
import { SessionNotFoundError } from './errors.js';
import { openSession } from './ops/append.js';
import { projectSession } from './projector.js';
import * as store from './store/index.js';
import type { Uuid } from './types.js';

const pool = getTestPool();
const memory = createMemory(pool);

// resetDb clears the graph tables; the session_* tables are outside its scope, so wipe them too.
beforeEach(async () => {
  await resetDb(pool);
  await pool.query('TRUNCATE session_events, sessions, session_leases RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await closeTestPool();
});

/** Seed a turn_message event directly onto the log (bypasses the lease gate — fine for seeding). */
async function seedTurn(sessionId: Uuid, actor: string, text?: string): Promise<void> {
  await store.insertSessionEvent(pool, {
    sessionId,
    harness: 'voice',
    actor,
    kind: 'turn_message',
    payload: text === undefined ? {} : { text },
  });
}

async function entityCount(): Promise<number> {
  const res = await pool.query<{ c: string }>(
    `SELECT count(*)::int::text AS c FROM entities WHERE type = 'session'`,
  );
  return Number(res.rows[0]!.c);
}

describe('projectSession', () => {
  it('creates a type=session entity with the deterministic name + metadata and transcript observations', async () => {
    const { session } = await openSession(pool, {
      origin: 'voice',
      externalRef: 'cc-1',
      title: 'My Session',
    });
    await seedTurn(session.id, 'user', 'hello there');
    await seedTurn(session.id, 'assistant', 'hi back');

    const result = await projectSession(memory, pool, session.id);

    const detail = await memory.getEntity(result.entityId);
    expect(detail?.entity.type).toBe('session');
    expect(detail?.entity.name).toBe('voice:cc-1');
    expect(detail?.entity.metadata.sessionId).toBe(session.id);

    // opened (genesis) + 2 turn_messages = 3 events, 3 observations.
    expect(result.eventsProjected).toBe(3);
    expect(result.observationsWritten).toBe(3);

    const texts = (await coreStore.listObservationsByEntity(pool, result.entityId)).map(
      (o) => o.text,
    );
    expect(texts).toContain('Session opened via voice (ref cc-1)');
    expect(texts).toContain('user: hello there');
    expect(texts).toContain('assistant: hi back');
  });

  it('is idempotent: re-projecting from the returned watermark writes nothing and forks no entity', async () => {
    const { session } = await openSession(pool, { origin: 'voice', externalRef: 'cc-2' });
    await seedTurn(session.id, 'user', 'first');

    const first = await projectSession(memory, pool, session.id);
    const before = (await coreStore.listObservationsByEntity(pool, first.entityId)).length;

    const again = await projectSession(memory, pool, session.id, {
      sinceSeq: first.projectedThroughSeq,
    });

    expect(again.eventsProjected).toBe(0);
    expect(again.observationsWritten).toBe(0);
    expect(again.entityId).toBe(first.entityId);

    const after = (await coreStore.listObservationsByEntity(pool, first.entityId)).length;
    expect(after).toBe(before);
    expect(await entityCount()).toBe(1);
  });

  it('projects only NEW events past the watermark and returns the same entity id', async () => {
    const { session } = await openSession(pool, { origin: 'voice', externalRef: 'cc-3' });
    await seedTurn(session.id, 'user', 'one');

    const first = await projectSession(memory, pool, session.id);

    await seedTurn(session.id, 'assistant', 'two');
    await seedTurn(session.id, 'user', 'three');

    const inc = await projectSession(memory, pool, session.id, {
      sinceSeq: first.projectedThroughSeq,
    });

    expect(inc.eventsProjected).toBe(2);
    expect(inc.observationsWritten).toBe(2);
    expect(inc.entityId).toBe(first.entityId);
    expect(await entityCount()).toBe(1);
  });

  it('skips a turn_message that carries no text/body payload', async () => {
    const { session } = await openSession(pool, { origin: 'voice', externalRef: 'cc-4' });
    await seedTurn(session.id, 'user'); // empty payload — no observation

    const result = await projectSession(memory, pool, session.id);

    // opened + turn = 2 events seen, but only the opened observation is written.
    expect(result.eventsProjected).toBe(2);
    expect(result.observationsWritten).toBe(1);

    const texts = (await coreStore.listObservationsByEntity(pool, result.entityId)).map(
      (o) => o.text,
    );
    expect(texts).toEqual(['Session opened via voice (ref cc-4)']);
  });

  it('throws SessionNotFoundError for an unknown session id', async () => {
    await expect(
      projectSession(memory, pool, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(SessionNotFoundError);
  });
});
