import type { Pool, PoolClient } from 'pg';

/**
 * Run `fn` inside a single transaction. Commits on success, rolls back on any thrown
 * error, and always releases the client. The client passed to `fn` is a {@link Queryable}.
 */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback failures; surface the original error instead.
    }
    throw error;
  } finally {
    client.release();
  }
}
