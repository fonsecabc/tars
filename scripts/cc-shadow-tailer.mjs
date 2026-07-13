#!/usr/bin/env node
// Chronicle CC-shadow tailer — mirrors live Claude Code transcripts into the session log.
//
// Claude Code owns its transcript store (~/.claude/projects/<dir>/<sessionId>.jsonl) and its
// own resume mechanism; Chronicle is a SHADOW for cross-harness visibility (watch a CC
// session from voice/WhatsApp, project it into the brain graph). One-way, idempotent via a
// per-file LINE watermark persisted across restarts.
//
// Policy decisions:
// - First sight of a file initializes its watermark at the CURRENT line count — the tailer
//   captures activity from NOW on; history is already in the brain via Dream/the reaper.
// - Parsing reuses the tested core adapter (ccTranscriptLinesToEvents from the built dist):
//   defensive, tool_call payloads carry the tool NAME only, never inputs.
// - Fire-and-forget toward Chronicle: a failed cycle retries next tick, watermark only
//   advances after a successful ingest.

import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import os from 'node:os';

import { ccTranscriptLinesToEvents } from '../packages/core/dist/sessions/adapters/cc-shadow.js';
import { ingestBatch } from './chronicle-client.mjs';

const PROJECTS_DIR = join(os.homedir(), '.claude', 'projects');
const STATE_DIR = join(os.homedir(), 'Library', 'Application Support', 'tars');
const STATE_PATH = join(STATE_DIR, 'cc-shadow-state.json');
const INTERVAL_MS = Number(process.env.CC_SHADOW_INTERVAL_MS || 30_000);
/** Only tail files with recent activity; stale transcripts stay untouched. */
const ACTIVE_WINDOW_MS = Number(process.env.CC_SHADOW_ACTIVE_MS || 24 * 60 * 60 * 1000);
/** Cap per file per cycle so one huge burst can't wedge a cycle. */
const MAX_LINES_PER_CYCLE = 500;

const log = (...a) => console.log(new Date().toISOString(), '[cc-shadow]', ...a);

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { files: {} };
  }
}

function writeState(state) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function* transcriptFiles() {
  let dirs = [];
  try {
    dirs = readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return;
  }
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  for (const dir of dirs) {
    const dirPath = join(PROJECTS_DIR, dir.name);
    let entries = [];
    try {
      entries = readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const file of entries) {
      const filePath = join(dirPath, file);
      let st;
      try {
        st = statSync(filePath);
      } catch {
        continue;
      }
      if (st.mtimeMs < cutoff) continue;
      yield { filePath, projectDir: dir.name, ccSessionId: basename(file, '.jsonl') };
    }
  }
}

async function cycle(state) {
  for (const { filePath, projectDir, ccSessionId } of transcriptFiles()) {
    let lines;
    try {
      lines = readFileSync(filePath, 'utf8')
        .split('\n')
        .filter((l) => l.trim() !== '');
    } catch {
      continue;
    }
    const known = state.files[filePath];
    if (known === undefined) {
      // First sight: start from NOW — do not backfill history.
      state.files[filePath] = lines.length;
      log(`registered ${ccSessionId} at line ${lines.length} (no backfill)`);
      continue;
    }
    if (lines.length <= known) continue;

    const fresh = lines.slice(known, known + MAX_LINES_PER_CYCLE);
    const events = ccTranscriptLinesToEvents(fresh);
    try {
      if (events.length > 0) {
        await ingestBatch(
          {
            origin: 'cc-shadow',
            externalRef: ccSessionId,
            title: `CC ${ccSessionId.slice(0, 8)} (${projectDir})`,
            tier: 'owner',
            metadata: { projectDir },
          },
          'cc-shadow:tailer',
          events.map((e) => ({ actor: e.actor, kind: e.kind, payload: e.payload })),
        );
        log(
          `ingested ${events.length} event(s) from ${ccSessionId} (lines ${known}..${known + fresh.length})`,
        );
      }
      // Advance only after a successful ingest (or when the fresh lines held nothing worth
      // recording — skipping those permanently is correct, they parse to nothing every time).
      state.files[filePath] = known + fresh.length;
    } catch (e) {
      log(`ingest failed for ${ccSessionId} (will retry): ${e?.message || e}`);
    }
  }
  writeState(state);
}

async function main() {
  log(`tailer up · projects=${PROJECTS_DIR} · interval=${INTERVAL_MS}ms`);
  const state = readState();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await cycle(state);
    } catch (e) {
      log('cycle error:', e?.message || e);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main().catch((e) => {
  log('fatal:', e?.message || e);
  process.exit(1);
});
