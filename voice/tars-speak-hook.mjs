#!/usr/bin/env node
// tars-speak-hook — Claude Code `Stop` hook. Fires when the main agent finishes a
// turn. Reads the session transcript, extracts the final user-facing assistant
// text, and hands it to tars-speak to say aloud. Fire-and-forget: it returns fast
// so Claude never waits on speech.
//
// Gating (so it stays silent until you opt in, and can be hushed instantly):
//   - speaks ONLY if ~/.tars/voice.on exists
//   - stays silent if ~/.tars/voice.muted exists
//   - ignores re-entrant Stop (stop_hook_active)
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SPEAK_URL = process.env.SPEAK_URL || 'http://127.0.0.1:8790/speak'
const TARS_DIR = join(homedir(), '.tars')
const ON_FLAG = join(TARS_DIR, 'voice.on')
const MUTED_FLAG = join(TARS_DIR, 'voice.muted')

function readStdin() {
  return new Promise((resolve) => {
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (buf += c))
    process.stdin.on('end', () => resolve(buf))
    process.stdin.on('error', () => resolve(buf))
  })
}

// Read only the tail of a (possibly large) transcript — the final turn is at the end.
function readTail(path, maxBytes = 262144) {
  const size = statSync(path).size
  const start = Math.max(0, size - maxBytes)
  const len = size - start
  const fd = openSync(path, 'r')
  try {
    const b = Buffer.allocUnsafe(len)
    readSync(fd, b, 0, len, start)
    return b.toString('utf8')
  } finally { closeSync(fd) }
}

// Final user-facing text = the last non-sidechain assistant line that carries text
// blocks; concat its text blocks (drops thinking/tool_use, skips subagent chatter).
function extractFinalAssistantText(path) {
  let raw
  try { raw = readTail(path) } catch { return '' }
  const lines = raw.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line) continue
    let obj
    try { obj = JSON.parse(line) } catch { continue }
    if (obj.type !== 'assistant' || obj.isSidechain === true) continue
    const content = obj.message?.content
    if (!Array.isArray(content)) continue
    const text = content.filter((b) => b?.type === 'text').map((b) => b.text).join('').trim()
    if (text) return text
    // last assistant line was tool-only (turn ended on a tool call) -> say nothing
    return ''
  }
  return ''
}

async function main() {
  if (!existsSync(ON_FLAG) || existsSync(MUTED_FLAG)) return
  const input = await readStdin()
  let data
  try { data = JSON.parse(input) } catch { return }
  if (data.stop_hook_active === true) return
  const path = data.transcript_path
  if (!path || !existsSync(path)) return
  const text = extractFinalAssistantText(path)
  if (!text) return
  try {
    await fetch(SPEAK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, priority: 'interactive', source: 'claude-code', session_id: data.session_id }),
      signal: AbortSignal.timeout(600),
    })
  } catch { /* fire-and-forget: tars-speak may be down; never block Claude */ }
}

main().then(() => process.exit(0)).catch(() => process.exit(0))
