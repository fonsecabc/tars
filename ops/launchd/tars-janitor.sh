#!/bin/bash
# Tars janitor — the process-hygiene safety net.
#
# Invoked every 30 min by the com.tars.janitor launchd agent (StartInterval=1800).
# It reaps the three things that silently pile up as autonomous agents come and go
# and eventually exhaust RAM/swap (the failure we hit on 2026-07-06):
#
#   1. ORPHANED MCP SERVERS  — stdio MCP servers (whatsapp/macos/linkedin/flights/
#      metabase/...) whose parent Claude session already died (ppid==1). They serve
#      nothing and respawn on demand, so killing them is always safe.
#   2. STUCK KEEPALIVE LOOPS — shells an agent spawned to pin a session open forever,
#      e.g. `until [ ! -e /dev/null ]; do sleep 60; done` (condition is never true).
#   3. IDLE CLAUDE SESSIONS  — claude-code workers older than IDLE_MAX_HOURS that show
#      ZERO CPU progress across a sampling window (i.e. genuinely abandoned, not just
#      waiting on a running child). Transcripts persist, so a reaped session is
#      resumable — but we stay conservative to never touch live work.
#
# Everything it does is logged to /tmp/tars-janitor.log with a timestamp. SIGTERM first
# (graceful), never SIGKILL — a still-working process keeps its CPU delta and is spared.
set -u

# ---- tunables (override via the plist's EnvironmentVariables if needed) --------------
IDLE_MAX_HOURS="${TARS_JANITOR_IDLE_MAX_HOURS:-24}"   # session must be idle this long
CPU_SAMPLE_SECS="${TARS_JANITOR_CPU_SAMPLE_SECS:-20}" # idle = no CPU movement over this
LOG="${TARS_JANITOR_LOG:-/tmp/tars-janitor.log}"
DRY_RUN="${TARS_JANITOR_DRY_RUN:-0}"                  # 1 = report only, kill nothing

export PATH="${PATH:-/usr/bin:/bin}:/opt/homebrew/bin:/usr/local/bin:/usr/sbin:/sbin"

log() { printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$*" >> "$LOG"; }
term() { # term <pid> <why>
  local pid="$1" why="$2"
  if [ "$DRY_RUN" = "1" ]; then log "DRY would-kill pid=$pid ($why)"; return; fi
  kill -TERM "$pid" 2>/dev/null && log "reaped pid=$pid ($why)"
}

# Command-line signature of the stdio MCP servers we spawn (keep in sync with ~/.claude).
MCP_RE='whatsapp-mcp|fli-mcp|macos-mcp|mcp-server-linkedin|metabase-mcp|archive-v0/[^ ]*mcp|/mcp-server'
# The exact forever-loop leak signature — deliberately narrow so we never kill a real loop.
LOOP_RE='until \[ ! -e /dev/null \]|while :; *do sleep|while true; *do sleep'

log "=== janitor run start (idle_max=${IDLE_MAX_HOURS}h, dry=${DRY_RUN}) ==="
n_orphan=0 n_loop=0 n_idle=0

# ---- 1. orphaned MCP servers (ppid == 1 and matches an MCP signature) ----------------
while read -r pid ppid rest; do
  [ "$ppid" = "1" ] || continue
  case "$rest" in
    *grep*|*tars-janitor*) continue ;;
  esac
  if printf '%s' "$rest" | grep -Eq "$MCP_RE"; then
    term "$pid" "orphaned MCP server"; n_orphan=$((n_orphan+1))
  fi
done < <(ps -axo pid=,ppid=,command=)

# ---- 2. stuck keepalive loops --------------------------------------------------------
while read -r pid rest; do
  case "$rest" in *tars-janitor*) continue ;; esac
  if printf '%s' "$rest" | grep -Eq "$LOOP_RE"; then
    term "$pid" "stuck keepalive loop"; n_loop=$((n_loop+1))
  fi
done < <(ps -axo pid=,command= | grep -E "$LOOP_RE" | grep -v grep)

# ---- 3. idle claude-code sessions (old AND no CPU progress) --------------------------
# First pass: collect candidate worker pids (claude-code, older than the threshold).
idle_cutoff=$(( IDLE_MAX_HOURS * 3600 ))
declare -a cand=() cpu0=()
while read -r pid etime cputime rest; do
  case "$rest" in *claude-code/2*) : ;; *) continue ;; esac
  case "$rest" in *disclaimer*) continue ;; esac   # skip the tiny wrapper, target the worker
  # elapsed -> seconds (handles [[dd-]hh:]mm:ss)
  secs=$(printf '%s' "$etime" | awk -F'[-:]' '{
    if (NF==4) print (($1*24+$2)*60+$3)*60+$4;
    else if (NF==3) print (($1*60)+$2)*60+$3;
    else if (NF==2) print $1*60+$2; else print $1 }')
  [ "${secs:-0}" -ge "$idle_cutoff" ] || continue
  cand+=("$pid"); cpu0+=("$cputime")
done < <(ps -axo pid=,etime=,time=,command=)

if [ "${#cand[@]}" -gt 0 ]; then
  sleep "$CPU_SAMPLE_SECS"
  i=0
  for pid in "${cand[@]}"; do
    cpu_now=$(ps -o time= -p "$pid" 2>/dev/null | tr -d ' ')
    [ -n "$cpu_now" ] || { i=$((i+1)); continue; }   # already gone
    if [ "$cpu_now" = "${cpu0[$i]}" ]; then           # no CPU movement -> idle
      term "$pid" "idle claude session >${IDLE_MAX_HOURS}h (cpu ${cpu_now})"; n_idle=$((n_idle+1))
    fi
    i=$((i+1))
  done
fi

log "=== janitor run end: orphans=$n_orphan loops=$n_loop idle_sessions=$n_idle ==="
