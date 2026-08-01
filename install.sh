#!/usr/bin/env bash
#
# Tars bootstrap — the one-liner. Clones (or finds) the repo, then hands off to the
# interactive setup wizard. Designed to be pasted anywhere:
#
#   curl -fsSL https://raw.githubusercontent.com/fonsecabc/tars/main/install.sh | bash
#
# or, from a checkout you already have:
#
#   ./install.sh
#
# It is intentionally dependency-free (POSIX-ish bash, no sourcing) so it works before
# anything is installed. All the real work — prereqs, build, MCP wiring, persona — lives in
# scripts/init.sh, which this runs. Idempotent: safe to re-run; an existing clone is updated,
# never clobbered.
set -euo pipefail

REPO_URL="${TARS_REPO_URL:-https://github.com/fonsecabc/tars.git}"
TARS_HOME="${TARS_HOME:-$HOME/tars}"

# Minimal logging (init.sh has the pretty version once we're in the repo).
if [[ -t 1 ]]; then B=$'\033[34m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[1m'; Z=$'\033[0m'
else B=''; G=''; Y=''; R=''; D=''; Z=''; fi
# Log to stderr so a downstream `--json` run keeps stdout clean for the agent to parse.
say()  { printf '%s==>%s %s%s%s\n' "$B" "$Z" "$D" "$*" "$Z" >&2; }
info() { printf '    %s\n' "$*" >&2; }
die()  { printf '    %s✗%s %s\n' "$R" "$Z" "$*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || die "git is required. Install it, then re-run."

# Where does the wizard live? Three cases:
#   1. Run from inside a checkout (./install.sh)  → use it in place.
#   2. Piped from curl, no clone yet              → clone to $TARS_HOME.
#   3. Piped from curl, clone already at $TARS_HOME → update it.
SELF_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [[ -n "$SELF_DIR" && -f "$SELF_DIR/scripts/init.sh" ]]; then
  REPO_DIR="$SELF_DIR"
  say "Using this checkout: $REPO_DIR"
elif [[ -d "$TARS_HOME/.git" ]]; then
  REPO_DIR="$TARS_HOME"
  say "Updating existing clone: $REPO_DIR"
  git -C "$REPO_DIR" pull --ff-only || info "Could not fast-forward (local changes?) — continuing with what's on disk."
else
  say "Cloning Tars into $TARS_HOME"
  git clone --depth 1 "$REPO_URL" "$TARS_HOME"
  REPO_DIR="$TARS_HOME"
fi

[[ -f "$REPO_DIR/scripts/init.sh" ]] || die "scripts/init.sh not found in $REPO_DIR — is this a Tars checkout?"

say "Launching the setup wizard"
# Interactive prompts must read from the terminal, not from the piped stdin (curl | bash).
exec bash "$REPO_DIR/scripts/init.sh" "$@"
