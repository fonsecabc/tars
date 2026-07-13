# shellcheck shell=bash
# Shared helpers for Tars's install/ops scripts. Source this; don't execute it.
# Keeps setup.sh / service.sh / doctor.sh / tunnel.sh small and consistent.

# Repo root = parent of this scripts/ directory (handles spaces in the path).
TARS_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TARS_LIB_DIR/.." && pwd)"
export REPO_ROOT

# --- Pretty logging ---------------------------------------------------------
if [[ -t 1 ]]; then
  _C_RESET=$'\033[0m'; _C_BLUE=$'\033[34m'; _C_GREEN=$'\033[32m'
  _C_YELLOW=$'\033[33m'; _C_RED=$'\033[31m'; _C_BOLD=$'\033[1m'
else
  _C_RESET=''; _C_BLUE=''; _C_GREEN=''; _C_YELLOW=''; _C_RED=''; _C_BOLD=''
fi

step() { printf '\n%s==>%s %s%s%s\n' "$_C_BLUE" "$_C_RESET" "$_C_BOLD" "$*" "$_C_RESET"; }
info() { printf '    %s\n' "$*"; }
ok()   { printf '    %s✓%s %s\n' "$_C_GREEN" "$_C_RESET" "$*"; }
warn() { printf '    %s!%s %s\n' "$_C_YELLOW" "$_C_RESET" "$*" >&2; }
err()  { printf '    %s✗%s %s\n' "$_C_RED" "$_C_RESET" "$*" >&2; }
die()  { err "$*"; exit 1; }

# --- OS detection -----------------------------------------------------------
is_macos() { [[ "$(uname -s)" == "Darwin" ]]; }

# Bail early on non-macOS with a pointer to the manual path. Linux support is
# intentionally out of scope for these scripts (Colima/launchd/brew assumed).
require_macos() {
  if ! is_macos; then
    err "These scripts target macOS (Homebrew + Colima + launchd)."
    err "On Linux: install Docker + Node 20+ + Ollama natively, run 'pnpm install &&"
    err "pnpm build && pnpm db:up', and supervise 'pnpm start' with systemd instead."
    exit 1
  fi
}

# --- Machine assessment -----------------------------------------------------
# Best-effort hardware read (macOS), used to right-size the install so we never
# push a heavy local-model stack onto a Mac (or a person) that doesn't want it.
total_ram_gb() { local b; b="$(sysctl -n hw.memsize 2>/dev/null || echo 0)"; echo $(( b / 1073741824 )); }
cpu_cores()    { sysctl -n hw.ncpu 2>/dev/null || echo 0; }
arch_label()   { case "$(uname -m)" in arm64) echo "Apple Silicon";; x86_64) echo "Intel";; *) uname -m;; esac; }
macos_version(){ sw_vers -productVersion 2>/dev/null || echo '?'; }

machine_summary() {
  info "This Mac: $(arch_label) · $(cpu_cores) cores · $(total_ram_gb) GB RAM · macOS $(macos_version)"
}

# resolve_profile — the single knob the whole install hangs off: "simple" vs "full".
#   simple = smart brain + memory graph only (no local AI model). Light, private,
#            great on laptops and for non-technical people. This is the default.
#   full   = also install a local AI model (Ollama) for fuzzy semantic search and
#            the voice stack. Heavier: a few GB of downloads, wants 16GB+ RAM and a
#            Mac that stays on.
# Precedence: explicit TARS_PROFILE env  >  interactive question  >  safe default (simple).
# Prints ONLY the chosen profile to stdout; every human-facing line goes to stderr so
# `p=$(resolve_profile)` captures the word alone.
resolve_profile() {
  local choice="${TARS_PROFILE:-}"
  case "$choice" in
    simple|full) echo "$choice"; return 0 ;;
  esac

  # No terminal to ask on (piped install / CI) → take the light, no-extra-download path.
  if [[ ! -r /dev/tty ]]; then echo "simple"; return 0; fi

  {
    printf '\n  How should TARS remember and search?\n\n'
    printf '    1) Simple   (recommended — best for most people and any laptop)\n'
    printf '       TARS reasons with its smart brain and memory graph. Nothing extra to\n'
    printf '       install or maintain, and your notes stay on this Mac.\n\n'
    printf '    2) Full     (power users, on an always-on desktop Mac)\n'
    printf '       Also runs a local AI model on THIS Mac for extra-fuzzy search (and the\n'
    printf '       voice stack). Downloads a few GB; wants 16GB+ RAM and a Mac left on.\n\n'
    printf '  Choose [1]: '
  } >&2

  local ans; read -r ans </dev/tty || ans=""
  case "$ans" in
    2|full|Full|FULL)
      local ram; ram="$(total_ram_gb)"
      if (( ram > 0 && ram < 16 )); then
        printf '\n    ! This Mac has %s GB RAM; the local model really wants ~16GB+.\n' "$ram" >&2
        printf '      Simple will feel much snappier here. Use Full anyway? [y/N]: ' >&2
        local c2; read -r c2 </dev/tty || c2=""
        [[ "$c2" =~ ^[Yy] ]] && echo "full" || echo "simple"
      else
        echo "full"
      fi
      ;;
    *) echo "simple" ;;
  esac
}

# --- Command / Homebrew helpers --------------------------------------------
have() { command -v "$1" >/dev/null 2>&1; }

require_brew() {
  if ! have brew; then
    die "Homebrew is required. Install it from https://brew.sh then re-run 'make setup'."
  fi
}

# brew_install <formula> [check-cmd]  — install only if the check command is absent.
brew_install() {
  local formula="$1" check="${2:-$1}"
  if have "$check"; then
    ok "$check already installed"
  else
    info "Installing $formula via Homebrew..."
    brew install "$formula"
    ok "$formula installed"
  fi
}

# --- Postgres / Docker volume awareness ------------------------------------
# True if a Postgres data volume from a previous install already exists. Used to
# avoid rotating the DB password out from under existing data (the golden rule:
# never destroy the brain). Requires the docker daemon to be reachable.
data_volume_exists() {
  docker volume ls -q 2>/dev/null | grep -qiE 'tars.*pgdata'
}

# generate_password — URL-safe (hex only, so no DATABASE_URL escaping needed).
generate_password() {
  if have openssl; then openssl rand -hex 24; else
    head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

# ensure_env — create .env and deploy/docker/.env if missing, with a real password.
#
# Golden rule: never destroy the brain. Postgres only applies POSTGRES_PASSWORD on an
# EMPTY data dir, so rotating it against an existing volume would lock out the data.
# Therefore: fresh install (no .env, no volume) → generate a strong password; an existing
# volume → preserve the legacy default it was initialized with. Requires docker reachable.
ensure_env() {
  local env_file="$REPO_ROOT/.env"
  local docker_env="$REPO_ROOT/deploy/docker/.env"
  local pw

  if [[ -f "$env_file" ]]; then
    pw="$(grep -E '^POSTGRES_PASSWORD=' "$env_file" | head -1 | cut -d= -f2-)"
    [[ -n "$pw" ]] || die "$env_file exists but has no POSTGRES_PASSWORD line."
    ok ".env present — keeping its POSTGRES_PASSWORD (not rotating)"
  else
    if data_volume_exists; then
      pw="tars_dev_password_change_me"
      warn "Existing Postgres volume found — preserving its password to protect existing data."
      warn "To rotate: stop the server, 'docker volume rm \$(docker volume ls -q | grep pgdata)'"
      warn "(DESTROYS the brain), delete .env, then re-run 'make setup'."
    else
      pw="$(generate_password)"
      ok "Fresh install — generated a strong POSTGRES_PASSWORD"
    fi
    write_app_env "$env_file" "$pw" "${TARS_EMBEDDING_PROVIDER:-null}"
    ok "Wrote $env_file"
  fi

  if [[ ! -f "$docker_env" ]]; then
    write_docker_env "$docker_env" "$pw"
    ok "Wrote $docker_env"
  fi
}

write_app_env() {
  local path="$1" pw="$2" provider="${3:-null}"
  cat >"$path" <<EOF
# Tars — generated by 'make setup'. Edit as needed; NEVER commit this file.

# --- Postgres ---------------------------------------------------------------
POSTGRES_USER=tars
POSTGRES_PASSWORD=$pw
POSTGRES_DB=tars
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
DATABASE_URL=postgresql://tars:$pw@localhost:5432/tars

# --- Server -----------------------------------------------------------------
PORT=8787
HOST=127.0.0.1
PUBLIC_PORT=8788
# PUBLIC_BASE_URL is set by 'make tunnel' (written to ~/.tars/public.env and sourced
# by the launchd wrapper). Leave unset for loopback-only (Claude Code on this Mac).

# --- Embeddings -------------------------------------------------------------
# Set by 'make setup' from your chosen profile:
#   null   = smart brain + memory graph only (Simple profile; no local model).
#   ollama = local on-device embeddings for fuzzy search (Full profile).
EMBEDDING_PROVIDER=$provider
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
EOF
}

write_docker_env() {
  local path="$1" pw="$2"
  cat >"$path" <<EOF
# Postgres credentials for deploy/docker/docker-compose.yml. Generated by 'make setup'.
# Must match POSTGRES_PASSWORD / DATABASE_URL in the repo-root .env. NEVER commit.
POSTGRES_USER=tars
POSTGRES_PASSWORD=$pw
POSTGRES_DB=tars
POSTGRES_PORT=5432
EOF
}

# Wait (bounded) until the tars-postgres container reports healthy.
wait_for_postgres() {
  local tries="${1:-60}"
  for _ in $(seq 1 "$tries"); do
    local status
    status="$(docker inspect -f '{{.State.Health.Status}}' tars-postgres 2>/dev/null || true)"
    if [[ "$status" == "healthy" ]]; then return 0; fi
    sleep 1
  done
  # Fall back to a raw TCP probe in case the container has no healthcheck handle.
  nc -z 127.0.0.1 5432 >/dev/null 2>&1
}

# --- launchd ----------------------------------------------------------------
LAUNCHD_LABEL="com.tars.server"
LAUNCHD_PLIST="$HOME/Library/LaunchAgents/${LAUNCHD_LABEL}.plist"
launchd_target() { echo "gui/$(id -u)/${LAUNCHD_LABEL}"; }
launchd_loaded() { launchctl print "$(launchd_target)" >/dev/null 2>&1; }

# --- Server health ----------------------------------------------------------
# The loopback MCP endpoint answers 400 to a bare GET (no MCP session) when up.
server_http_code() {
  curl -s -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:${1:-8787}/mcp" 2>/dev/null || echo 000
}
server_up() { [[ "$(server_http_code "${1:-8787}")" != "000" ]]; }
