import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import type { Pool } from 'pg';

import type { ExportDump, ExportedEntity } from '../memory/export.js';
import type { Entity, Uuid } from '../schema/index.js';
import * as entitiesStore from '../store/entities.js';
import * as observationsStore from '../store/observations.js';
import * as relationsStore from '../store/relations.js';
import { entityFilePath, renderEntity, renderIndex, type EntityRef } from './render.js';

const execFileAsync = promisify(execFile);

export interface WriteMirrorOptions {
  /** Target directory for the mirror (a git repo lives here). */
  dir: string;
  now?: Date;
}

export interface MirrorResult {
  dir: string;
  entityCount: number;
  files: number;
}

async function listAllEntities(pool: Pool): Promise<Entity[]> {
  const all: Entity[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const page = await entitiesStore.listEntities(pool, { limit: pageSize, offset });
    all.push(...page);
    if (page.length < pageSize) {
      break;
    }
  }
  return all;
}

/**
 * Write the entire graph to `dir` as linked Markdown (one file per entity) plus a
 * `README.md` index and a full `export.json`. One-way (DB → Markdown): the `entities/`
 * tree is regenerated each run, so the DB stays the single source of truth and the mirror
 * is a durable, human-readable, diffable copy.
 */
export async function writeMirror(pool: Pool, options: WriteMirrorOptions): Promise<MirrorResult> {
  const now = options.now ?? new Date();
  const entities = await listAllEntities(pool);

  const refs = new Map<Uuid, EntityRef>();
  for (const entity of entities) {
    refs.set(entity.id, { type: entity.type, name: entity.name, path: entityFilePath(entity) });
  }

  // Regenerate the entities tree so deletions/renames don't leave stale files behind.
  await rm(join(options.dir, 'entities'), { recursive: true, force: true });

  const exported: ExportedEntity[] = [];
  for (const entity of entities) {
    const observations = await observationsStore.listObservationsByEntity(pool, entity.id, {
      limit: 1000,
    });
    const relations = await relationsStore.listRelationsByEntity(pool, entity.id, {
      direction: 'out',
    });

    const filePath = join(options.dir, entityFilePath(entity));
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, renderEntity(entity, observations, relations, refs), 'utf8');
    exported.push({ entity, observations, relations });
  }

  await mkdir(options.dir, { recursive: true });
  await writeFile(join(options.dir, 'README.md'), renderIndex(entities, refs, now), 'utf8');

  const dump: ExportDump = {
    exportedAt: now.toISOString(),
    entityCount: exported.length,
    truncated: false,
    entities: exported,
  };
  await writeFile(join(options.dir, 'export.json'), `${JSON.stringify(dump, null, 2)}\n`, 'utf8');

  return { dir: options.dir, entityCount: entities.length, files: exported.length };
}

/**
 * Stage and commit the mirror directory (initializing a git repo if needed). Returns false
 * if there was nothing to commit. Uses an inline identity so it needs no global git config.
 */
export async function gitCommitMirror(
  dir: string,
  message = 'tars: mirror update',
): Promise<boolean> {
  await execFileAsync('git', ['-C', dir, 'init', '-q']).catch(() => undefined);
  await execFileAsync('git', ['-C', dir, 'add', '-A']);
  try {
    await execFileAsync('git', [
      '-C',
      dir,
      '-c',
      'user.name=Tars',
      '-c',
      'user.email=tars@localhost',
      'commit',
      '-q',
      '-m',
      message,
    ]);
    return true;
  } catch {
    return false; // nothing to commit
  }
}
