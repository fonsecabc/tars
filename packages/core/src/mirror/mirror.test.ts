import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMemory, gitCommitMirror, mirror } from '@tars/core';
import { closeTestPool, getTestPool, resetDb } from '@tars/core/testing';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

const pool = getTestPool();
let dir: string;

beforeEach(async () => {
  await resetDb(pool);
  dir = await mkdtemp(join(tmpdir(), 'tars-mirror-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

afterAll(async () => {
  await closeTestPool();
});

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('Markdown mirror', () => {
  it('writes linked Markdown + export.json that round-trips the DB', async () => {
    const memory = createMemory(pool);
    const a = await memory.remember({
      entity: { type: 'person', name: 'Person:A' },
      observations: [{ text: 'enjoys hiking' }],
    });
    const x = await memory.remember({
      entity: { type: 'project', name: 'Project:X' },
      observations: [{ text: 'a research effort' }],
    });
    await memory.link({ fromEntity: a.entity.id, toEntity: x.entity.id, predicate: 'works on' });

    const result = await memory.writeMirror({ dir });
    expect(result.entityCount).toBe(2);
    expect(result.files).toBe(2);

    expect(await exists(join(dir, 'README.md'))).toBe(true);

    const dump = JSON.parse(await readFile(join(dir, 'export.json'), 'utf8')) as {
      entityCount: number;
      entities: { entity: { id: string; name: string } }[];
    };
    expect(dump.entityCount).toBe(2);
    expect(dump.entities.map((e) => e.entity.name).sort()).toEqual(['Person:A', 'Project:X']);

    const aPath = join(
      dir,
      mirror.entityFilePath({ id: a.entity.id, type: 'person', name: 'Person:A' }),
    );
    const md = await readFile(aPath, 'utf8');
    expect(md).toContain(`id: ${a.entity.id}`); // frontmatter round-trips the id
    expect(md).toContain('enjoys hiking'); // observation rendered
    expect(md).toContain('works_on → [Project:X]'); // relation linked (predicate normalized)
  });

  it('commits to git and reports nothing-to-commit on a clean re-run', async () => {
    const memory = createMemory(pool);
    await memory.remember({
      entity: { type: 'idea', name: 'Idea:Z' },
      observations: [{ text: 'a thought worth keeping' }],
    });

    await memory.writeMirror({ dir });
    expect(await gitCommitMirror(dir)).toBe(true);
    expect(await exists(join(dir, '.git'))).toBe(true);
    // Nothing changed since the last commit.
    expect(await gitCommitMirror(dir)).toBe(false);
  });
});
