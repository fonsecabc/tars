import type { QueryResult, QueryResultRow } from 'pg';

/** Return the single row, throwing if the result is empty (e.g. for `RETURNING`). */
export function one<R extends QueryResultRow>(res: QueryResult<R>): R {
  const row = res.rows[0];
  if (row === undefined) {
    throw new Error('Expected exactly one row, but the query returned none');
  }
  return row;
}

/** Return the first row, or undefined if there are none. */
export function maybeOne<R extends QueryResultRow>(res: QueryResult<R>): R | undefined {
  return res.rows[0];
}

/** Did this write affect at least one row? */
export function affected(res: QueryResult): boolean {
  return (res.rowCount ?? 0) > 0;
}
