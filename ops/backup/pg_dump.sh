#!/usr/bin/env bash
# Scheduled Postgres backup — copy #1 of 2 (the git mirror in ops/backup is copy #2).
# Dumps the Tars database to a timestamped, compressed file and prunes old ones.
#
# Configure via env (or edit the defaults):
#   TARS_REPO_DIR        path to this repo (default: $HOME/Projects/tars)
#   TARS_BACKUP_DIR      where dumps go    (default: $HOME/tars-backups)
#   TARS_BACKUP_KEEP_DAYS  prune older than (default: 14)
#   POSTGRES_USER / POSTGRES_DB  (default: tars / tars)
set -euo pipefail

REPO_DIR="${TARS_REPO_DIR:-$HOME/Projects/tars}"
BACKUP_DIR="${TARS_BACKUP_DIR:-$HOME/tars-backups}"
KEEP_DAYS="${TARS_BACKUP_KEEP_DAYS:-14}"
DB_USER="${POSTGRES_USER:-tars}"
DB_NAME="${POSTGRES_DB:-tars}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/tars-$STAMP.sql.gz"

docker compose -f "$REPO_DIR/deploy/docker/docker-compose.yml" exec -T postgres \
  pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip >"$OUT"
echo "wrote $OUT"

find "$BACKUP_DIR" -name 'tars-*.sql.gz' -type f -mtime +"$KEEP_DAYS" -delete
echo "pruned dumps older than ${KEEP_DAYS} days"
