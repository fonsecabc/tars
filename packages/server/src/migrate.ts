import 'dotenv/config';

import { databaseUrlFromEnv, runMigrations } from '@tars/core';

import { SERVER_MIGRATIONS_DIR, SERVER_MIGRATIONS_TABLE } from './migrations.js';

// Apply all pending migrations (core schema + server OAuth tables) and exit. The server
// already migrates on boot; this is a standalone entrypoint for `pnpm db:migrate` / CI.
async function main(): Promise<void> {
  const databaseUrl = databaseUrlFromEnv();
  await runMigrations(databaseUrl, { verbose: true });
  await runMigrations(databaseUrl, {
    dir: SERVER_MIGRATIONS_DIR,
    migrationsTable: SERVER_MIGRATIONS_TABLE,
    verbose: true,
  });
  console.log('Migrations applied.');
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
