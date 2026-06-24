import pg from 'pg';
import type { Pool } from 'pg';

const { Pool: PgPool } = pg;

const HOST = process.env.POSTGRES_HOST ?? 'localhost';
const PORT = process.env.POSTGRES_PORT ?? '5432';
const USER = process.env.POSTGRES_USER ?? 'tars';
const PASSWORD = process.env.POSTGRES_PASSWORD ?? 'tars_dev_password_change_me';

export const ADMIN_DATABASE = process.env.POSTGRES_DB ?? 'tars';
export const TEST_DATABASE = process.env.TARS_TEST_DB ?? 'tars_test';

/** Connection to an existing maintenance DB, used only to create the test DB. */
export const adminDatabaseUrl =
  process.env.ADMIN_DATABASE_URL ??
  `postgresql://${USER}:${PASSWORD}@${HOST}:${PORT}/${ADMIN_DATABASE}`;

/** Connection to the isolated test database. */
export const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  `postgresql://${USER}:${PASSWORD}@${HOST}:${PORT}/${TEST_DATABASE}`;

let pool: Pool | undefined;

export function getTestPool(): Pool {
  if (!pool) {
    pool = new PgPool({ connectionString: testDatabaseUrl });
  }
  return pool;
}

export async function closeTestPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

const STARTER_TYPES = [
  'person',
  'organization',
  'project',
  'trip',
  'place',
  'event',
  'asset',
  'idea',
  'document',
];

/**
 * Reset the database to a clean, deterministic state matching a fresh migration:
 * all data cleared, predicates cleared, only the starter entity types remain with
 * usage_count back at 0.
 */
export async function resetDb(p: Pool = getTestPool()): Promise<void> {
  await p.query(
    'TRUNCATE entities, observations, relations, relation_predicates, audit_log RESTART IDENTITY CASCADE',
  );
  await p.query('DELETE FROM entity_types WHERE name <> ALL($1::text[])', [STARTER_TYPES]);
  await p.query('UPDATE entity_types SET usage_count = 0');
}
