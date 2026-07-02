#!/usr/bin/env node
// tars-speak — the single TTS "mouth" for TARS. One loopback service that every
// producer (the Claude Code Stop hook, the ambient reader, future voice sessions)
// POSTs text to. It owns: speakify (markdown->speech via the gem), a 2-level
// priority queue (interactive preempts ambient), dedupe, mute, and a pluggable
// speech backend (macOS `say` now; ElevenLabs later). Loopback, no auth — same
// posture as the brain MCP.
import http from 'node:http'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { speakify } from './speakify.mjs'
import { applyLexicon } from './lexicon.mjs'

const execFileP = promisify(execFile)

const PORT = Number(process.env.SPEAK_PORT || 8790)
const VOICE = process.env.TARS_VOICE_NAME || ''   // '' => system default voice
const RATE = process.env.TARS_VOICE_RATE || ''    // '' => default rate; else wpm
const QUEUE_MAX = Number(process.env.SPEAK_QUEUE_MAX || 20)
const DEDUPE_MS = Number(process.env.SPEAK_DEDUPE_MS || 10 * 60 * 1000)

const TARS_DIR = join(homedir(), '.tars')
const MUTED_FLAG = join(TARS_DIR, 'voice.muted')
try { mkdirSync(TARS_DIR, { recursive: true }) } catch { /* ignore */ }

const log = (...a) => console.log(new Date().toISOString(), ...a)
const isMuted = () => existsSync(MUTED_FLAG)

// Phonetic respelling for names Kokoro's English G2P would otherwise mispronounce.
// Applied ONLY to what's actually sent to the speech backend — never to logs, the
// /speak response body, or dedupe hashing, which all stay on the real spelling.
const PRONOUNCE = [[/\bcaio\b/gi, 'Kyle']]
function toSpeechText(text) {
  let out = text
  for (const [re, sub] of PRONOUNCE) out = out.replace(re, sub)
  return out
}

// ---- speech backend (swap this for ElevenLabs in Phase 5; same interface) ----
function makeSayBackend() {
  let child = null
  return {
    name: 'say',
    speak(text) {
      return new Promise((resolve) => {
        const args = []
        if (VOICE) args.push('-v', VOICE)
        if (RATE) args.push('-r', String(RATE))
        try {
          child = spawn('/usr/bin/say', args, { stdio: ['pipe', 'ignore', 'ignore'] })
        } catch { resolve(); return }
        child.on('error', () => { child = null; resolve() })
        child.on('close', () => { child = null; resolve() })
        child.stdin.on('error', () => {})
        child.stdin.end(text)
      })
    },
    stop() { if (child) { try { child.kill('SIGKILL') } catch { /* ignore */ } child = null } },
  }
}
// Kokoro (local neural TTS) via the warm sidecar; falls back to `say` on any failure.
let seq = 0
function makeKokoroBackend() {
  const url = process.env.KOKORO_URL || 'http://127.0.0.1:8791/say'
  const sayArgs = () => { const a = []; if (VOICE) a.push('-v', VOICE); if (RATE) a.push('-r', String(RATE)); return a }
  let child = null
  const playSay = (text) => new Promise((resolve) => {
    try { child = spawn('/usr/bin/say', sayArgs(), { stdio: ['pipe', 'ignore', 'ignore'] }) } catch { resolve(); return }
    child.on('error', () => { child = null; resolve() })
    child.on('close', () => { child = null; resolve() })
    child.stdin.on('error', () => {})
    child.stdin.end(text)
  })
  const playFile = (path) => new Promise((resolve) => {
    try { child = spawn('/usr/bin/afplay', [path], { stdio: 'ignore' }) } catch { resolve(); return }
    child.on('error', () => { child = null; resolve() })
    child.on('close', () => { child = null; resolve() })
  })
  return {
    name: 'kokoro',
    async speak(text) {
      let wav = null
      try {
        const res = await fetch(url, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }), signal: AbortSignal.timeout(30000),
        })
        if (res.ok) wav = Buffer.from(await res.arrayBuffer())
        else log('kokoro http', res.status)
      } catch (e) { log('kokoro synth failed:', e.message) }
      if (!wav || wav.length < 64) return playSay(text)         // graceful fallback
      const tmp = join(tmpdir(), `tars-speak-${process.pid}-${seq++}.wav`)
      try { writeFileSync(tmp, wav) } catch { return playSay(text) }
      try { await playFile(tmp) } finally { try { rmSync(tmp, { force: true }) } catch { /* ignore */ } }
    },
    stop() { if (child) { try { child.kill('SIGKILL') } catch { /* ignore */ } child = null } },
  }
}

const TTS_BACKEND = process.env.TARS_TTS_BACKEND || 'kokoro'
const backend = TTS_BACKEND === 'say' ? makeSayBackend() : makeKokoroBackend()

// ---- music ducking: pause whatever's playing (Spotify/Music/browser/etc.) while TARS
// talks, resume it after. Uses nowplaying-cli, which drives macOS's system-wide
// MediaRemote framework, so it works regardless of which app owns "Now Playing".
const NOWPLAYING_BIN = process.env.NOWPLAYING_BIN || '/opt/homebrew/bin/nowplaying-cli'
const DUCK_MUSIC = process.env.TARS_DUCK_MUSIC !== '0'

// nowplaying-cli's plain `get <field>` accessor is unreliable (returns 0/null for
// elapsedTime and playbackRate even while actually playing) — confirmed empirically:
// `get-raw` correctly shows PlaybackRate:1 during live Spotify playback while `get
// elapsedTime`/`get playbackRate` both return garbage. `get --json` uses a different,
// correct code path. Only ever RESUME what we ourselves paused, so we never restart
// music the user deliberately paused.
async function isMediaPlaying() {
  try {
    const { stdout } = await execFileP(NOWPLAYING_BIN, ['get', '--json', 'playbackRate'], { timeout: 1000 })
    const data = JSON.parse(stdout)
    return Number(data.playbackRate) > 0
  } catch { return false }
}
function mediaPause() { execFile(NOWPLAYING_BIN, ['pause'], () => {}) }
function mediaResume() { execFile(NOWPLAYING_BIN, ['play'], () => {}) }

// ---- 2-level priority queue + single worker ----
const queues = { interactive: [], ambient: [] }
let playing = null       // { priority } while an utterance is on the speakers
let pumping = false

function dequeue() {
  if (queues.interactive.length) return { text: queues.interactive.shift(), priority: 'interactive' }
  if (queues.ambient.length) return { text: queues.ambient.shift(), priority: 'ambient' }
  return null
}

function enqueue(text, priority) {
  const q = queues[priority]
  q.push(text)
  while (q.length > QUEUE_MAX) q.shift()             // bound; drop oldest
  // interactive preempts a playing ambient utterance
  if (priority === 'interactive' && playing && playing.priority === 'ambient') backend.stop()
  pump()
}

async function pump() {
  if (pumping) return
  pumping = true
  let duckedMusic = false
  try {
    for (;;) {
      if (isMuted()) { queues.interactive.length = 0; queues.ambient.length = 0; break }
      const item = dequeue()
      if (!item) break
      if (DUCK_MUSIC && !duckedMusic) {
        if (await isMediaPlaying()) {
          duckedMusic = true
          mediaPause()
          log('music: playing -> paused for speech')
        } else {
          log('music: not playing, nothing to duck')
        }
      }
      playing = { priority: item.priority }
      log(`speak [${item.priority}] ${JSON.stringify(item.text).slice(0, 120)}`)
      await backend.speak(toSpeechText(item.text))
      playing = null
    }
  } finally {
    playing = null
    pumping = false
    if (duckedMusic) { mediaResume(); log('music: resumed') }
  }
}

// ---- dedupe (never say the same thing twice within the window) ----
const recent = new Map()
const norm = (t) => String(t).toLowerCase().replace(/\s+/g, ' ').trim()
const keyOf = (t) => createHash('sha1').update(norm(t)).digest('hex')
function isDupe(text) {
  const now = Date.now()
  for (const [k, ts] of recent) if (now - ts > DEDUPE_MS) recent.delete(k)
  const k = keyOf(text)
  if (recent.has(k)) return true
  recent.set(k, now)
  return false
}

// ---- HTTP ----
function json(res, code, obj) {
  try { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
  catch { /* client may have hung up (hook fire-and-forget) */ }
}
function readBody(req) {
  return new Promise((resolve) => {
    let buf = ''
    req.on('data', (c) => (buf += c))
    req.on('end', () => { try { resolve(JSON.parse(buf || '{}')) } catch { resolve(null) } })
    req.on('error', () => resolve(null))
  })
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/speak') {
    const body = await readBody(req)
    if (!body) return json(res, 400, { error: 'bad json' })
    const text = body.text
    if (!text || !String(text).trim()) return json(res, 200, { dropped: 'empty' })
    if (isMuted()) return json(res, 200, { dropped: 'muted' })
    const priority = body.priority === 'interactive' ? 'interactive' : 'ambient'
    let speech = body.raw ? String(text).trim() : await speakify(String(text))
    if (!speech) return json(res, 200, { dropped: 'skip' })
    speech = applyLexicon(speech)   // pronunciation fixes, applied last so they survive speakify
    if (isDupe(speech)) return json(res, 200, { dropped: 'dupe' })
    enqueue(speech, priority)
    return json(res, 200, { queued: true, priority, text: speech })
  }
  if (req.method === 'POST' && req.url === '/stop') {
    const body = (await readBody(req)) || {}
    const scope = body.scope || 'all'
    if (scope === 'all') { queues.interactive.length = 0; queues.ambient.length = 0 }
    backend.stop()
    return json(res, 200, { ok: true, scope })
  }
  if (req.method === 'POST' && req.url === '/mute') {
    const body = (await readBody(req)) || {}
    if (body.on) {
      try { writeFileSync(MUTED_FLAG, String(Date.now())) } catch { /* ignore */ }
      queues.interactive.length = 0; queues.ambient.length = 0
      backend.stop()
    } else {
      try { rmSync(MUTED_FLAG, { force: true }) } catch { /* ignore */ }
    }
    return json(res, 200, { ok: true, muted: isMuted() })
  }
  if (req.url === '/health') {
    return json(res, 200, {
      ok: true, backend: backend.name, muted: isMuted(),
      playing: playing?.priority || null,
      queued: { interactive: queues.interactive.length, ambient: queues.ambient.length },
      voice: VOICE || '(system default)', rate: RATE || '(default)',
      duckMusic: DUCK_MUSIC,
    })
  }
  json(res, 404, { error: 'not found' })
})

server.listen(PORT, '127.0.0.1', () => {
  const fallbackNote = TTS_BACKEND === 'say' ? '' : ` · say-fallback-voice=${VOICE || 'system default'}`
  log(`tars-speak on :${PORT} · backend=${backend.name}${fallbackNote} · muted=${isMuted()}`)
})
