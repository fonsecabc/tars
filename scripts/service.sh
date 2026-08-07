#!/usr/bin/env bash
# make install-service | uninstall-service | start | stop | restart | logs
# The always-on Tars server, supervised by the OS: launchd on macOS, systemd (per-user)
# on Linux. Both fill a path-agnostic template with this machine's real repo and node paths,
# then bootstrap and start the unit, behind the same make targets.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

MGR="$(service_manager)"
if [[ "$MGR" == "unsupported" ]]; then
  err "No supported service manager here. Need macOS (launchd) or Linux with a reachable"
  err "per-user systemd instance. On a headless Linux box, enable lingering first:"
  err "  sudo loginctl enable-linger $(id -un)"
  err "then re-run. See ops/systemd/README.md."
  exit 1
fi

# ===== launchd (macOS) ======================================================

launchd_install() {
  local target node_dir
  target="$(launchd_target)"
  step "Installing launchd service ($LAUNCHD_LABEL)"
  node_dir="$(resolve_node_dir)"
  info "Repo:  $REPO_ROOT"
  info "Node:  $node_dir/node"

  mkdir -p "$HOME/Library/LaunchAgents"
  render_template "$REPO_ROOT/ops/launchd/com.tars.server.plist" \
    /ABSOLUTE/PATH/TO/tars "$REPO_ROOT" \
    /ABSOLUTE/PATH/TO/node/bin "$node_dir" >"$LAUNCHD_PLIST"
  ok "Wrote $LAUNCHD_PLIST"

  # Reinstall cleanly: bootout any prior instance (legacy 'load' or modern 'bootstrap').
  # bootout teardown is async, so a too-quick bootstrap can fail with EIO(5): wait for the
  # service to actually disappear, then bootstrap with one retry.
  launchctl bootout "$target" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do launchd_loaded || break; sleep 0.5; done
  if ! launchctl bootstrap "gui/$(id -u)" "$LAUNCHD_PLIST" 2>/dev/null; then
    sleep 2
    launchctl bootstrap "gui/$(id -u)" "$LAUNCHD_PLIST"
  fi
  launchctl enable "$target" >/dev/null 2>&1 || true
  launchctl kickstart -k "$target"
  ok "Service bootstrapped and started"
  info "Logs: 'make logs'  ·  Health: 'make doctor'"
}

launchd_uninstall() {
  step "Uninstalling launchd service ($LAUNCHD_LABEL)"
  launchctl bootout "$(launchd_target)" >/dev/null 2>&1 || true
  rm -f "$LAUNCHD_PLIST"
  ok "Service stopped and plist removed"
}

launchd_start() {
  local target; target="$(launchd_target)"
  if launchd_loaded; then
    launchctl kickstart "$target"
    ok "Started (was loaded)"
  elif [[ -f "$LAUNCHD_PLIST" ]]; then
    launchctl bootstrap "gui/$(id -u)" "$LAUNCHD_PLIST"
    ok "Loaded and started"
  else
    die "Service not installed. Run 'make install-service' first."
  fi
}

launchd_stop() {
  # bootout fully stops it despite KeepAlive; the plist file stays for a later 'start'.
  launchctl bootout "$(launchd_target)" >/dev/null 2>&1 || true
  ok "Stopped"
}

launchd_restart() {
  if launchd_loaded; then
    launchctl kickstart -k "$(launchd_target)"
    ok "Restarted"
  else
    launchd_start
  fi
}

launchd_logs() {
  info "Tailing /tmp/tars-server.log (Ctrl-C to stop)"
  touch /tmp/tars-server.log /tmp/tars-server.err.log 2>/dev/null || true
  tail -n 80 -f /tmp/tars-server.log /tmp/tars-server.err.log
}

# ===== systemd (Linux, per-user) ============================================

systemd_install() {
  local node_dir
  step "Installing systemd --user service ($SYSTEMD_UNIT)"
  node_dir="$(resolve_node_dir)"
  info "Repo:  $REPO_ROOT"
  info "Node:  $node_dir/node"

  mkdir -p "$SYSTEMD_USER_DIR"
  render_template "$REPO_ROOT/ops/systemd/tars-server.service" \
    /ABSOLUTE/PATH/TO/tars "$REPO_ROOT" \
    /ABSOLUTE/PATH/TO/node/bin "$node_dir" >"$SYSTEMD_UNIT_PATH"
  ok "Wrote $SYSTEMD_UNIT_PATH"

  # Lingering lets the unit run without an open login session (the launchd-on-login
  # equivalent), so the brain survives logout and comes back on boot. Best-effort: it needs
  # one privileged call. Keep stderr visible so a polkit prompt over SSH is not mistaken for
  # a hang, and pass --no-ask-password so an unauthorized run fails fast instead of blocking.
  if systemd_lingering; then
    ok "Lingering already enabled"
  elif loginctl --no-ask-password enable-linger "$(id -un)"; then
    ok "Enabled lingering (service runs without an active login)"
  else
    warn "Could not enable lingering (needs privileges). The service still runs while you"
    warn "are logged in. For boot/logout persistence, run once:"
    warn "  sudo loginctl enable-linger $(id -un)"
  fi

  systemctl --user daemon-reload
  # enable (not --now) registers the boot-time want; restart then applies a freshly rendered
  # unit to an already-running service and also starts it when inactive. Together these are
  # the analogue of launchd's 'kickstart -k', so a reinstall after moving the repo or bumping
  # node actually takes effect instead of leaving the live process on stale paths.
  systemctl --user enable "$SYSTEMD_UNIT"
  systemctl --user restart "$SYSTEMD_UNIT"
  ok "Service enabled and started"
  info "Logs: 'make logs'  ·  Health: 'make doctor'"
}

systemd_uninstall() {
  step "Uninstalling systemd --user service ($SYSTEMD_UNIT)"
  systemctl --user disable --now "$SYSTEMD_UNIT" >/dev/null 2>&1 || true
  rm -f "$SYSTEMD_UNIT_PATH"
  systemctl --user daemon-reload
  ok "Service stopped and unit removed"
}

systemd_start() {
  systemd_installed || die "Service not installed. Run 'make install-service' first."
  systemctl --user start "$SYSTEMD_UNIT"
  ok "Started"
}

systemd_stop() {
  systemctl --user stop "$SYSTEMD_UNIT" >/dev/null 2>&1 || true
  ok "Stopped"
}

systemd_restart() {
  systemd_installed || die "Service not installed. Run 'make install-service' first."
  systemctl --user restart "$SYSTEMD_UNIT"
  ok "Restarted"
}

systemd_logs() {
  info "Following journalctl --user -u $SYSTEMD_UNIT (Ctrl-C to stop)"
  journalctl --user -u "$SYSTEMD_UNIT" -n 80 -f
}

# ===== dispatch =============================================================
# service_manager() returns exactly the function-family prefix, so the dispatcher itself is
# the seam: a third manager added there routes here automatically instead of silently
# falling into a default. 'unsupported' is already rejected above.
svc() { "${MGR}_$1"; }

case "${1:-}" in
  install)   svc install ;;
  uninstall) svc uninstall ;;
  start)     svc start ;;
  stop)      svc stop ;;
  restart)   svc restart ;;
  logs)      svc logs ;;
  *) die "usage: service.sh {install|uninstall|start|stop|restart|logs}" ;;
esac
