#!/usr/bin/env bash
# make doctor — verify the whole Tars stack and print actionable fixes.
# Exits non-zero if any check fails.
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

FAILS=0
pass() { printf '    %s✓%s %s\n' "$_C_GREEN" "$_C_RESET" "$*"; }
fail() { printf '    %s✗%s %s\n' "$_C_RED" "$_C_RESET" "$1"; [[ -n "${2:-}" ]] && printf '      %s→ %s%s\n' "$_C_YELLOW" "$2" "$_C_RESET"; FAILS=$((FAILS + 1)); }

step "Tars doctor"

# OS
if is_macos; then pass "macOS ($(sw_vers -productVersion 2>/dev/null || echo '?'))"; else
  fail "Not macOS — these checks assume Colima/launchd/brew."; fi

# Node
if have node && [[ "$(node -v | sed -E 's/^v([0-9]+).*/\1/')" -ge 20 ]]; then
  pass "Node $(node -v)"
else fail "Node missing or < 20" "Run 'make setup' (installs Node via Homebrew)"; fi

# pnpm
if have pnpm; then pass "pnpm $(pnpm -v)"; else fail "pnpm missing" "corepack enable; or 'make setup'"; fi

# .env
if [[ -f "$REPO_ROOT/.env" ]]; then pass ".env present"; else fail ".env missing" "Run 'make setup'"; fi

# Colima
if colima status >/dev/null 2>&1; then pass "Colima running"; else fail "Colima not running" "colima start"; fi

# Docker daemon
if docker info >/dev/null 2>&1; then pass "Docker daemon reachable"; else fail "Docker not reachable" "colima start"; fi

# Postgres
pg_status="$(docker inspect -f '{{.State.Health.Status}}' tars-postgres 2>/dev/null || echo absent)"
if [[ "$pg_status" == "healthy" ]] || nc -z 127.0.0.1 5432 >/dev/null 2>&1; then
  pass "Postgres reachable on :5432 (${pg_status})"
else fail "Postgres not reachable" "pnpm db:up  (then check 'pnpm db:logs')"; fi

# Ollama daemon
if curl -s -m 3 http://localhost:11434/api/tags >/dev/null 2>&1; then
  pass "Ollama running on :11434"
  if ollama list 2>/dev/null | grep -q '^nomic-embed-text'; then
    pass "nomic-embed-text model pulled"
  else fail "nomic-embed-text not pulled" "ollama pull nomic-embed-text"; fi
else fail "Ollama not running" "brew services start ollama"; fi

# Server health (loopback)
code="$(server_http_code 8787)"
if [[ "$code" != "000" ]]; then pass "Server up on :8787 (HTTP $code; 400 = healthy, no MCP session)"
else fail "Server not responding on :8787" "make start  (or 'make install-service')"; fi

# launchd
if launchd_loaded; then pass "launchd service '$LAUNCHD_LABEL' loaded"
else fail "launchd service not loaded" "make install-service"; fi

# Tunnel (informational — not a failure when loopback-only)
if [[ -f "$HOME/.tars/public.env" ]]; then
  base="$(grep -E '^PUBLIC_BASE_URL=' "$HOME/.tars/public.env" | cut -d= -f2-)"
  pass "Tunnel configured (PUBLIC_BASE_URL=$base)"
else info "Tunnel not configured (loopback-only). Run 'make tunnel' for chat Claude."; fi

echo
if [[ "$FAILS" -eq 0 ]]; then
  ok "All checks passed — Tars is healthy."
else
  err "$FAILS check(s) failed — see the → fixes above."
  exit 1
fi
