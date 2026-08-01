#!/usr/bin/env node
// Record one scheduled-routine run into Chronicle (origin 'cron', one session per routine
// name, each run = started/summary/completed turns). One-liner for routine specs:
//
//   node "$TARS_REPO/scripts/chronicle-record-run.mjs" \
//     <taskName> <ok|error|skipped> "<one-paragraph summary>"
//
// Exit code is ALWAYS 0 — recording is best-effort and must never fail a routine.

import { randomUUID } from 'node:crypto';

import { ingestBatch } from './chronicle-client.mjs';

const [taskName, status = 'ok', ...rest] = process.argv.slice(2);
const summary = rest.join(' ').trim();

if (!taskName) {
  console.error('usage: chronicle-record-run.mjs <taskName> <ok|error|skipped> "<summary>"');
  process.exit(0);
}

const runId = `${new Date().toISOString()}-${randomUUID().slice(0, 8)}`;
const clip = (t) => (t.length > 2000 ? `${t.slice(0, 2000)}…` : t);

const events = [
  {
    actor: 'system',
    kind: 'turn_started',
    payload: { runId, startedAt: new Date().toISOString() },
  },
  ...(summary
    ? [{ actor: 'assistant', kind: 'turn_message', payload: { text: clip(summary), runId } }]
    : []),
  { actor: 'system', kind: 'turn_completed', payload: { runId, status } },
];

try {
  await ingestBatch(
    { origin: 'cron', externalRef: taskName, title: taskName, tier: 'owner' },
    'cron:record-run',
    events,
  );
  console.log(`chronicle: recorded ${taskName} run (${status})`);
} catch (e) {
  console.error('chronicle record skipped:', e?.message || e);
}
process.exit(0);
