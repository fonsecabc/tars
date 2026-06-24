/**
 * Resolve the Postgres connection string from the environment. Prefers `DATABASE_URL`;
 * otherwise assembles one from discrete `POSTGRES_*` vars, falling back to dev defaults.
 * Reading config from env is allowed in core; transport concerns are not.
 */
export function databaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DATABASE_URL) {
    return env.DATABASE_URL;
  }
  const user = env.POSTGRES_USER ?? 'tars';
  const password = env.POSTGRES_PASSWORD ?? 'tars_dev_password_change_me';
  const host = env.POSTGRES_HOST ?? 'localhost';
  const port = env.POSTGRES_PORT ?? '5432';
  const database = env.POSTGRES_DB ?? 'tars';
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}
