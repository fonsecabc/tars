#!/usr/bin/env node
// Bake every fixed first-response filler into the tars-speak WAV cache once, so the very
// first time each is used it's already a file read (no synth). Idempotent — re-run any time
// (e.g. after editing first-responses.mjs or changing the Kokoro voice). Silent: uses the
// /speak `render` mode, which synthesizes to cache without playing.
import { ALL_FIRST_PHRASES } from './first-responses.mjs'

const SPEAK_URL = process.env.SPEAK_URL || 'http://127.0.0.1:8790/speak'

for (const text of ALL_FIRST_PHRASES) {
  try {
    const res = await fetch(SPEAK_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, raw: true, render: true }), signal: AbortSignal.timeout(30000),
    })
    const r = await res.json().catch(() => ({}))
    console.log(`${r.cached ? (r.already ? 'exists ' : 'baked  ') : 'FAILED '} ${JSON.stringify(text)}${r.error ? ' — ' + r.error : ''}`)
  } catch (e) { console.log(`FAILED  ${JSON.stringify(text)} — ${e.message}`) }
}
