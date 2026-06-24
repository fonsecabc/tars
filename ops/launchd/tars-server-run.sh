#!/bin/bash
# Boot the full Tars stack, then run the server. Invoked by the com.tars.server
# launchd agent (KeepAlive=true, RunAtLoad=true) so the brain survives reboot/sleep.
# Order: Colima (Docker VM) -> Postgres container -> wait for :5432 -> exec server.
# Path-derived REPO so this stays portable; logs go to the plist's Std{Out,Err}Path.
set -u
# Inherit the PATH the launchd plist provides (it leads with 'which node's dir), then
# make sure Homebrew tools are reachable too. Falls back sanely if PATH is unset.
export PATH="${PATH:-/usr/bin:/bin}:/opt/homebrew/bin:/usr/local/bin:/usr/sbin:/sbin"
export EMBEDDING_PROVIDER="${EMBEDDING_PROVIDER:-ollama}"
export DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock"

# Tunnel hook: if 'make tunnel' wrote public OAuth settings, load them so the public
# (OAuth) listener comes up alongside the loopback one. Loopback-only without this file.
if [ -f "${HOME}/.tars/public.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "${HOME}/.tars/public.env"
  set +a
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE="$REPO/deploy/docker/docker-compose.yml"

# 1. Docker VM (Colima) — start if not already running.
if ! colima status >/dev/null 2>&1; then
  echo "[tars-run] colima not running — starting..."
  colima start
fi

# 2. Postgres container (idempotent; compose 'restart: unless-stopped' keeps it up after).
docker compose -f "$COMPOSE" up -d

# 3. Wait (bounded ~60s) for Postgres to accept TCP connections before booting the server.
for _ in $(seq 1 60); do
  if nc -z 127.0.0.1 5432 >/dev/null 2>&1; then
    echo "[tars-run] postgres ready on :5432"
    break
  fi
  sleep 1
done

# 4. Run the server. exec => launchd tracks this PID; KeepAlive restarts it on exit/crash,
#    re-running this whole script (so deps are re-ensured on every restart).
cd "$REPO"
echo "[tars-run] starting Tars server on :8787..."
exec node packages/server/dist/main.js
