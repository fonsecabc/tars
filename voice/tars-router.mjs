#!/usr/bin/env node
// tars-router — the gem. The local-model front that everything you say hits first.
// It is NOT a pipe to Claude: it answers the small stuff itself in TARS's voice
// ("On it.", "Copy.", "The annotation session is idle."), tracks which session you're
// focused on, reads a session's latest reply aloud on request, and only hands work to
// the live Claude session when the ask actually needs Claude.
//
//   ears -> POST /hear {text, addressed} -> [gem picks an action] ->
//     answer        : speak a reply
//     focus_session : lock onto a named session (follow-ups target it)
//     read_session  : read that session's latest reply aloud (summarized for speech)
//     send_to_claude: (only if addressed) paste an instruction into the live Claude session
//
// The gem is Claude Haiku via OpenRouter by default (fast — ~2s vs Sonnet's ~8s; a voice
// front needs speed, not depth — the heavy thinking is the live Claude session's job),
// with a local Ollama model as fallback. It gets the live session snapshot + current
// focus as context so it can answer "what am I working on?" without touching Claude.
import http from 'node:http'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { snapshotSessions, describeSessions, matchSession } from './tars-sessions.mjs'
import { firstResponse } from './first-responses.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.ROUTER_PORT || 8793)
const SPEAK_URL = process.env.SPEAK_URL || 'http://127.0.0.1:8790/speak'
const INJECT_URL = process.env.INJECT_URL || 'http://127.0.0.1:8792/inject'
const FOCUS_FILE = join(os.homedir(), '.tars', 'focus')
const log = (...a) => console.log(new Date().toISOString(), '[router]', ...a)

// Backend: OpenRouter (Claude) when a key is present — local wasn't snappy enough for a
// hands-free front. Falls back to a local Ollama model otherwise. NOTE: node's global
// fetch (undici) wedges on this host's dead IPv6 route to external hosts, so OpenRouter
// goes through curl; loopback Ollama/speak/inject calls stay on fetch (IPv4 is fine).
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/chat'
const OLLAMA_MODEL = process.env.TARS_GEM_MODEL || 'qwen2.5:14b-instruct'
const OPENROUTER_URL = process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1/messages'
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || ''
const OPENROUTER_SLUG = process.env.TARS_GEM_SLUG || 'anthropic/claude-haiku-4.5'
const BACKEND = OPENROUTER_KEY && process.env.TARS_GEM_BACKEND !== 'ollama' ? 'openrouter' : 'ollama'
const MODEL = BACKEND === 'openrouter' ? OPENROUTER_SLUG : OLLAMA_MODEL
const FIRST_ENABLED = process.env.TARS_FIRST !== '0'   // zero-latency string-matched fillers

let persona = 'You are TARS from Interstellar: deadpan, terse, literal, loyal. Humor 95, honesty 100.'
try { persona = readFileSync(join(HERE, 'voice-persona.txt'), 'utf8').trim() } catch { /* default */ }

// Cache the session snapshot briefly — the gem is called per utterance and we don't want
// to re-walk every transcript each time. Keep the raw array too, for matching/reading.
let sessCache = { at: 0, snap: [], text: 'No active sessions.' }
async function sessions() {
  if (Date.now() - sessCache.at < 8000) return sessCache
  try { const snap = await snapshotSessions(); sessCache = { at: Date.now(), snap, text: describeSessions(snap) } }
  catch (e) { log('sessions failed:', e.message) }
  return sessCache
}

// ---- focus: which session Caio is currently talking about ----
function getFocus() { try { return JSON.parse(readFileSync(FOCUS_FILE, 'utf8')) } catch { return null } }
function setFocus(s) { try { writeFileSync(FOCUS_FILE, JSON.stringify({ label: s.project, sessionId: s.sessionId, cwd: s.cwd, at: Date.now() })) } catch { /* ignore */ } }
// Resolve which session an action refers to: an explicit name wins; else the focused one.
function resolveTarget(snap, query, focus) {
  if (query) { const m = matchSession(snap, query); if (m) return m }
  if (focus) { const f = snap.find((s) => s.sessionId === focus.sessionId || s.project === focus.label); if (f) return f }
  return null
}

// ---- rolling conversation memory ----
// The gem was stateless per utterance, so follow-ups ("tell it to…", "and also…", "read
// that one") lost the thread and the command sent to Claude had no lead-up. Keep the recent
// back-and-forth and feed it to the gem each turn. Trims to the last N messages ("compacts")
// and resets after a long idle so an old, unrelated conversation doesn't bleed in.
const HISTORY_MAX = Number(process.env.TARS_HISTORY_MAX || 16)          // ~8 exchanges
const HISTORY_IDLE_MS = Number(process.env.TARS_HISTORY_IDLE_MS || 12 * 60 * 1000)
let history = []
let lastTurnAt = 0
function pushHistory(role, content) {
  const c = String(content || '').trim()
  if (!c) return
  history.push({ role, content: c })
  if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX)
}

const SCHEMA_NOTE = `Respond with ONLY a JSON object, no prose:
{
  "reply": string,        // what you SAY OUT LOUD — terse, TARS's voice, one or two sentences. "" to stay silent (pure noise).
  "action": string,       // one of: "answer", "focus_session", "read_session", "send_to_claude", "computer", "none"
  "session": string,      // for focus/read/send: which session he means, in his words. "" if he means the focused one.
  "claude_message": string,// for send_to_claude only: a clean imperative instruction for Claude. else ""
  "op": string,           // for "computer" only: one of "app" | "type" | "key" | "run" | "see". else ""
  "arg": string           // for "computer": the app name / text to type / key phrase / shell command / the screen question. else ""
}`

const RULES = `You are Caio's always-on voice assistant. He runs several Claude coding sessions at once; you track them (see SESSIONS) and speak for TARS. You can also drive his whole Mac. Pick ONE action per utterance:

- "answer": talk-back you can handle yourself — greetings, "what am I working on", "which is running", a quick fact, small talk, or open conversation (a joke, a short story, chatting). Stay in TARS's voice — deadpan, terse, dry humor — even telling a story; a "short story" means a handful of sentences spoken aloud, not a novel. Put it in "reply".
- "focus_session": he wants to switch attention to a session ("focus on finance"). Set "session". "reply" = a one-line confirm.
- "read_session": he wants to hear a session's latest reply ("what did finance say?", "read me the portal"). Set "session" ("" = focused). "reply" short or "".
- "send_to_claude": real CODING work for a live Claude session — write/change code, run a command in a repo, dig into a file. Set "claude_message" + "session". "reply" = a short forward-looking ack.
- "computer": drive the Mac itself (NOT a Claude session). Set "op" + "arg":
    · op "app"  — open/switch to an app. arg = app name ("open Spotify" -> op:app, arg:Spotify).
    · op "key"  — volume/mute/media. arg = the phrase ("mute", "volume 30", "volume up", "pause spotify").
    · op "type" — type/paste text into whatever app is frontmost. arg = the text.
    · op "run"  — a shell command. arg = the exact command. Use ONLY for clear, simple shell asks.
    · op "see"  — look at the screen and answer. arg = his question ("what's on my screen", "what's that error").
  For anything OPEN-ENDED or multi-step on the Mac ("clean up my desktop", "fill out this form", "figure out why X and fix it") DON'T use op — use send_to_claude and write claude_message as a computer-use task; a Claude with computer control handles it.
- "none": ambient noise or speech not aimed at you. "reply":"".

ADDRESSED gate: each turn tells you ADDRESSED (true if Caio said the wake word "TARS", false if merely overheard). You may answer/read/focus either way. But you may ONLY choose send_to_claude when ADDRESSED is true — if it's false and he wants Claude to DO something, say "Say 'TARS' and I'll send that to Claude." and use action "answer".

CRITICAL honesty rule: for send_to_claude the work has NOT happened yet — Claude does it after you hand off. "reply" must acknowledge you're STARTING ("On it." / "Copy, sending that now.") — NEVER "Done." You did not do it yet.

CONTEXT: the messages before this one are your recent conversation with Caio. Use them to resolve follow-ups and references — "it", "that one", "the same session", "also do X", "no, the other one". When you build claude_message, make it SELF-CONTAINED from that context (spell out what "it"/"that" means), since the target Claude session may not have heard what we just discussed.

Never invent sessions or facts — only use SESSIONS. Never read code, paths, URLs, or markdown aloud. No emoji.`

const SYSTEM = () => `${persona}\n\n${RULES}\n\n${SCHEMA_NOTE}`
const USER = (text, sessText, addressed, focus) =>
  `SESSIONS (what Caio has running right now):\n${sessText}\n\nFOCUSED SESSION: ${focus ? focus.label : '(none)'}\nADDRESSED: ${addressed}\n\nCaio just said: "${text}"`

// Sonnet/Haiku are asked for pure JSON but may wrap it; pull the first {...} out defensively.
function extractJson(raw) {
  if (!raw) return null
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}')
  if (a === -1 || b < a) return null
  try { return JSON.parse(raw.slice(a, b + 1)) } catch { return null }
}
const ACTIONS = ['answer', 'focus_session', 'read_session', 'send_to_claude', 'computer', 'none']
function shape(parsed) {
  const p = parsed || {}
  // back-compat: an old-style talk_to_claude=true maps to send_to_claude
  const action = ACTIONS.includes(p.action) ? p.action : (p.talk_to_claude ? 'send_to_claude' : 'answer')
  return {
    reply: String(p.reply || '').trim(),
    action,
    session: String(p.session || '').trim(),
    claudeMessage: String(p.claude_message || '').trim(),
    op: String(p.op || '').trim(),
    arg: String(p.arg || '').trim(),
  }
}

// ---- model plumbing: OpenRouter via curl (IPv6 note above), Ollama via loopback fetch ----
function callOpenRouter(system, messages, maxTokens) {
  const body = JSON.stringify({ model: OPENROUTER_SLUG, max_tokens: maxTokens, temperature: 0.3, system, messages })
  const bodyFile = `${os.tmpdir()}/tars-router-${randomUUID()}.json`
  return new Promise((resolve, reject) => {
    let done = false
    const finish = (fn) => { if (done) return; done = true; try { unlinkSync(bodyFile) } catch { /* gone */ } fn() }
    try { writeFileSync(bodyFile, body) } catch (e) { return finish(() => reject(e)) }
    // Key via `curl --config -` on stdin so it never lands in argv/`ps`. --retry rides the
    // intermittent IPv6 DNS failures ("could not resolve host: openrouter.ai").
    const config = `header = "content-type: application/json"\nheader = "x-api-key: ${OPENROUTER_KEY}"\nheader = "anthropic-version: 2023-06-01"\n`
    const child = spawn('curl', ['-sS', '--max-time', '30', '--retry', '3', '--retry-delay', '1', '--retry-connrefused', '--retry-all-errors', '-X', 'POST', '--data-binary', `@${bodyFile}`, '--config', '-', OPENROUTER_URL], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), 32000)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => { clearTimeout(timer); finish(() => reject(e)) })
    child.on('close', () => {
      clearTimeout(timer)
      if (err) log('openrouter stderr:', err.slice(0, 160))
      try {
        const data = JSON.parse(out)
        if (data?.error) return finish(() => reject(new Error(JSON.stringify(data.error).slice(0, 160))))
        const raw = Array.isArray(data?.content) ? data.content.filter((b) => b?.type === 'text').map((b) => b.text).join('').trim() : ''
        finish(() => resolve(raw))
      } catch (e) { finish(() => reject(new Error(`parse: ${e.message} :: ${out.slice(0, 120)}`))) }
    })
    child.stdin.write(config); child.stdin.end()
  })
}
async function callOllama(system, messages, maxTokens, json) {
  const body = { model: OLLAMA_MODEL, stream: false, options: { temperature: 0.3, num_ctx: 4096, num_predict: maxTokens }, messages: [{ role: 'system', content: system }, ...messages] }
  if (json) body.format = 'json'
  const res = await fetch(OLLAMA, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`ollama ${res.status}`)
  const data = await res.json()
  return (data.message?.content || '').trim()
}
const call = (system, messages, { maxTokens = 512, json = false } = {}) =>
  BACKEND === 'openrouter' ? callOpenRouter(system, messages, maxTokens) : callOllama(system, messages, maxTokens, json)

// The current turn is decorated with live SESSIONS/FOCUS/ADDRESSED; prior turns ride along
// as plain conversation so the gem can follow references without re-sending stale state.
async function gem(text, sessText, addressed, focus) {
  const messages = [...history, { role: 'user', content: USER(text, sessText, addressed, focus) }]
  const raw = await call(SYSTEM(), messages, { maxTokens: 900, json: true })   // room for a short spoken story
  return shape(extractJson(raw))
}

// Render a session's raw last reply as short TARS speech (code/paths/markdown described,
// not read out). A separate, small call — kept fast with a low token cap.
const SUMMARY_SYSTEM = `${persona}\n\nYou are handed the latest assistant reply from one of Caio's Claude coding sessions. Say what it means OUT LOUD in TARS's voice — at most two terse sentences. Never read code, file paths, URLs, or markdown aloud; describe them instead. No preamble, no emoji.`
async function summarize(rawReply) {
  if (!rawReply) return ''
  try { return (await call(SUMMARY_SYSTEM, [{ role: 'user', content: `The session's latest reply:\n\n${rawReply.slice(0, 4000)}` }], { maxTokens: 200 })).trim() }
  catch (e) { log('summarize failed:', e.message); return '' }
}

// ---- Stop-hook narration ----
// Every one of Caio's Claude Code sessions fires its Stop hook here when it finishes a
// turn. Narrate it through the SAME gem (Sonnet, with session-awareness + conversation
// history) instead of the disconnected speakify/Ollama path, and fold it into `history` —
// so "tell me more about that" right after actually resolves to what was just narrated.
async function notify({ text, topic, cwd, session_id }) {
  if (!text) return { ok: true, skipped: 'empty' }
  const { snap } = await sessions()
  const target = snap.find((s) => s.sessionId === session_id) || (topic && matchSession(snap, topic)) || null
  const label = target?.project || topic || 'a session'
  const gist = await summarize(text)
  if (!gist) return { ok: true, skipped: 'no-gist' }
  if (target) setFocus(target)   // a bare "tell me more" afterward should resolve here
  const line = `On ${label}: ${gist}`
  await speak(line)
  // A gap since the last hear() call means the idle-reset in hear() would otherwise wipe
  // this exact history the instant Caio next speaks — a hook narration itself must count
  // as "the conversation is still fresh," or a follow-up right after it loses the context.
  if (Date.now() - lastTurnAt > HISTORY_IDLE_MS) history = []
  lastTurnAt = Date.now()
  pushHistory('user', `[${label} just finished and spoke up]`)
  pushHistory('assistant', line)
  log(`notify(${label}): ${line}`)
  return { ok: true, project: label, said: line }
}

async function speak(text, { cache = false } = {}) {
  if (!text) return
  try {
    await fetch(SPEAK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, raw: true, priority: 'interactive', source: 'router', cache }), signal: AbortSignal.timeout(5000) })
  } catch (e) { log('speak failed:', e.message) }
}
async function inject(text, target) {
  try {
    const res = await fetch(INJECT_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, submit: true, target }), signal: AbortSignal.timeout(9000) })
    return await res.json().catch(() => ({ ok: res.ok }))
  } catch (e) { log('inject failed:', e.message); return { ok: false, error: e.message } }
}

// ---- the Mac hands ----
const HANDS_DO_URL = INJECT_URL.replace('/inject', '/do')
async function hands(op, arg) {
  try {
    const res = await fetch(HANDS_DO_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, arg }), signal: AbortSignal.timeout(65000) })
    return await res.json().catch(() => ({ ok: res.ok }))
  } catch (e) { log('hands failed:', e.message); return { ok: false, error: e.message } }
}

// Risky = anything that runs shell or looks destructive → spoken confirm before it fires.
const RISKY_ARG = /\b(delete|remove|\brm\b|kill|shutdown|reboot|restart|erase|format|uninstall|drop|overwrite|--force|-f\b|sudo|close all|quit all)\b/i
const isRisky = (op, arg) => op === 'run' || RISKY_ARG.test(String(arg || ''))
const AFFIRM = /\b(yes|yeah|yep|yup|do it|go|go ahead|confirm|confirmed|proceed|send it|sure|ok|okay|affirmative)\b/i
const CONFIRM_FILE = join(os.homedir(), '.tars', 'awaiting-confirm')
let pending = null   // { op, arg, at }
function setAwaiting(on) { try { if (on) writeFileSync(CONFIRM_FILE, String(Date.now())); else unlinkSync(CONFIRM_FILE) } catch { /* ignore */ } }

// Run a computer op and describe the result out loud (short, TARS voice).
async function runComputer(op, arg) {
  if (op === 'see') return describeScreen(arg)
  const r = await hands(op, arg)
  if (!r.ok) {
    if (r.error === 'no-accessibility') return "I can't control apps yet. Grant TarsHands accessibility."
    if (r.error === 'screencapture') return "I can't see the screen yet. Grant TarsHands screen recording."
    return `That didn't work${r.detail ? ': ' + String(r.detail).slice(0, 80) : '.'}`
  }
  if (op === 'app') return `Opened ${r.opened}.`
  if (op === 'key') return r.did ? `${r.did}.` : 'Done.'
  if (op === 'type') return 'Typed.'
  if (op === 'run') return r.stdout ? `Done. ${String(r.stdout).replace(/\s+/g, ' ').trim().slice(0, 160)}` : 'Done.'
  return 'Done.'
}

// "See" — screenshot, then a multimodal gem call describes it (OpenRouter/Haiku only).
async function describeScreen(question) {
  const shot = await hands('see')
  if (!shot.ok) return shot.error === 'screencapture' ? "I can't see the screen yet. Grant TarsHands screen recording." : "I couldn't grab the screen."
  if (BACKEND !== 'openrouter') return 'Screen vision needs the cloud model.'
  let b64
  try { b64 = readFileSync(shot.path).toString('base64') } catch { return "I couldn't read the screenshot." }
  const messages = [{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
    { type: 'text', text: `${question || "What's on my screen right now?"}\n\nAnswer OUT LOUD in TARS's voice — one or two terse sentences. Describe what you see; never read code/paths/URLs verbatim.` },
  ] }]
  try { const raw = await callOpenRouter(SYSTEM_VISION, messages, 220); return String(raw || '').trim() || "I looked, but I've got nothing useful to say." }
  catch (e) { log('vision failed:', e.message); return "I couldn't make sense of the screen." }
}
const SYSTEM_VISION = `${persona}\n\nYou are looking at a screenshot of Caio's Mac. Say what's relevant OUT LOUD in TARS's voice — terse, at most two sentences. Never read code, paths, or URLs verbatim; describe them. No emoji.`

async function hear(text, addressed) {
  const clean = String(text || '').trim()
  if (!clean) return { ok: false }

  // A risky op is waiting on a spoken yes/no — this utterance answers it (wake word or not).
  if (pending && Date.now() - pending.at < 30000) {
    const p = pending; pending = null; setAwaiting(false)
    if (AFFIRM.test(clean)) {
      const say = await runComputer(p.op, p.arg)
      await speak(say); pushHistory('user', clean); pushHistory('assistant', `(confirmed) ${say}`)
      return { ok: true, confirmed: true, op: p.op }
    }
    await speak('Cancelled.'); pushHistory('user', clean); pushHistory('assistant', 'Cancelled.')
    return { ok: true, cancelled: true }
  }
  if (pending) { pending = null; setAwaiting(false) }   // stale confirmation — drop it

  // Zero-latency filler: fire-and-forget, spoken before the gem call returns. String match
  // only — no model — and `cache:true` so tars-speak plays a pre-rendered WAV instead of
  // re-synthesizing. Only when Caio actually addressed TARS.
  if (addressed && FIRST_ENABLED) speak(firstResponse(clean), { cache: true })
  // A gap this long means a new conversation — drop stale context so it can't bleed in.
  if (Date.now() - lastTurnAt > HISTORY_IDLE_MS) history = []
  lastTurnAt = Date.now()

  const { snap, text: sessText } = await sessions()
  const focus = getFocus()
  let d
  try { d = await gem(clean, sessText, addressed, focus) }
  catch (e) { log('gem failed:', e.message); if (addressed) await speak('My model is not answering.'); return { ok: false, error: e.message } }
  log(`heard(addr=${addressed}) ${JSON.stringify(clean)} -> action=${d.action} session=${JSON.stringify(d.session)} reply=${JSON.stringify(d.reply)}`)

  let note = d.reply     // what TARS did/said this turn, for the conversation memory
  let result
  switch (d.action) {
    case 'focus_session': {
      const target = resolveTarget(snap, d.session, null)
      if (!target) { note = `I don't see a ${d.session || 'matching'} session.`; await speak(note); result = { ok: true, ...d }; break }
      setFocus(target)
      note = d.reply || `Focused on ${target.project}.`
      await speak(note)
      result = { ok: true, ...d, focused: target.project }
      break
    }
    case 'read_session': {
      const target = resolveTarget(snap, d.session, focus)
      if (!target) { note = `I don't see a ${d.session || 'focused'} session to read.`; await speak(note); result = { ok: true, ...d }; break }
      const gist = await summarize(target.lastAssistant)
      const line = gist ? `On ${target.project}: ${gist}` : `${target.project} hasn't said anything yet.`
      note = `(read ${target.project}) ${line}`
      await speak(line)
      result = { ok: true, ...d, read: target.project }
      break
    }
    case 'send_to_claude': {
      // Hard gate: never inject unless Caio said the wake word, whatever the gem decided.
      const willInject = !!d.claudeMessage && addressed === true
      if (!willInject) { note = d.reply || "Say 'TARS' and I'll send that to Claude."; await speak(note); result = { ok: true, ...d, injected: false }; break }
      // Resolve WHICH session. Terminal sessions are individually targetable (raise the
      // tty tab); desktop sub-sessions are not (one window) — those land in the frontmost.
      const target = resolveTarget(snap, d.session, focus)
      const tgt = target && target.host === 'terminal' && target.tty ? { host: 'terminal', tty: target.tty, app: target.app } : null
      // The instant filler already acknowledged out loud; don't double-speak the gem's ack.
      const r = await inject(d.claudeMessage, tgt)
      if (!r.ok && r.error === 'tty-not-found') await speak("I couldn't find that terminal. Bring it forward and try again.")
      else if (!r.ok && r.error === 'no-accessibility') await speak("I can't type yet. Grant TarsHands accessibility in settings.")
      note = `${d.reply} (sent to Claude${target ? ' on ' + target.project : ''}: ${d.claudeMessage})`
      log(`inject -> ${JSON.stringify(r)}`)
      result = { ok: true, ...d, injected: r.ok, landed: r.landed }
      break
    }
    case 'computer': {
      if (!d.op) { await speak(d.reply || "I didn't catch what to do."); result = { ok: true, ...d }; break }
      // Mutating ops need the wake word; 'see' is read-only so it's allowed either way.
      if (d.op !== 'see' && !addressed) { note = "Say 'TARS' and I'll do that."; await speak(note); result = { ok: true, ...d }; break }
      if (isRisky(d.op, d.arg)) {
        // Hold it and ask out loud; the next utterance (yes/no) is handled at the top of hear().
        pending = { op: d.op, arg: d.arg, at: Date.now() }
        setAwaiting(true)
        note = `Confirm: ${d.op === 'run' ? 'run ' + d.arg : d.arg}?`
        await speak(d.op === 'run' ? `About to run that command. Say confirm, or cancel.` : `About to ${d.arg}. Confirm, or cancel.`)
        result = { ok: true, ...d, pending: true }
        break
      }
      const say = await runComputer(d.op, d.arg)
      note = say
      await speak(say)
      result = { ok: true, ...d, did: d.op }
      break
    }
    default:
      await speak(d.reply)
      result = { ok: true, ...d }
  }
  // Record the turn so the next utterance can follow up on it ("it", "that one", "also…").
  pushHistory('user', clean)
  pushHistory('assistant', note)
  return result
}

const json = (res, code, obj) => { try { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) } catch { /* hung up */ } }
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { resolve(JSON.parse(b || '{}')) } catch { resolve(null) } }); req.on('error', () => resolve(null)) })

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/hear') {
    const body = await readBody(req)
    if (!body || !body.text) return json(res, 400, { error: 'missing text' })
    return json(res, 200, await hear(body.text, body.addressed === true))
  }
  if (req.method === 'POST' && req.url === '/notify') {
    const body = await readBody(req)
    if (!body || !body.text) return json(res, 400, { error: 'missing text' })
    json(res, 200, { ok: true, queued: true })   // ack the hook immediately — Claude must never wait on this
    notify(body).catch((e) => log('notify failed:', e.message))
    return
  }
  if (req.url === '/health') return json(res, 200, { ok: true, model: MODEL, port: PORT })
  json(res, 404, { error: 'not found' })
})
server.listen(PORT, '127.0.0.1', () => log(`tars-router on :${PORT} · backend=${BACKEND} · gem=${MODEL}`))
