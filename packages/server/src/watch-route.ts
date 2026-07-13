/**
 * Chronicle live watch dashboard — a single self-contained HTML page served at GET /watch.
 *
 * Pure presentation over the existing read surface: the page polls `GET /sessions` for the
 * session list and opens the SSE `GET /sessions/:id/tail` stream for the selected session.
 * No new data paths, no auth surface of its own — it is mounted alongside the sessions
 * routers and therefore rides ONLY the trusted loopback listener (main.ts wiring). A
 * claude.ai artifact cannot do this job: its CSP blocks all network calls, loopback included.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>TARS · Chronicle</title>
<style>
  :root {
    --bg: #0b0e11; --panel: #12161b; --line: #1f262e; --text: #d7dde3; --dim: #6b7683;
    --accent: #e8b04b; --green: #6fbf73; --red: #e06c60; --blue: #6da8d8; --purple: #a98fd8;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font: 13px/1.5 "SF Mono", ui-monospace, Menlo, monospace; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
  header { display: flex; align-items: baseline; gap: 14px; padding: 12px 18px; border-bottom: 1px solid var(--line); }
  header h1 { font-size: 14px; letter-spacing: 3px; color: var(--accent); font-weight: 600; }
  header .sub { color: var(--dim); font-size: 11px; }
  header .right { margin-left: auto; color: var(--dim); font-size: 11px; }
  #status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--red); margin-right: 6px; vertical-align: middle; }
  #status-dot.ok { background: var(--green); }
  main { flex: 1; display: flex; min-height: 0; }
  #sessions { width: 340px; border-right: 1px solid var(--line); overflow-y: auto; padding: 10px; }
  .session { padding: 9px 10px; border: 1px solid transparent; border-radius: 6px; cursor: pointer; margin-bottom: 6px; }
  .session:hover { background: var(--panel); }
  .session.active { background: var(--panel); border-color: var(--accent); }
  .session .top { display: flex; gap: 8px; align-items: baseline; }
  .origin { font-size: 10px; padding: 1px 6px; border-radius: 4px; font-weight: 600; letter-spacing: 0.5px; }
  .origin.voice { background: #2a2418; color: var(--accent); }
  .origin.whatsapp { background: #16281a; color: var(--green); }
  .origin.cron { background: #14222e; color: var(--blue); }
  .origin.cc-shadow { background: #221b2e; color: var(--purple); }
  .origin.slack { background: #2b1a1a; color: var(--red); }
  .session .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .session .meta { color: var(--dim); font-size: 11px; margin-top: 3px; display: flex; gap: 10px; }
  .tier { text-transform: uppercase; font-size: 9px; letter-spacing: 1px; }
  #tail { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  #tail-head { padding: 10px 18px; border-bottom: 1px solid var(--line); color: var(--dim); font-size: 11px; min-height: 38px; }
  #events { flex: 1; overflow-y: auto; padding: 14px 18px; }
  .ev { margin-bottom: 10px; max-width: 100%; }
  .ev .hd { color: var(--dim); font-size: 10px; margin-bottom: 2px; }
  .ev .hd .kind { color: var(--purple); }
  .ev .hd .actor { color: var(--blue); }
  .ev .body { white-space: pre-wrap; word-break: break-word; }
  .ev.turn_message .body { color: var(--text); }
  .ev.tool_call .body, .ev.tool_result .body { color: var(--dim); font-style: italic; }
  .ev.message .body { color: var(--accent); }
  .ev.signal .body { color: var(--red); }
  .ev.lifecycle .body { color: var(--dim); font-size: 11px; }
  .empty { color: var(--dim); padding: 40px; text-align: center; }
</style>
</head>
<body>
<header>
  <h1>TARS · CHRONICLE</h1>
  <span class="sub">shared session log — live</span>
  <span class="right"><span id="status-dot"></span><span id="counts">connecting…</span></span>
</header>
<main>
  <div id="sessions"><div class="empty">loading sessions…</div></div>
  <div id="tail">
    <div id="tail-head">select a session to tail it live</div>
    <div id="events"><div class="empty">—</div></div>
  </div>
</main>
<script>
(() => {
  const $sessions = document.getElementById('sessions');
  const $events = document.getElementById('events');
  const $tailHead = document.getElementById('tail-head');
  const $dot = document.getElementById('status-dot');
  const $counts = document.getElementById('counts');
  let selected = null;
  let source = null;
  let known = [];

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ago = (iso) => {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return Math.floor(s) + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'd';
  };

  function renderSessions() {
    if (!known.length) { $sessions.innerHTML = '<div class="empty">no sessions yet</div>'; return; }
    $sessions.innerHTML = known.map((s) => \`
      <div class="session \${selected === s.id ? 'active' : ''}" data-id="\${s.id}">
        <div class="top">
          <span class="origin \${esc(s.origin)}">\${esc(s.origin)}</span>
          <span class="title" title="\${esc(s.externalRef ?? s.id)}">\${esc(s.title || s.externalRef || s.id.slice(0, 8))}</span>
        </div>
        <div class="meta">
          <span>\${esc(s.status)}</span>
          <span class="tier">\${esc(s.tier)}</span>
          <span>seq \${esc(s.lastSeq ?? '—')}</span>
          <span>\${ago(s.updatedAt)} ago</span>
        </div>
      </div>\`).join('');
    for (const el of $sessions.querySelectorAll('.session')) {
      el.addEventListener('click', () => select(el.dataset.id));
    }
  }

  async function refreshSessions() {
    try {
      const res = await fetch('/sessions?limit=100');
      known = (await res.json()).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      $dot.classList.add('ok');
      $counts.textContent = known.length + ' session' + (known.length === 1 ? '' : 's');
      renderSessions();
    } catch {
      $dot.classList.remove('ok');
      $counts.textContent = 'server unreachable';
    }
  }

  function describe(ev) {
    const p = ev.payload || {};
    if (ev.kind === 'turn_message') return p.text ?? '';
    if (ev.kind === 'tool_call') return '⚙ tool: ' + (p.name ?? 'unknown');
    if (ev.kind === 'tool_result') return '⚙ tool result';
    if (ev.kind === 'message') return '✉ ' + (p.from_session ? 'from session ' + String(p.from_session).slice(0, 8) : 'from ' + (p.from_harness ?? '?')) + ' — ' + (p.body ?? '');
    if (ev.kind === 'signal') return '⚡ signal: ' + (p.signal ?? '?') + ' (from ' + (p.from_harness ?? '?') + ')';
    if (ev.kind === 'session_opened') return '· session opened via ' + ev.harness;
    if (ev.kind === 'session_closed') return '· session closed';
    if (ev.kind === 'turn_started') return '· turn started' + (p.runId ? ' (' + p.runId + ')' : '');
    if (ev.kind === 'turn_completed') return '· turn completed' + (p.status ? ' — ' + p.status : '');
    if (ev.kind === 'checkpoint') return '· checkpoint';
    return JSON.stringify(p).slice(0, 400);
  }

  function appendEvent(ev) {
    const lifecycle = ['session_opened', 'session_closed', 'turn_started', 'turn_completed', 'checkpoint'].includes(ev.kind);
    const div = document.createElement('div');
    div.className = 'ev ' + (lifecycle ? 'lifecycle' : ev.kind);
    div.innerHTML = '<div class="hd">#' + esc(ev.seq) + ' · <span class="kind">' + esc(ev.kind) + '</span> · <span class="actor">' + esc(ev.actor) + '</span> · ' + esc(new Date(ev.ts).toLocaleTimeString()) + '</div>' +
      '<div class="body">' + esc(describe(ev)) + '</div>';
    $events.appendChild(div);
    $events.scrollTop = $events.scrollHeight;
  }

  function select(id) {
    selected = id;
    renderSessions();
    if (source) { source.close(); source = null; }
    $events.innerHTML = '';
    const s = known.find((x) => x.id === id);
    $tailHead.textContent = (s ? s.origin + ' · ' + (s.title || s.externalRef || id) : id) + ' — streaming';
    source = new EventSource('/sessions/' + id + '/tail');
    source.onmessage = (m) => { try { appendEvent(JSON.parse(m.data)); } catch {} };
    source.onerror = () => { $tailHead.textContent += ' (reconnecting…)'; };
  }

  refreshSessions();
  setInterval(refreshSessions, 3000);
})();
</script>
</body>
</html>`;

/** Serve the live watch dashboard. Mounted with the sessions routers (loopback-only). */
export function createWatchRouter(): Router {
  const router = Router();
  router.get('/watch', (_req: Request, res: Response) => {
    res.type('html').send(PAGE);
  });
  return router;
}
