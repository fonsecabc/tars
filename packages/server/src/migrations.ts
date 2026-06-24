import { fileURLToPath } from 'node:url';

/** Absolute path to `packages/server/migrations` (OAuth tables). Resolves from src or dist. */
export const SERVER_MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/** Separate ledger so server (OAuth) migrations don't collide with core's `pgmigrations`. */
export const SERVER_MIGRATIONS_TABLE = 'server_migrations';
