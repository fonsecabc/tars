#!/usr/bin/env bash
# make install-service | uninstall-service | start | stop | restart | logs
# Generates a path-agnostic launchd plist from the template and manages its lifecycle.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_macos

TEMPLATE="$REPO_ROOT/ops/launchd/com.tars.server.plist"
TARGET="$(launchd_target)"

install_service() {
  step "Installing launchd service ($LAUNCHD_LABEL)"
  [[ -f "$TEMPLATE" ]] || die "Template not found: $TEMPLATE"
  have node || die "node not found on PATH — run 'make setup' first."

  local node_bin node_dir
  node_bin="$(command -v node)"
  node_dir="$(dirname "$node_bin")"
  info "Repo:  $REPO_ROOT"
  info "Node:  $node_bin"

  mkdir -p "$HOME/Library/LaunchAgents"
  # Substitute the template's placeholders with this machine's real paths. '|' delimiter
  # avoids clashing with the '/' in paths (the repo path may contain a space — fine).
  sed -e "s|/ABSOLUTE/PATH/TO/tars|$REPO_ROOT|g" \
      -e "s|/ABSOLUTE/PATH/TO/node/bin|$node_dir|g" \
      "$TEMPLATE" >"$LAUNCHD_PLIST"
  ok "Wrote $LAUNCHD_PLIST"

  # Reinstall cleanly: bootout any prior instance (legacy 'load' or modern 'bootstrap').
  # bootout teardown is async, so a too-quick bootstrap can fail with EIO(5) — wait for the
  # service to actually disappear, then bootstrap with one retry.
  launchctl bootout "$TARGET" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do launchd_loaded || break; sleep 0.5; done
  if ! launchctl bootstrap "gui/$(id -u)" "$LAUNCHD_PLIST" 2>/dev/null; then
    sleep 2
    launchctl bootstrap "gui/$(id -u)" "$LAUNCHD_PLIST"
  fi
  launchctl enable "$TARGET" >/dev/null 2>&1 || true
  launchctl kickstart -k "$TARGET"
  ok "Service bootstrapped and started"
  info "Logs: 'make logs'  ·  Health: 'make doctor'"
}

uninstall_service() {
  step "Uninstalling launchd service ($LAUNCHD_LABEL)"
  launchctl bootout "$TARGET" >/dev/null 2>&1 || true
  rm -f "$LAUNCHD_PLIST"
  ok "Service stopped and plist removed"
}

start_service() {
  if launchd_loaded; then
    launchctl kickstart "$TARGET"
    ok "Started (was loaded)"
  elif [[ -f "$LAUNCHD_PLIST" ]]; then
    launchctl bootstrap "gui/$(id -u)" "$LAUNCHD_PLIST"
    ok "Loaded and started"
  else
    die "Service not installed. Run 'make install-service' first."
  fi
}

stop_service() {
  # bootout fully stops it despite KeepAlive; the plist file stays for a later 'start'.
  launchctl bootout "$TARGET" >/dev/null 2>&1 || true
  ok "Stopped"
}

restart_service() {
  if launchd_loaded; then
    launchctl kickstart -k "$TARGET"
    ok "Restarted"
  else
    start_service
  fi
}

logs_service() {
  info "Tailing /tmp/tars-server.log (Ctrl-C to stop)"
  touch /tmp/tars-server.log /tmp/tars-server.err.log 2>/dev/null || true
  tail -n 80 -f /tmp/tars-server.log /tmp/tars-server.err.log
}

case "${1:-}" in
  install)   install_service ;;
  uninstall) uninstall_service ;;
  start)     start_service ;;
  stop)      stop_service ;;
  restart)   restart_service ;;
  logs)      logs_service ;;
  *) die "usage: service.sh {install|uninstall|start|stop|restart|logs}" ;;
esac
