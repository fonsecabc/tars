#!/usr/bin/env node
// tars-sessions — TARS's situational awareness of the Claude Code sessions the user is
// running. Reads the session transcripts under ~/.claude/projects (the same JSONL
// files Claude Code writes) plus the live `claude` processes, and produces a compact
// snapshot: which projects have work in flight, what each one is doing, how fresh it
// is, and whether it's still running.
//
// This is what lets the gem answer "what am I working on?" / "how's the annotation
// session going?" without bothering Claude. Read-only; never writes.
//
//   import { snapshotSessions } from './tars-sessions.mjs'
//   CLI:  node tars-sessions.mjs            -> pretty snapshot
//         node tars-sessions.mjs --json     -> compact JSON
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const execFileP = promisify(execFile);
const PROJECTS = join(homedir(), '.claude', 'projects');
const FRESH_HOURS = Number(process.env.TARS_SESSION_HOURS || 12);
const TAIL_BYTES = 96 * 1024;

// Read the last ~N bytes of a file without slurping the whole transcript.
function tail(path, bytes = TAIL_BYTES) {
  const size = statSync(path).size;
  const start = Math.max(0, size - bytes);
  const len = size - start;
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.allocUnsafe(len);
    readSync(fd, buf, 0, len, start);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

// Pull the human-readable text out of a message.content (string or block array).
function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .filter((b) => b?.type === 'text')
      .map((b) => b.text)
      .join(' ');
  return '';
}

// A project label a human would recognize: the repo dir, with the worktree noise
// ("/.claude/worktrees/keen-bhabha-f26fdf") stripped off.
function projectLabel(cwd) {
  if (!cwd) return '(unknown)';
  const base = cwd.split('/.claude/worktrees/')[0];
  const parts = base.split('/').filter(Boolean);
  return parts.slice(-2).join('/') || base;
}

// Walk every *.jsonl transcript (skipping subagent sidechain logs), newest first.
function transcriptFiles() {
  const out = [];
  let projDirs = [];
  try {
    projDirs = readdirSync(PROJECTS);
  } catch {
    return out;
  }
  for (const proj of projDirs) {
    const dir = join(PROJECTS, proj);
    let files = [];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const path = join(dir, f);
      try {
        const st = statSync(path);
        if (!st.isFile()) continue;
        out.push({ path, proj, mtime: st.mtimeMs });
      } catch {
        /* ignore */
      }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

const TERMINAL_APPS = new Set([
  'Terminal',
  'iTerm2',
  'iTerm',
  'Ghostty',
  'WezTerm',
  'kitty',
  'Alacritty',
  'Warp',
  'Hyper',
]);

// Walk the parent chain of a pid to find the hosting GUI app (…/X.app/Contents/MacOS/X).
async function hostAppOf(pid) {
  let cur = pid;
  for (let i = 0; i < 12 && cur && cur !== '1'; i++) {
    let ppid, comm;
    try {
      const { stdout } = await execFileP('/bin/ps', ['-o', 'ppid=,comm=', '-p', cur]);
      const line = stdout.trim();
      const sp = line.indexOf(' ');
      ppid = line.slice(0, sp).trim();
      comm = line.slice(sp + 1).trim();
    } catch {
      break;
    }
    const m = comm.match(/\/([^/]+)\.app\/Contents\/MacOS\//);
    if (m) return m[1]; // e.g. "Terminal", "iTerm2", "Claude"
    cur = ppid;
  }
  return null;
}

// Every running `claude` process → {cwd, host, tty, app}. host is 'terminal' (has a real
// ttysNNN, hosted by a terminal app — independently targetable) or 'desktop' (inside the
// Claude app, no tty — one window, not per-session targetable).
async function runningProcs() {
  const procs = [];
  let pids = [];
  try {
    const { stdout } = await execFileP('/bin/sh', ['-c', 'pgrep -x claude']);
    pids = stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return procs;
  }
  for (const pid of pids) {
    let cwd = null,
      tty = null;
    try {
      const { stdout } = await execFileP('/usr/sbin/lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn']);
      cwd =
        stdout
          .split('\n')
          .find((l) => l.startsWith('n'))
          ?.slice(1) || null;
    } catch {
      /* ignore */
    }
    try {
      const { stdout } = await execFileP('/bin/ps', ['-o', 'tty=', '-p', pid]);
      const t = stdout.trim();
      if (t && t !== '??') tty = t;
    } catch {
      /* ignore */
    }
    if (!cwd) continue;
    const app = await hostAppOf(pid);
    const host = tty && app && TERMINAL_APPS.has(app) ? 'terminal' : 'desktop';
    procs.push({ pid, cwd, tty, app, host });
  }
  return procs;
}

export async function snapshotSessions({ limit = 8 } = {}) {
  const cutoff = Date.now() - FRESH_HOURS * 3600 * 1000;
  const procs = await runningProcs();
  const files = transcriptFiles().filter((f) => f.mtime >= cutoff);

  // One session per project: the freshest transcript wins (Claude Code rotates ids).
  const byProject = new Map();
  for (const f of files) {
    const parsed = readSession(f);
    if (!parsed) continue;
    const key = projectLabel(parsed.cwd);
    const prev = byProject.get(key);
    if (!prev || f.mtime > prev.mtime)
      byProject.set(key, { ...parsed, mtime: f.mtime, project: key });
  }

  const sessions = [...byProject.values()]
    .map((s) => {
      // A running proc whose cwd maps to this project carries the host/tty for targeting.
      // Prefer a terminal proc (independently targetable) over a desktop one.
      const mine = procs.filter((p) => projectLabel(p.cwd) === s.project);
      const proc = mine.find((p) => p.host === 'terminal') || mine[0];
      return {
        ...s,
        running: !!proc,
        host: proc?.host || null,
        tty: proc?.tty || null,
        app: proc?.app || null,
      };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
  return sessions;
}

function readSession(f) {
  let text;
  try {
    text = tail(f.path);
  } catch {
    return null;
  }
  const lines = text.split('\n').filter(Boolean);
  // The tail may start mid-line; drop the first (likely partial) line.
  if (lines.length > 1) lines.shift();
  let cwd = null,
    sessionId = null,
    lastUser = null,
    lastAssistant = null,
    lastTs = null;
  for (const line of lines) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.cwd) cwd = o.cwd;
    if (o.sessionId) sessionId = o.sessionId;
    if (o.timestamp) lastTs = o.timestamp;
    if (o.isSidechain === true) continue; // subagent chatter
    if (o.type === 'user' && o.message?.content) {
      const t = textOf(o.message.content).trim();
      // skip tool_result-only user turns and slash-command/meta noise
      if (t && !t.startsWith('<') && !o.isMeta) lastUser = t;
    }
    if (o.type === 'assistant' && o.message?.content) {
      const t = textOf(o.message.content).trim();
      if (t) lastAssistant = t;
    }
  }
  if (!cwd && !sessionId) return null;
  return { cwd, sessionId, lastUser, lastAssistant, lastTs };
}

const clip = (s, n) => {
  s = (s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
function ago(ts) {
  if (!ts) return '?';
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

// Fuzzy-match a spoken session name ("the finance one", "annotation") to a session by
// its project label. Scores by how much of the label the query words cover; returns the
// best hit or null. Deliberately loose — whisper mangles names and the user speaks casually.
export function matchSession(sessions, query) {
  const q = String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .trim();
  if (!q) return null;
  const stop = new Set(['the', 'one', 'session', 'project', 'my', 'a', 'to', 'on', 'in', 'that']);
  const words = q.split(/\s+/).filter((w) => w.length > 2 && !stop.has(w));
  if (!words.length) return null;
  let best = null,
    bestScore = 0;
  for (const s of sessions) {
    const hay = (s.project || '').toLowerCase().replace(/[^a-z0-9]/g, ' ');
    let score = 0;
    for (const w of words) if (hay.includes(w)) score += w.length;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return bestScore > 0 ? best : null;
}

// A short, speech-friendly rundown the gem can read or summarize. Includes both the last
// thing the user asked AND what the session last said back, plus its host (terminal/desktop),
// so the gem can answer "what am I working on" and "what's finance doing" without Claude.
export function describeSessions(sessions) {
  if (!sessions.length) return 'No active sessions.';
  return sessions
    .map((s, i) => {
      const state = s.running ? `running${s.host === 'terminal' ? ' (terminal)' : ''}` : 'idle';
      const ask = clip(s.lastUser, 80);
      const said = clip(s.lastAssistant, 100);
      const parts = [`${i + 1}. ${s.project} — ${state}, ${ago(s.lastTs)}`];
      if (ask) parts.push(`  last ask: ${ask}`);
      if (said) parts.push(`  last reply: ${said}`);
      return parts.join('\n');
    })
    .join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('tars-sessions.mjs')) {
  const s = await snapshotSessions();
  if (process.argv.includes('--json')) console.log(JSON.stringify(s, null, 2));
  else console.log(describeSessions(s));
}
