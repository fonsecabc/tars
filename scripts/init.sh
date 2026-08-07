#!/usr/bin/env bash
#
# `tars init` — the setup driver. Built AGENT-FIRST: an AI assistant (Claude Code) runs this
# headlessly to stand Tars up on someone's machine. Everything is flag/env-driven, never blocks
# on a prompt, and can emit a machine-readable JSON summary the agent parses to decide next
# steps. A human interactive menu is the fallback, used only when there's a real TTY and no
# flags were passed.
#
# Reached via the one-liner (install.sh) or directly: `bash scripts/init.sh …` / `tars init …`.
#
#   Agent (headless, parseable):
#     tars init --all --yes --owner-name "Ada" --install-prompt --json
#   Inspect current state:
#     tars init --status --json
#   Preview without doing anything:
#     tars init --all --dry-run --json
#   Human (interactive menu):
#     tars init
#
# Kept bash-3.2 safe (macOS default /bin/bash) — no associative arrays.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

PROMPT_SRC="$REPO_ROOT/docs/tars-system-prompt.md"
PERSONALIZED_PROMPT="${TARS_PROMPT_OUT:-$HOME/.tars/system-prompt.md}"
CLAUDE_MD="${TARS_CLAUDE_MD:-$HOME/.claude/CLAUDE.md}"
MCP_URL="http://127.0.0.1:${PORT:-8787}/mcp"

# --- Flags ---------------------------------------------------------------------------------
SEL_engine=-1 SEL_service=-1 SEL_mcp=-1 SEL_persona=-1 SEL_voice=-1   # -1 = unset
ASSUME_YES=0 JSON=0 DRY_RUN=0 NO_VERIFY=0 DO_STATUS=0 INSTALL_PROMPT=-1
OWNER_NAME="${TARS_OWNER_NAME:-}"
ANY_SEL_FLAG=0
# Engine profile (v0.7.0 setup.sh): simple = brain + graph, no local model; full = also a
# local embedding model. setup.sh ASKS when a TTY is present, which would hang an agent —
# so headless runs always pass one explicitly (default: simple, the safe/light choice).
PROFILE="${TARS_PROFILE:-}"

# --all covers the four core components; voice is an advanced/heavy extra (mic + whisper +
# local TTS), opt-in only via --components …,voice — never pulled in by --all.
set_all() { SEL_engine=$1 SEL_service=$1 SEL_mcp=$1 SEL_persona=$1; }

usage() {
  cat <<'EOF'
tars init — set up Tars (agent-first, non-interactive)

Selection
  --all                     Install the four core components (engine,service,mcp,persona)
  --components LIST          Comma list: engine,service,mcp,persona,voice
                             (voice = advanced hands-free mic+TTS, macOS-only, not in --all)
Engine
  --profile simple|full      simple = brain + graph, no local model (default headless);
                             full = also install local embeddings. Avoids setup.sh prompting.
Persona
  --owner-name NAME          What TARS calls the user (else git user.name, else placeholder)
  --install-prompt           Merge the persona into ~/.claude/CLAUDE.md (else just write the file)
  --claude-md PATH           Target file for --install-prompt (default ~/.claude/CLAUDE.md)
Behavior
  -y, --yes                  Assume yes to every confirmation; never prompt (agents: pass this)
  --json                     Emit a machine-readable summary to stdout (logs go to stderr)
  --dry-run                  Print the plan; change nothing
  --no-verify                Skip the post-install doctor check
  --status                   Report current state and exit (respects --json)
  -h, --help                 This help

Env: TARS_OWNER_NAME, TARS_CLAUDE_MD, TARS_PROMPT_OUT, PORT
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all) set_all 1; ANY_SEL_FLAG=1 ;;
    --components)
      ANY_SEL_FLAG=1; set_all 0
      IFS=',' read -r -a _c <<< "${2:-}"; shift
      for c in "${_c[@]}"; do
        case "$c" in
          engine) SEL_engine=1 ;; service) SEL_service=1 ;;
          mcp) SEL_mcp=1 ;; persona) SEL_persona=1 ;; voice) SEL_voice=1 ;;
          '') : ;; *) die "unknown component: $c (want engine|service|mcp|persona|voice)" ;;
        esac
      done ;;
    --profile)
      PROFILE="${2:-}"; shift
      [[ "$PROFILE" == simple || "$PROFILE" == full ]] || die "--profile must be 'simple' or 'full'" ;;
    --owner-name) OWNER_NAME="${2:-}"; shift ;;
    --install-prompt) INSTALL_PROMPT=1 ;;
    --claude-md) CLAUDE_MD="${2:-}"; shift ;;
    -y|--yes) ASSUME_YES=1 ;;
    --json) JSON=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --no-verify) NO_VERIFY=1 ;;
    --status) DO_STATUS=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown flag: $1 (see --help)" ;;
  esac
  shift
done

# In --json mode, keep stdout pristine for the JSON: send all human logging to stderr, and
# emit the JSON document on the saved real stdout (fd 4) at the very end.
if [[ $JSON == 1 ]]; then exec 4>&1 1>&2; fi

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
has_tty() { [[ -r /dev/tty && $ASSUME_YES == 0 ]]; }

# --- Status (introspection for the agent) --------------------------------------------------
report_status() {
  local os pg srv svc mcpreg pfile pinst
  os=$(is_macos && echo macos || echo linux)
  pg=$(docker inspect -f '{{.State.Health.Status}}' tars-postgres 2>/dev/null || echo absent)
  srv=$(server_up && echo up || echo down)
  # 'service' spans both managers so agent-driven onboarding can verify the unit on Linux too.
  svc='n/a'
  case "$(service_manager)" in
    launchd) launchd_loaded && svc=loaded || svc=unloaded ;;
    systemd) systemd_loaded && svc=loaded || svc=unloaded ;;
  esac
  mcpreg=no; have claude && claude mcp list 2>/dev/null | grep -q '\btars\b' && mcpreg=yes
  pfile=no; [[ -f "$PERSONALIZED_PROMPT" ]] && pfile=yes
  pinst=no; [[ -f "$CLAUDE_MD" ]] && grep -q 'TARS:BEGIN' "$CLAUDE_MD" 2>/dev/null && pinst=yes
  if [[ $JSON == 1 ]]; then
    printf '{"os":"%s","postgres":"%s","server":"%s","service":"%s","mcpRegistered":%s,"personaFile":%s,"personaInstalled":%s,"mcpUrl":"%s"}\n' \
      "$os" "$pg" "$srv" "$svc" \
      "$([[ $mcpreg == yes ]] && echo true || echo false)" \
      "$([[ $pfile == yes ]] && echo true || echo false)" \
      "$([[ $pinst == yes ]] && echo true || echo false)" \
      "$MCP_URL" >&4
  else
    step "Tars status"
    info "os=$os  postgres=$pg  server=$srv  service=$svc"
    info "mcpRegistered=$mcpreg  personaFile=$pfile  personaInstalled=$pinst"
  fi
}

if [[ $DO_STATUS == 1 ]]; then report_status; exit 0; fi

# --- Interactive fallback (humans only) ----------------------------------------------------
interactive_menu() {
  local labels=(
    "Engine        — server + Postgres + local embeddings"
    "Always-on     — keep Tars running & auto-start on boot"
    "Claude Code   — register the Tars MCP server"
    "Persona       — personalize & install the TARS system prompt"
    "Voice (adv.)  — hands-free mic + local TTS, macOS-only [off by default]")
  local sel=(1 1 1 1 0) i choice   # voice defaults off
  while :; do
    printf '\n' >/dev/tty
    for i in 0 1 2 3 4; do
      local m=' '; [[ "${sel[$i]}" == 1 ]] && m='x'
      printf '  [%s] %d  %s\n' "$m" $((i+1)) "${labels[$i]}" >/dev/tty
    done
    printf '\n  Toggle 1-5, a=all, n=none, Enter=continue\n> ' >/dev/tty
    read -r choice </dev/tty || break
    case "$choice" in
      '') break ;; a|A) for i in 0 1 2 3 4; do sel[$i]=1; done ;;
      n|N) for i in 0 1 2 3 4; do sel[$i]=0; done ;;
      [1-5]) local x=$((choice-1)); [[ "${sel[$x]}" == 1 ]] && sel[$x]=0 || sel[$x]=1 ;;
    esac
  done
  SEL_engine=${sel[0]} SEL_service=${sel[1]} SEL_mcp=${sel[2]} SEL_persona=${sel[3]} SEL_voice=${sel[4]}
}

# --- Resolve selection ---------------------------------------------------------------------
# Precedence: explicit flags > interactive menu (human) > default-all (headless convenience).
if [[ $ANY_SEL_FLAG == 0 ]]; then
  if has_tty; then
    interactive_menu   # sets SEL_*
  else
    set_all 1
    [[ $JSON == 0 ]] && warn "No component flags and no TTY — defaulting to --all."
  fi
fi
# Any component left unset (partial --components) is off.
[[ $SEL_engine  == -1 ]] && SEL_engine=0
[[ $SEL_service == -1 ]] && SEL_service=0
[[ $SEL_mcp     == -1 ]] && SEL_mcp=0
[[ $SEL_persona == -1 ]] && SEL_persona=0
[[ $SEL_voice   == -1 ]] && SEL_voice=0

confirm() { # confirm <prompt> — yes if --yes, else ask a TTY, else no
  [[ $ASSUME_YES == 1 ]] && return 0
  [[ -r /dev/tty ]] || return 1
  local a; printf '%s%s%s [y/N] ' "$_C_BOLD" "$1" "$_C_RESET" >/dev/tty
  read -r a </dev/tty || true; [[ "$a" =~ ^[Yy] ]]
}

# --- Step results (for the JSON summary) ---------------------------------------------------
R_engine=skipped R_service=skipped R_mcp=skipped R_persona=skipped R_voice=skipped
R_persona_installed=false R_owner="" R_mcp_state=""

do_engine() {
  step "Engine"
  # Never let setup.sh stop to ask: pin the profile whenever we're driving headlessly.
  if [[ -z "$PROFILE" && ( $ASSUME_YES == 1 || $JSON == 1 || ! -r /dev/tty ) ]]; then
    PROFILE=simple
    info "No --profile given; using 'simple' (no local model) so setup never prompts."
  fi
  [[ -n "$PROFILE" ]] && export TARS_PROFILE="$PROFILE"
  if [[ $DRY_RUN == 1 ]]; then info "(dry-run) would run setup (profile=${PROFILE:-ask})"; R_engine=planned; return; fi
  if is_macos; then bash "$REPO_ROOT/scripts/setup.sh"; R_engine=ok
  else
    have node || die "Node 20+ required."
    [[ "$(node -v | sed -E 's/^v([0-9]+).*/\1/')" -ge 20 ]] || die "Node 20+ required (found $(node -v))."
    have pnpm || { corepack enable >/dev/null 2>&1 || true; }
    have pnpm || die "pnpm required (npm i -g pnpm)."
    have docker || die "Docker required for Postgres."
    ( cd "$REPO_ROOT" && pnpm install && pnpm db:up && pnpm build && pnpm db:migrate )
    wait_for_postgres 60 && ok "Postgres healthy" || warn "Postgres slow to start."
    R_engine=ok
  fi
}

do_service() {
  step "Always-on service"
  local mgr; mgr="$(service_manager)"
  if [[ "$mgr" == unsupported ]]; then
    warn "No supported service manager (need macOS launchd or Linux systemd --user). See ops/systemd/README.md."
    R_service=unsupported; return
  fi
  if [[ $DRY_RUN == 1 ]]; then info "(dry-run) would install the always-on service ($mgr)"; R_service=planned; return; fi
  bash "$REPO_ROOT/scripts/service.sh" install; R_service=ok
}

do_voice() {
  step "Voice stack (advanced)"
  if ! is_macos; then warn "The voice stack is macOS-only (launchd + whisper + local TTS)."; R_voice=unsupported; return; fi
  if [[ $DRY_RUN == 1 ]]; then info "(dry-run) would build the TCC apps + load the 5 voice agents"; R_voice=planned; return; fi
  bash "$REPO_ROOT/scripts/voice.sh" install; R_voice=ok
}

do_mcp() {
  step "Register with Claude Code"
  if ! have claude; then
    warn "'claude' CLI not found — register manually: claude mcp add --transport http tars $MCP_URL"
    R_mcp=manual R_mcp_state=manual; return
  fi
  if claude mcp list 2>/dev/null | grep -q '\btars\b'; then ok "'tars' already registered"; R_mcp=ok R_mcp_state=exists; return; fi
  if [[ $DRY_RUN == 1 ]]; then info "(dry-run) would register tars → $MCP_URL"; R_mcp=planned R_mcp_state=planned; return; fi
  if claude mcp add --transport http tars "$MCP_URL" >/dev/null 2>&1; then ok "Registered tars → $MCP_URL"; R_mcp=ok R_mcp_state=registered
  else warn "Auto-registration failed; add manually: claude mcp add --transport http tars $MCP_URL"; R_mcp=manual R_mcp_state=manual; fi
}

do_persona() {
  step "TARS persona"
  [[ -f "$PROMPT_SRC" ]] || { warn "prompt source missing"; R_persona=skipped; return; }
  local owner="$OWNER_NAME"
  [[ -z "$owner" ]] && have git && owner="$(git config --get user.name 2>/dev/null || true)"
  [[ -z "$owner" ]] && has_tty && { printf '%sWhat should TARS call you?%s ' "$_C_BOLD" "$_C_RESET" >/dev/tty; read -r owner </dev/tty || true; }
  R_owner="$owner"

  if [[ -z "$owner" ]]; then
    # No name and no way to ask — write the file with the placeholder, don't touch CLAUDE.md.
    if [[ $DRY_RUN == 0 ]]; then
      mkdir -p "$(dirname "$PERSONALIZED_PROMPT")"
      awk '/^```text/{f=1;next} f&&/^```/{exit} f{print}' "$PROMPT_SRC" > "$PERSONALIZED_PROMPT"
    fi
    warn "No owner name — wrote $PERSONALIZED_PROMPT with the {{OWNER_NAME}} placeholder."
    warn "Finish with: tars persona --owner-name 'Your Name' --install"
    R_persona=needs-name; return
  fi

  if [[ $DRY_RUN == 1 ]]; then info "(dry-run) would personalize for '$owner' and write $PERSONALIZED_PROMPT"; R_persona=planned; return; fi
  mkdir -p "$(dirname "$PERSONALIZED_PROMPT")"
  awk '/^```text/{f=1;next} f&&/^```/{exit} f{print}' "$PROMPT_SRC" | sed "s/{{OWNER_NAME}}/$owner/g" > "$PERSONALIZED_PROMPT"
  [[ -s "$PERSONALIZED_PROMPT" ]] || { warn "could not extract prompt block"; R_persona=skipped; return; }
  ok "Wrote personalized prompt → $PERSONALIZED_PROMPT"
  R_persona=written

  local want_install=0
  if [[ $INSTALL_PROMPT == 1 ]]; then want_install=1
  elif [[ $INSTALL_PROMPT == -1 ]] && confirm "Install it into $CLAUDE_MD?"; then want_install=1; fi
  if [[ $want_install == 1 ]]; then
    install_prompt_block "$CLAUDE_MD" "$PERSONALIZED_PROMPT"
    ok "Installed into $CLAUDE_MD (managed block; original backed up)."
    R_persona=installed R_persona_installed=true
  else
    info "Not merged into CLAUDE.md — paste $PERSONALIZED_PROMPT wherever you talk to Claude."
  fi
}

install_prompt_block() { # <target> <content-file> — replace-or-append a managed block
  local target="$1" content="$2" tmp
  local begin='<!-- TARS:BEGIN (managed by tars init — edit above/below, not inside) -->'
  local end='<!-- TARS:END -->'
  mkdir -p "$(dirname "$target")"
  [[ -f "$target" ]] && cp "$target" "$target.tars-bak.$(date +%Y%m%d%H%M%S)"
  tmp="$(mktemp)"
  if [[ -f "$target" ]] && grep -qF "$begin" "$target"; then
    awk -v b="$begin" -v e="$end" -v cf="$content" '
      $0==b { print; while ((getline line < cf) > 0) print line; skip=1; next }
      $0==e { skip=0; print; next }
      skip  { next } { print }' "$target" >"$tmp"
  else
    { [[ -f "$target" ]] && cat "$target"; printf '\n%s\n' "$begin"; cat "$content"; printf '%s\n' "$end"; } >"$tmp"
  fi
  mv "$tmp" "$target"
}

emit_json() {
  local su; su=$(server_up && echo true || echo false)
  printf '{'
  printf '"ok":true,"dryRun":%s,"os":"%s","serverUp":%s,' \
    "$([[ $DRY_RUN == 1 ]] && echo true || echo false)" \
    "$(is_macos && echo macos || echo linux)" "$su"
  printf '"components":{'
  printf '"engine":{"selected":%s,"status":"%s","profile":"%s"},' "$([[ $SEL_engine == 1 ]] && echo true || echo false)" "$R_engine" "$(json_escape "$PROFILE")"
  printf '"service":{"selected":%s,"status":"%s"},' "$([[ $SEL_service == 1 ]] && echo true || echo false)" "$R_service"
  printf '"mcp":{"selected":%s,"status":"%s","url":"%s"},' "$([[ $SEL_mcp == 1 ]] && echo true || echo false)" "$R_mcp" "$MCP_URL"
  printf '"persona":{"selected":%s,"status":"%s","installed":%s,"ownerName":"%s","promptPath":"%s"},' \
    "$([[ $SEL_persona == 1 ]] && echo true || echo false)" "$R_persona" "$R_persona_installed" \
    "$(json_escape "$R_owner")" "$(json_escape "$PERSONALIZED_PROMPT")"
  printf '"voice":{"selected":%s,"status":"%s"}' "$([[ $SEL_voice == 1 ]] && echo true || echo false)" "$R_voice"
  printf '},'
  printf '"nextSteps":["Connect MCP companions (docs/mcps.md)","Seed the brain once (docs/routines/bootstrap.md)","Schedule Dream + Briefing (docs/routines/)"]'
  printf '}\n'
}

# --- Run -----------------------------------------------------------------------------------
step "Tars setup"
info "Self-hosted, single-user memory for your AI assistant. The brain ships EMPTY."
info "Plan: engine=$SEL_engine service=$SEL_service mcp=$SEL_mcp persona=$SEL_persona voice=$SEL_voice  (profile=${PROFILE:-auto}, dry-run=$DRY_RUN)"

[[ $SEL_engine  == 1 ]] && do_engine
[[ $SEL_service == 1 ]] && do_service
[[ $SEL_voice   == 1 ]] && do_voice
[[ $SEL_mcp     == 1 ]] && do_mcp
[[ $SEL_persona == 1 ]] && do_persona

if [[ $DRY_RUN == 0 && $NO_VERIFY == 0 && $SEL_engine == 1 ]]; then
  step "Verifying"; bash "$REPO_ROOT/scripts/doctor.sh" || warn "Doctor reported issues."
fi

step "Done"
info "Next: connect MCP companions (docs/mcps.md) · seed the brain (docs/routines/bootstrap.md) ·"
info "schedule Dream + Briefing (docs/routines/). Full runbook: docs/onboarding.md."

[[ $JSON == 1 ]] && emit_json >&4
exit 0
