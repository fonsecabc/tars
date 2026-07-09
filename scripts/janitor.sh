#!/usr/bin/env bash
# make install-janitor | uninstall-janitor | janitor-status
# Installs/manages the com.tars.janitor launchd agent (periodic process-hygiene sweep).
# Self-contained: mirrors scripts/service.sh's bootout->wait->bootstrap dance without
# depending on the server-specific vars in lib.sh.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.tars.janitor"
TEMPLATE="$REPO_ROOT/ops/launchd/$LABEL.plist"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
TARGET="gui/$(id -u)/$LABEL"

[[ "$(uname)" == "Darwin" ]] || { echo "macOS only"; exit 1; }

install_janitor() {
  [[ -f "$TEMPLATE" ]] || { echo "Template not found: $TEMPLATE"; exit 1; }
  echo "Installing $LABEL (repo: $REPO_ROOT)"
  mkdir -p "$HOME/Library/LaunchAgents"
  # Fill the template's path placeholder. '|' delimiter is space/slash-safe.
  sed -e "s|/ABSOLUTE/PATH/TO/tars|$REPO_ROOT|g" "$TEMPLATE" > "$PLIST"
  chmod +x "$REPO_ROOT/ops/launchd/tars-janitor.sh"

  # Clean reinstall: bootout any prior instance, wait for async teardown, then bootstrap.
  launchctl bootout "$TARGET" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do launchctl print "$TARGET" >/dev/null 2>&1 || break; sleep 0.5; done
  if ! launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null; then
    sleep 2; launchctl bootstrap "gui/$(id -u)" "$PLIST"
  fi
  launchctl enable "$TARGET" >/dev/null 2>&1 || true
  echo "Installed. Runs every 30 min; RunAtLoad fired once now."
  echo "Log: /tmp/tars-janitor.log"
}

uninstall_janitor() {
  launchctl bootout "$TARGET" >/dev/null 2>&1 || true
  rm -f "$PLIST"
  echo "$LABEL stopped and plist removed."
}

status_janitor() {
  launchctl print "$TARGET" >/dev/null 2>&1 && echo "$LABEL: LOADED" || echo "$LABEL: not loaded"
  [[ -f /tmp/tars-janitor.log ]] && { echo "--- last run ---"; tail -6 /tmp/tars-janitor.log; }
}

case "${1:-}" in
  install) install_janitor ;;
  uninstall) uninstall_janitor ;;
  status) status_janitor ;;
  *) echo "usage: $0 {install|uninstall|status}"; exit 2 ;;
esac
