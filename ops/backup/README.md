# Backups — two independent copies

1. **`pg_dump`** — a complete, restorable snapshot of Postgres (this directory's
   `pg_dump.sh` + `com.tars.backup.plist`, scheduled daily).
2. **Git mirror** — the human-readable Markdown export (`pnpm --filter @tars/server mirror`),
   a vendor-neutral, diffable copy you can read or restore from by hand.

Two mechanisms, two formats: if one is ever corrupt or unreadable, the other survives.

## 1. Postgres dump (scheduled)

```bash
TARS_REPO_DIR=/path/to/tars TARS_BACKUP_DIR=~/tars-backups bash ops/backup/pg_dump.sh
```

Schedule daily via launchd (edit the `/ABSOLUTE/PATH/TO` placeholders first):

```bash
cp ops/backup/com.tars.backup.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.tars.backup.plist
```

Restore:

```bash
gunzip -c ~/tars-backups/tars-YYYYMMDD-HHMMSS.sql.gz \
  | docker compose -f deploy/docker/docker-compose.yml exec -T postgres psql -U tars -d tars
```

## 2. Git mirror (scheduled or on-demand)

```bash
MIRROR_DIR=~/tars-mirror pnpm --filter @tars/server mirror
```

Writes `entities/**`, `README.md`, and `export.json` to `MIRROR_DIR` and commits them.
Point `MIRROR_DIR` at a git repo (local is fine; add a remote for off-machine durability).
Schedule it with a launchd agent modeled on `com.tars.backup.plist` (swap the
`ProgramArguments` for `node .../packages/server/dist/mirror-once.js` and set `MIRROR_DIR`).

> The mirror excludes `sensitive` observations unless `MIRROR_INCLUDE_SENSITIVE=1`.
