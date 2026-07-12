#!/usr/bin/env bash
# Encrypted, off-box backup of the whole brain: pg_dump | restic -> Backblaze B2.
# restic encrypts client-side (AES-256) with RESTIC_PASSWORD before anything leaves the
# box, so B2 only ever stores ciphertext. Runs hourly via tars-backup.timer.
#
#   sudo bash restic-backup.sh --init    # once, after B2 keys are in /etc/tars/backup.env
#   sudo bash restic-backup.sh           # hourly run (what the timer calls): backup only
#   sudo bash restic-backup.sh --prune   # retention/prune — run occasionally, delete-capable key
#
# THREAT MODEL — backups an attacker who owns the box cannot silently destroy:
#   The hourly run only ADDS snapshots (backup + check). It never deletes, so the B2
#   application key in /etc/tars/backup.env can be created WITHOUT the deleteFiles /
#   listAllBucketNames capability. Provision the bucket with **Object Lock (compliance/
#   governance)** so even a delete-capable key cannot remove snapshots inside the lock
#   window. Retention (`forget --prune`, which DOES delete) is a separate `--prune` mode —
#   run it from a trusted context with a separate, delete-capable key, NOT from the hourly
#   timer. That way a box compromise cannot `restic forget --prune`/wipe your history.
set -euo pipefail

BACKUP_ENV=/etc/tars/backup.env
# shellcheck disable=SC1090
set -a; . "$BACKUP_ENV"; set +a
export RESTIC_REPOSITORY RESTIC_PASSWORD B2_ACCOUNT_ID B2_ACCOUNT_KEY

DB_USER="${POSTGRES_USER:-tars}"
DB_NAME="${POSTGRES_DB:-tars}"

if [ "${1:-}" = "--init" ]; then
  restic snapshots >/dev/null 2>&1 || restic init
  echo "restic repo ready: $RESTIC_REPOSITORY"
  exit 0
fi

# Retention/prune — DESTRUCTIVE (deletes old snapshots). Run occasionally, NOT hourly, and
# with a delete-capable B2 key. Kept out of the hourly path so a box compromise with the
# append-only hourly key cannot wipe history.
if [ "${1:-}" = "--prune" ]; then
  restic forget --tag brain \
    --keep-hourly 24 --keep-daily 14 --keep-weekly 8 --keep-monthly 12 \
    --prune
  # Deeper integrity check when we're already doing heavy work.
  restic check --read-data-subset=5%
  echo "prune ok: $(date -u +%FT%TZ)"
  exit 0
fi

# Hourly run — APPEND ONLY. Stream a consistent dump straight into restic via stdin — the
# plaintext dump never touches disk. Tagged so a later --prune can retain cleanly.
docker exec -t tars-postgres pg_dump -U "$DB_USER" -d "$DB_NAME" \
  | restic backup --stdin --stdin-filename "tars-${DB_NAME}.sql" --tag brain --host tars

# Cheap structural integrity check (no data download / no delete).
restic check
echo "backup ok: $(date -u +%FT%TZ)"
