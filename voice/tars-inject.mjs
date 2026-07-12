#!/usr/bin/env node
// tars-inject — the "hands on the keyboard" half of puppeting the live Claude
// Desktop session. Given text (a transcribed utterance), it brings Claude to the
// front, pastes the text into the composer, and optionally presses Return to send.
//
// Why paste, not keystroke: System Events `keystroke` is per-character, slow, and
// mangles unicode/newlines. Putting the text on the clipboard and hitting Cmd+V is
// atomic and exact. We save and restore the user's real clipboard around it.
//
// Loopback HTTP + CLI, no auth — same posture as tars-speak / the brain MCP.
//   POST /inject {text, submit?:true}   -> {ok}
//   GET  /health
//   CLI:  node tars-inject.mjs [--dry] "text to inject"   (--dry = paste, no Return)
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

const PORT = Number(process.env.INJECT_PORT || 8792)
const APP = process.env.TARS_TARGET_APP || 'Claude'          // the app to puppet
const ACTIVATE_DELAY = Number(process.env.INJECT_ACTIVATE_MS || 200) / 1000
const log = (...a) => console.log(new Date().toISOString(), ...a)

function pbpaste() {
  return new Promise((resolve) => {
    execFile('/usr/bin/pbpaste', { maxBuffer: 8 << 20 }, (e, stdout) => resolve(e ? null : stdout))
  })
}
function pbcopy(text) {
  return new Promise((resolve, reject) => {
    const p = execFile('/usr/bin/pbcopy', (e) => (e ? reject(e) : resolve()))
    p.stdin.on('error', reject)
    p.stdin.end(text)
  })
}

// AppleScript: focus the target app, paste, and (optionally) send. `key code 36`
// is Return. We rely on the composer being the focused control on activate, which
// it is when the window was last used for typing.
const osaScript = (submit) => `
tell application "${APP}" to activate
delay ${ACTIVATE_DELAY}
tell application "System Events"
  keystroke "v" using command down
  delay 0.05
  ${submit ? 'key code 36' : ''}
end tell`

// Paste into whatever is already frontmost (used after we've raised a terminal tab).
const pasteScript = (submit) => `
tell application "System Events"
  keystroke "v" using command down
  delay 0.05
  ${submit ? 'key code 36' : ''}
end tell`

// Raise the Terminal.app tab that owns a given tty, so the paste lands in THAT session's
// claude, not whatever was in front. tty from ps is "ttys000" → Terminal reports "/dev/ttys000".
const ttyDev = (tty) => (tty.startsWith('/dev/') ? tty : `/dev/${tty}`)
const raiseTerminalTab = (tty) => `
tell application "Terminal"
  activate
  repeat with w in windows
    repeat with t in tabs of w
      try
        if tty of t is "${ttyDev(tty)}" then
          set selected of t to true
          set frontmost of w to true
          return "ok"
        end if
      end try
    end repeat
  end repeat
end tell
return "notfound"`

// target (optional): {host:'terminal', tty, app} raises that terminal tab first; anything
// else (or absent) falls back to the Claude Desktop app's frontmost window. Desktop
// sub-sessions aren't individually targetable (one window), so 'desktop' == frontmost.
async function inject(text, submit, target) {
  const clean = String(text).trim()
  if (!clean) return { ok: false, error: 'empty' }
  const prev = await pbpaste()
  await pbcopy(clean)
  let landed = APP
  let result = null
  try {
    if (target && target.host === 'terminal' && target.tty && !/iterm/i.test(target.app || '')) {
      const { stdout } = await execFileP('/usr/bin/osascript', ['-e', raiseTerminalTab(target.tty)], { timeout: 6000 })
      if (stdout.trim() === 'ok') {
        await new Promise((r) => setTimeout(r, 150))
        await execFileP('/usr/bin/osascript', ['-e', pasteScript(submit)], { timeout: 8000 })
        landed = `Terminal ${target.tty}`
      } else {
        // tab not found — refuse rather than paste into the wrong window
        log(`inject: terminal tty ${target.tty} not found; skipped`)
        result = { ok: false, error: 'tty-not-found' }
      }
    } else if (target && target.host === 'terminal' && /iterm/i.test(target.app || '')) {
      // iTerm: best-effort activate (no reliable tty→tab select without app-specific model)
      await execFileP('/usr/bin/osascript', ['-e', 'tell application "iTerm" to activate'], { timeout: 6000 })
      await new Promise((r) => setTimeout(r, 200))
      await execFileP('/usr/bin/osascript', ['-e', pasteScript(submit)], { timeout: 8000 })
      landed = 'iTerm (frontmost)'
    } else {
      await execFileP('/usr/bin/osascript', ['-e', osaScript(submit)], { timeout: 8000 })
    }
    if (!result) { log(`inject${submit ? '' : ' [dry]'} -> ${landed}: ${JSON.stringify(clean).slice(0, 100)}`); result = { ok: true, submitted: !!submit, landed } }
  } catch (e) {
    // Never throw out of here — an osascript failure (e.g. missing Accessibility grant,
    // error 1002) must return cleanly, not crash the service on an unhandled rejection.
    const detail = String(e.stderr || e.message || e).slice(0, 160)
    log('inject osascript error:', detail)
    result = { ok: false, error: /1002|not allowed/i.test(detail) ? 'no-accessibility' : 'osascript', detail }
  } finally {
    // The paste has already consumed the clipboard by the time osascript returns;
    // restore the user's real clipboard a beat later so we never clobber it.
    if (prev !== null) setTimeout(() => pbcopy(prev).catch(() => {}), 300)
  }
  return result
}

// ---- general Mac control (the "hands" beyond Claude) ----
// Discrete, deterministic ops driven by the router. Safe ops (app/see/key/type) run on
// request; the RISKY one (run = shell) is gated by a spoken confirm in the router, not here.
const SEE_PATH = '/tmp/tars-see.png'
const osa = (script) => execFileP('/usr/bin/osascript', ['-e', script], { timeout: 8000 })

async function opApp(name) {                          // open / bring an app to the front
  if (!name) return { ok: false, error: 'no app' }
  await execFileP('/usr/bin/open', ['-a', String(name)], { timeout: 8000 })
  return { ok: true, opened: name }
}
async function opRun(command) {                        // arbitrary shell — RISKY (confirm upstream)
  if (!command) return { ok: false, error: 'no command' }
  try {
    const { stdout, stderr } = await execFileP('/bin/zsh', ['-lc', String(command)], { timeout: 60000, maxBuffer: 4 << 20 })
    return { ok: true, stdout: String(stdout || '').slice(0, 4000), stderr: String(stderr || '').slice(0, 800) }
  } catch (e) { return { ok: false, error: 'shell', detail: String(e.stderr || e.message || e).slice(0, 800) } }
}
async function opSee() {                                // screenshot the screen (needs Screen Recording grant)
  try { await execFileP('/usr/sbin/screencapture', ['-x', SEE_PATH], { timeout: 8000 }); return { ok: true, path: SEE_PATH } }
  catch (e) { return { ok: false, error: 'screencapture', detail: String(e.message || e).slice(0, 200) } }
}
async function opType(text) {                           // paste text into whatever app is frontmost
  const clean = String(text || '')
  if (!clean) return { ok: false, error: 'empty' }
  const prev = await pbpaste(); await pbcopy(clean)
  try { await osa('tell application "System Events" to keystroke "v" using command down') }
  catch (e) { return { ok: false, error: /1002|not allowed/i.test(String(e.stderr || e)) ? 'no-accessibility' : 'osascript' } }
  finally { if (prev !== null) setTimeout(() => pbcopy(prev).catch(() => {}), 300) }
  return { ok: true, typed: clean.slice(0, 60) }
}
async function opKey(arg) {                             // volume / mute / media / arbitrary combo
  const a = String(arg || '').toLowerCase().trim()
  try {
    if (/\bunmute\b/.test(a)) { await osa('set volume without output muted'); return { ok: true, did: 'unmute' } }
    if (/\bmute\b/.test(a)) { await osa('set volume with output muted'); return { ok: true, did: 'mute' } }
    const setv = a.match(/volume (?:to )?(\d{1,3})/)
    if (setv) { await osa(`set volume output volume ${Math.min(100, +setv[1])}`); return { ok: true, did: `volume ${setv[1]}` } }
    if (/volume up|louder/.test(a)) { await osa('set volume output volume (output volume of (get volume settings) + 15)'); return { ok: true, did: 'volume up' } }
    if (/volume down|quieter|lower/.test(a)) { await osa('set volume output volume (output volume of (get volume settings) - 15)'); return { ok: true, did: 'volume down' } }
    if (/play|pause|next|previous|skip/.test(a)) { const app = /spotify/.test(a) ? 'Spotify' : 'Music'; const cmd = /next|skip/.test(a) ? 'next track' : /previous/.test(a) ? 'previous track' : 'playpause'; await osa(`tell application "${app}" to ${cmd}`); return { ok: true, did: `${app} ${cmd}` } }
    return { ok: false, error: 'unknown-key', detail: a }
  } catch (e) { return { ok: false, error: 'osascript', detail: String(e.stderr || e.message || e).slice(0, 200) } }
}

async function doOp(op, arg) {
  switch (op) {
    case 'app': return opApp(arg)
    case 'run': return opRun(arg)
    case 'see': return opSee()
    case 'type': return opType(arg)
    case 'key': return opKey(arg)
    default: return { ok: false, error: 'unknown-op', op }
  }
}

// ---- CLI ----
const argv = process.argv.slice(2)
if (argv.length && !argv.includes('--serve')) {
  const dry = argv.includes('--dry')
  const text = argv.filter((a) => a !== '--dry' && a !== '--serve').join(' ')
  inject(text, !dry).then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) })
} else {
  // ---- HTTP ----
  const json = (res, code, obj) => { try { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) } catch { /* hung up */ } }
  const readBody = (req) => new Promise((resolve) => {
    let buf = ''
    req.on('data', (c) => (buf += c))
    req.on('end', () => { try { resolve(JSON.parse(buf || '{}')) } catch { resolve(null) } })
    req.on('error', () => resolve(null))
  })
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/inject') {
      const body = await readBody(req)
      if (!body || !body.text) return json(res, 400, { error: 'missing text' })
      const r = await inject(body.text, body.submit !== false, body.target)   // submit defaults true
      return json(res, r.ok ? 200 : 400, r)
    }
    if (req.method === 'POST' && req.url === '/do') {
      const body = await readBody(req)
      if (!body || !body.op) return json(res, 400, { error: 'missing op' })
      const r = await doOp(body.op, body.arg)
      log(`do ${body.op} ${JSON.stringify(body.arg || '').slice(0, 80)} -> ${JSON.stringify(r).slice(0, 120)}`)
      return json(res, r.ok ? 200 : 400, r)
    }
    if (req.url === '/health') return json(res, 200, { ok: true, app: APP, port: PORT })
    json(res, 404, { error: 'not found' })
  })
  server.listen(PORT, '127.0.0.1', () => log(`tars-inject on :${PORT} · target=${APP}`))
}
