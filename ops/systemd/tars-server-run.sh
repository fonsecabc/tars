#!/bin/bash
# Boot the full Tars stack on Linux, then run the server — the systemd (Linux) analogue of
# ops/launchd/tars-server-run.sh. Invoked by the tars-server systemd --user unit
# (Restart=always, WantedBy=default.target) so the brain survives crash/reboot.
# Order: Docker daemon (native) -> Postgres container -> wait for :5432 -> exec server.
# Path-derived REPO so this stays portable; logs go to the journal (StandardOutput=journal).
set -u
# The unit's Environment=PATH leads with 'which node's dir; keep common bins reachable too.
export PATH="${PATH:-/usr/bin:/bin}:/usr/local/bin"
export EMBEDDING_PROVIDER="${EMBEDDING_PROVIDER:-ollama}"

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

# 1. Docker daemon — native on Linux (a system service, unlike macOS's Colima VM). Wait
#    (bounded) until it's reachable, so a unit that races docker.service on boot doesn't
#    fail its first Postgres call.
for _ in $(seq 1 30); do
  if docker info >/dev/null 2>&1; then break; fi
  echo "[tars-run] waiting for the Docker daemon..."
  sleep 1
done

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

# 4. Run the server. exec => systemd tracks this PID; Restart=always re-runs this whole
#    script on exit/crash (so deps are re-ensured on every restart).
cd "$REPO"
echo "[tars-run] starting Tars server on :8787..."
exec node packages/server/dist/main.js
