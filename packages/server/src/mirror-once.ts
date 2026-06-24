import 'dotenv/config';

import { createPool, databaseUrlFromEnv, gitCommitMirror, writeMirror } from '@tars/core';

/**
 * One-shot Markdown mirror + git commit — the second, human-readable backup copy
 * (the first is `pg_dump`; see `ops/backup/`). Schedule via launchd/cron. Set MIRROR_DIR
 * to the mirror git repo path.
 */
async function main(): Promise<void> {
  const dir = process.env.MIRROR_DIR;
  if (!dir) {
    console.error('Set MIRROR_DIR to the mirror git repo path.');
    process.exit(1);
  }

  const pool = createPool(databaseUrlFromEnv());
  try {
    const result = await writeMirror(pool, {
      dir,
    });
    const committed = await gitCommitMirror(dir, `tars: mirror ${result.entityCount} entities`);
    console.log(
      `Mirror written to ${dir} — ${result.entityCount} entities, ${result.files} files; ` +
        `committed: ${committed}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Mirror failed:', error);
  process.exit(1);
});
