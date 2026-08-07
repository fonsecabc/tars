#!/usr/bin/env bash
# scripts/voice.sh {install|uninstall|status} — the optional always-on VOICE stack
# (ears → router → inject → speak → tts-kokoro). Advanced/heavy: it holds the mic and needs
# whisper + a local TTS. This templates the five launchd plists from their /ABSOLUTE/PATH/TO
# placeholders (like service.sh does for the server), builds the two TCC app bundles, and
# loads the agents. Personalize the owner name via TARS_OWNER_NAME in the repo .env.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_macos "the voice stack"

LA="$HOME/Library/LaunchAgents"
VOICE_LABELS=(com.tars.ears com.tars.inject com.tars.router com.tars.speak com.tars.tts-kokoro)
target() { echo "gui/$(id -u)/$1"; }

# OpenRouter key: read from the repo .env (or env) so it never lives in the tracked plist.
openrouter_key() {
  [[ -n "${OPENROUTER_API_KEY:-}" ]] && { echo "$OPENROUTER_API_KEY"; return; }
  [[ -f "$REPO_ROOT/.env" ]] && grep -E '^OPENROUTER_API_KEY=' "$REPO_ROOT/.env" | head -1 | cut -d= -f2- || true
}

check_prereqs() {
  have whisper-stream || warn "whisper-stream not on PATH (brew install whisper-cpp) — the ears won't run without it."
  local model
  model="$(grep -A1 TARS_WHISPER_MODEL "$REPO_ROOT/ops/launchd/com.tars.ears.plist" | grep string | sed -E 's/.*<string>(.*)<\/string>.*/\1/' || true)"
  [[ -n "$model" && ! -f "${model/\/ABSOLUTE\/PATH\/TO\/HOME/$HOME}" ]] && warn "Whisper model not found — download a ggml model and point TARS_WHISPER_MODEL at it."
  [[ -x "$HOME/.tars/tts-venv/bin/python" ]] || warn "Kokoro TTS venv missing at ~/.tars/tts-venv — speak falls back to macOS 'say' until you create it."
}

install_voice() {
  step "Installing the voice stack (5 launchd agents)"
  local node_dir key
  node_dir="$(resolve_node_dir)"
  key="$(openrouter_key)"
  [[ -z "$key" ]] && warn "No OPENROUTER_API_KEY in .env — the router will use its local Ollama fallback (set the key + rerun to use Claude)."

  info "Building the TCC app bundles (mic + accessibility)…"
  bash "$REPO_ROOT/ops/launchd/tars-ears-app/build.sh" TarsEars tars-ears.mjs microphone
  bash "$REPO_ROOT/ops/launchd/tars-ears-app/build.sh" TarsHands tars-inject.mjs accessibility

  mkdir -p "$LA"
  local label plist dst
  for label in "${VOICE_LABELS[@]}"; do
    plist="$REPO_ROOT/ops/launchd/$label.plist"
    dst="$LA/$label.plist"
    render_template "$plist" \
      /ABSOLUTE/PATH/TO/tars "$REPO_ROOT" \
      /ABSOLUTE/PATH/TO/node/bin "$node_dir" \
      /ABSOLUTE/PATH/TO/HOME "$HOME" \
      YOUR_OPENROUTER_API_KEY "$key" > "$dst"
    launchctl bootout "$(target "$label")" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$(id -u)" "$dst" 2>/dev/null || { sleep 1; launchctl bootstrap "gui/$(id -u)" "$dst"; }
    launchctl enable "$(target "$label")" >/dev/null 2>&1 || true
    launchctl kickstart -k "$(target "$label")" >/dev/null 2>&1 || true
    ok "Loaded $label"
  done
  check_prereqs
  ok "Voice stack installed. Grant Microphone (TarsEars) + Accessibility (TarsHands) in System Settings."
  info "Toggle listening: touch ~/.tars/ears.on (present = on). Logs: /tmp/tars-*.log"
}

uninstall_voice() {
  step "Removing the voice stack"
  local label
  for label in "${VOICE_LABELS[@]}"; do
    launchctl bootout "$(target "$label")" >/dev/null 2>&1 || true
    rm -f "$LA/$label.plist"
    ok "Removed $label"
  done
}

status_voice() {
  step "Voice stack status"
  local label
  for label in "${VOICE_LABELS[@]}"; do
    if launchctl print "$(target "$label")" >/dev/null 2>&1; then ok "$label loaded"; else info "$label not loaded"; fi
  done
}

case "${1:-}" in
  install)   install_voice ;;
  uninstall) uninstall_voice ;;
  status)    status_voice ;;
  *) die "usage: voice.sh {install|uninstall|status}" ;;
esac
