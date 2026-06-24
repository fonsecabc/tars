import { fileURLToPath } from 'node:url';

// node-pg-migrate is a CommonJS package; import the named `runner` (the default export
// resolves to the non-callable module namespace under NodeNext interop).
import { runner } from 'node-pg-migrate';

/** Absolute path to `packages/core/migrations` (resolves the same from src or dist). */
const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

const quietLogger = {
  debug: () => {},
  info: () => {},
  warn: (msg: string) => {
    console.warn(msg);
  },
  error: (msg: string) => {
    console.error(msg);
  },
};

export interface RunMigrationsOptions {
  verbose?: boolean;
  /** Migrations directory. Defaults to `packages/core/migrations`. */
  dir?: string;
  /** Ledger table tracking applied migrations. Defaults to `pgmigrations`. */
  migrationsTable?: string;
}

/**
 * Apply all pending "up" migrations to the database at `databaseUrl`.
 * Idempotent: migrations already recorded in the ledger table are skipped.
 *
 * `dir` / `migrationsTable` let a transport layer (e.g. `@tars/server`) keep its own
 * migrations (OAuth tables) in a separate directory + ledger, so `core` stays free of
 * transport concerns while there is still a single migration mechanism.
 */
export async function runMigrations(
  databaseUrl: string,
  options: RunMigrationsOptions = {},
): Promise<void> {
  await runner({
    databaseUrl,
    dir: options.dir ?? MIGRATIONS_DIR,
    migrationsTable: options.migrationsTable ?? 'pgmigrations',
    direction: 'up',
    count: Number.POSITIVE_INFINITY,
    ...(options.verbose ? {} : { logger: quietLogger }),
  });
}
