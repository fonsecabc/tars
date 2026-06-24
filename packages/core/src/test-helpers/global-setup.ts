import pg from 'pg';

import { runMigrations } from '../db/migrate.js';
import { TEST_DATABASE, adminDatabaseUrl, testDatabaseUrl } from './db.js';

const { Client } = pg;

/**
 * Vitest globalSetup: ensure the test database exists and is fully migrated before any
 * test runs. Connects to a maintenance DB to CREATE DATABASE if needed, then migrates.
 */
export default async function setup(): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/i.test(TEST_DATABASE)) {
    throw new Error(`Unsafe test database name: ${TEST_DATABASE}`);
  }

  const admin = new Client({ connectionString: adminDatabaseUrl });
  try {
    await admin.connect();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not connect to Postgres at ${adminDatabaseUrl}. ` +
        `Start the dev database with \`pnpm db:up\`. Original error: ${message}`,
    );
  }

  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      TEST_DATABASE,
    ]);
    if (existing.rowCount === 0) {
      // TEST_DATABASE is validated above; it cannot be parameterized as an identifier.
      await admin.query(`CREATE DATABASE ${TEST_DATABASE}`);
    }
  } finally {
    await admin.end();
  }

  await runMigrations(testDatabaseUrl);
}
