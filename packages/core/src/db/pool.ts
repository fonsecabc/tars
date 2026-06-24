import pg from 'pg';
import type { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';

const { Pool: PgPool } = pg;

/**
 * Anything that can run a parameterized query — either a connection {@link Pool} or a
 * transaction client. Repositories accept a `Queryable` so the same function works
 * inside or outside a transaction.
 */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    queryText: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}

/** Create a Postgres connection pool from a connection string or explicit config. */
export function createPool(config: string | PoolConfig): Pool {
  return new PgPool(typeof config === 'string' ? { connectionString: config } : config);
}
