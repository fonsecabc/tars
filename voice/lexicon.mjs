// lexicon — a growing pronunciation dictionary for TARS's speech, the same idea as
// Granola's custom vocabulary: seed it with obvious fixes (acronyms, foreign names a
// TTS model mangles), then correct it by hand as mispronunciations turn up. Applied as
// the last text transform before synthesis, so it catches speakify's output too.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dir = dirname(fileURLToPath(import.meta.url))
const PATH = join(__dir, 'lexicon.json')

function load() {
  try { return JSON.parse(readFileSync(PATH, 'utf8')) } catch { return {} }
}

let entries = load()
// Longest key first so "JSONL" matches before "JSON" does.
let sortedKeys = Object.keys(entries).sort((a, b) => b.length - a.length)

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

export function applyLexicon(text) {
  let out = String(text || '')
  for (const key of sortedKeys) {
    const re = new RegExp(`\\b${escapeRe(key)}\\b`, 'gi')
    out = out.replace(re, entries[key])
  }
  return out
}

// Add or correct a pronunciation and persist it immediately — the next utterance
// (in this process or any other, since all producers share this file) uses it.
export function addEntry(word, respelling) {
  entries[word] = respelling
  sortedKeys = Object.keys(entries).sort((a, b) => b.length - a.length)
  try { writeFileSync(PATH, JSON.stringify(entries, null, 2) + '\n') } catch { /* ignore */ }
}

export function reload() {
  entries = load()
  sortedKeys = Object.keys(entries).sort((a, b) => b.length - a.length)
}
