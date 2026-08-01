#!/usr/bin/env bash
# make setup — take a fresh Mac from `git clone` to a built, running Tars stack.
# Idempotent: detect-or-install every prerequisite; safe to re-run any time.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_macos

# --- 1. Prerequisites (Homebrew packages) ----------------------------------
step "Checking prerequisites"
require_brew
ok "Homebrew present"

# Node 20+ (the repo's engines floor). brew's node is current; only install if missing
# or too old — respect an existing newer Node (e.g. nvm) already on PATH.
node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'; }
if have node && [[ "$(node_major)" -ge 20 ]]; then
  ok "Node $(node -v) (>= 20)"
else
  info "Installing Node via Homebrew (need >= 20)..."
  brew install node
  ok "Node $(node -v) installed"
fi

# pnpm via corepack (pinned by package.json's packageManager field).
if have pnpm; then
  ok "pnpm $(pnpm -v)"
else
  info "Enabling pnpm via corepack..."
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@11.8.0 --activate >/dev/null 2>&1 || true
  have pnpm || die "Could not enable pnpm via corepack. Install it manually: npm i -g pnpm"
  ok "pnpm $(pnpm -v)"
fi

brew_install colima
brew_install docker docker        # the docker CLI
brew_install docker-compose       # the 'docker compose' plugin (no Docker Desktop)

# --- 2. Assess: which profile fits this person + this Mac? -----------------
# Everything below (whether we install a local AI model at all) hangs off this
# one choice. See resolve_profile in lib.sh for the simple-vs-full trade-off.
step "Choosing your setup"
machine_summary
PROFILE="$(resolve_profile)"
if [[ "$PROFILE" == "full" ]]; then
  export TARS_EMBEDDING_PROVIDER=ollama
  ok "Full profile — smart brain + a local AI model for fuzzy search."
else
  export TARS_EMBEDDING_PROVIDER=null
  ok "Simple profile — smart brain + memory graph. No local model to install."
  info "Recall is keyword + graph; your assistant does the semantic reasoning on top."
fi

# --- 2b. Local AI model (Full profile only) --------------------------------
if [[ "$PROFILE" == "full" ]]; then
  brew_install ollama
  step "Local embedding model (nomic-embed-text, 768-dim)"
  brew services start ollama >/dev/null 2>&1 || true
  # Give the daemon a moment to bind before pulling.
  for _ in $(seq 1 10); do curl -s -m 2 http://localhost:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done
  if ollama list 2>/dev/null | grep -q '^nomic-embed-text'; then
    ok "nomic-embed-text already pulled"
  else
    info "Pulling nomic-embed-text..."
    ollama pull nomic-embed-text
    ok "nomic-embed-text pulled"
  fi
else
  step "Local embedding model"
  ok "Skipped (Simple profile) — no multi-GB download, nothing extra to keep running."
fi

# --- 3. Colima (the Docker VM) ---------------------------------------------
step "Colima (Docker VM)"
if colima status >/dev/null 2>&1; then
  ok "Colima already running"
else
  info "Starting Colima..."
  colima start
  ok "Colima started"
fi
docker info >/dev/null 2>&1 || die "Docker daemon not reachable even after 'colima start'. Run 'colima status'."

# --- 4. Environment (.env + deploy/docker/.env) ----------------------------
step "Environment configuration"
ensure_env

# --- 5. Dependencies + build -----------------------------------------------
step "Installing dependencies"
( cd "$REPO_ROOT" && pnpm install )
ok "Dependencies installed"

step "Building"
( cd "$REPO_ROOT" && pnpm build )
ok "Build complete"

# --- 6. Database ------------------------------------------------------------
step "Starting Postgres (pgvector)"
( cd "$REPO_ROOT" && pnpm db:up )
info "Waiting for Postgres to become healthy..."
if wait_for_postgres 60; then
  ok "Postgres is up on :5432 (migrations run automatically when the server boots)"
else
  die "Postgres did not become healthy in time. Check 'pnpm db:logs'."
fi

step "Setup complete"
ok "Stack is built and the database is running ($PROFILE profile)."
info "The brain ships EMPTY — no personal data until you add it."
info "Next: 'make install-service' to run Tars always-on, then 'make doctor' to verify."
info "Then seed it by just talking to TARS — see docs/onboarding.md (the interview)."
