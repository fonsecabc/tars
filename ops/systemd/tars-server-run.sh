#!/bin/bash
# Boot the full Tars stack on Linux, then run the server. This is the systemd (Linux)
# analogue of ops/launchd/tars-server-run.sh. Invoked by the tars-server systemd --user unit
# (Restart=always, WantedBy=default.target) so the brain survives crash/reboot.
# Order: Docker daemon (native) -> Postgres container -> wait for readiness -> exec server.
# Path-derived REPO so this stays portable; logs go to the journal.
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Reuse lib.sh so wait_for_postgres (health-check first, nc only as fallback) is shared with
# setup.sh/init.sh rather than reimplemented here. lib.sh exports REPO_ROOT.
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../../scripts/lib.sh"

# Tunnel hook: if 'make tunnel' wrote public OAuth settings, load them so the public
# (OAuth) listener comes up alongside the loopback one. Loopback-only without this file.
if [ -f "${HOME}/.tars/public.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "${HOME}/.tars/public.env"
  set +a
fi

COMPOSE="$REPO_ROOT/deploy/docker/docker-compose.yml"

# 1. Docker daemon: native on Linux (a system service, unlike macOS's Colima VM). Wait a
#    short bounded window, then fail loudly if it never comes up, so systemd can latch the
#    unit into 'failed' instead of respawning against a dead daemon forever. A dockerd that
#    is not up by 15s will not be up by 30s.
for _ in $(seq 1 15); do
  docker info >/dev/null 2>&1 && break
  echo "[tars-run] waiting for the Docker daemon..."
  sleep 1
done
docker info >/dev/null 2>&1 || { echo "[tars-run] Docker daemon not reachable; aborting." >&2; exit 1; }

# 2. Postgres container (idempotent; compose 'restart: unless-stopped' keeps it up after).
docker compose -f "$COMPOSE" up -d

# 3. Wait for Postgres to be READY (not merely TCP-open): wait_for_postgres checks the
#    compose healthcheck first and only falls back to a TCP probe, so it needs no netcat on
#    the host. Fail loudly on exhaustion for the same latch-into-failed reason as above.
wait_for_postgres 60 || { echo "[tars-run] Postgres did not become ready; aborting." >&2; exit 1; }
echo "[tars-run] postgres ready"

# 4. Run the server. exec => systemd tracks this PID; Restart=always re-runs this whole
#    script on exit/crash (so deps are re-ensured on every restart).
cd "$REPO_ROOT" || { echo "[tars-run] cannot cd to $REPO_ROOT; aborting." >&2; exit 1; }
echo "[tars-run] starting Tars server on :8787..."
exec node packages/server/dist/main.js
