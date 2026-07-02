// speakify — turn a written assistant reply into what TARS would SAY OUT LOUD.
// Runs on a local Ollama model (the "gem"); no API, no billing. Returns a short
// spoken string, or null when there's nothing worth saying (pure code/paths/tables).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const MODEL = process.env.SPEAKIFY_MODEL || 'gemma2:9b'
const __dir = dirname(fileURLToPath(import.meta.url))

let PERSONA = ''
try { PERSONA = readFileSync(join(__dir, 'voice-persona.txt'), 'utf8').trim() } catch { PERSONA = '' }

// Backstop scrubbers (weak models ignore instructions; strip anyway).
const stripEmoji = (s) => String(s || '')
  .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, '')
  .replace(/\s+/g, ' ').trim()

// Truncate the MIDDLE of very long input so we keep the opening (the answer) and
// the ending (the conclusion) without blowing the model's attention on the middle.
function capMiddle(s, max = 4000) {
  if (s.length <= max) return s
  const head = Math.floor(max * 0.6), tail = max - head - 20
  return `${s.slice(0, head)}\n…\n${s.slice(-tail)}`
}

const SYSTEM = `${PERSONA}

TASK: Convert an assistant's WRITTEN reply into what TARS would SAY OUT LOUD — at most 1–2 short spoken sentences.
- Speak the GIST. If the reply is long, say the outcome/answer, not the steps.
- DROP entirely: code blocks, file paths, URLs, tables, command lines, IDs, bullet scaffolding, headings.
- No markdown, no emoji, no "TARS:" prefix. Plain speakable prose only.
- Keep TARS's deadpan register: terse, literal, substance first. Never invent anything not in the text.
- If the reply is ONLY code/paths/a table with no spoken point, output exactly: <skip>`

// Degrade gracefully if Ollama is down: strip the obviously-unspeakable, keep the first prose.
function fallbackShorten(text) {
  let t = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')      // fenced code
    .replace(/`[^`]*`/g, ' ')             // inline code
    .replace(/^\s*[-*#>|].*$/gm, ' ')     // bullets/headings/tables/quotes
    .replace(/https?:\/\/\S+/g, ' ')      // urls
    .replace(/\S*\/\S*\/\S*/g, ' ')       // path-ish tokens
  t = stripEmoji(t)
  if (!t) return null
  const sentences = t.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 2).join(' ')
  const out = (sentences || t).slice(0, 240).trim()
  return out || null
}

export async function speakify(text, { timeoutMs = 15000 } = {}) {
  const input = String(text || '').trim()
  if (!input) return null
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        keep_alive: '30m',
        options: { temperature: 0.2 },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Reply text:\n"""${capMiddle(input)}"""\nSay:` },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return fallbackShorten(input)
    const data = await res.json()
    const out = stripEmoji((data?.message?.content || '').trim())
    if (!out || /^<skip>\.?$/i.test(out)) return null
    return out
  } catch {
    return fallbackShorten(input)
  }
}
