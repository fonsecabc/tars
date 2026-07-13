/**
 * Chronicle Claude Code SHADOW adapter — parses already-read Claude Code transcript JSONL
 * lines (`~/.claude/projects/<dir>/<sessionId>.jsonl`) into log events for cross-harness
 * visibility. Claude Code owns its own transcript store and its own resume mechanism;
 * Chronicle is strictly a shadow/mirror, and the flow is one-way (CC → log).
 *
 * Idempotency is the CALLER's job: the tailer keeps a line-offset watermark (how many lines
 * of each transcript it has already ingested) and only ever hands this adapter the NEW tail.
 * The adapter itself is stateless and will happily re-append lines it is re-given.
 *
 * DEFENSIVE by design: CC's transcript format is external and drifts — unknown or
 * unparseable lines are silently skipped, never thrown on.
 *
 * BUILD-DON'T-ACTIVATE: exercised against synthetic data only until the encryption-at-rest
 * gate is cleared — nothing here reads live transcripts or wires up file-watching.
 */
import type { AdapterEvent, IngestResult } from './adapter.js';
import { clipText, ingestBatch } from './adapter.js';
import type { SessionService } from '../service.js';

export const CC_SHADOW_HOLDER = 'cc-shadow:adapter';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Extract a usable ISO timestamp from a transcript entry, if one exists. */
function timestampOf(entry: Record<string, unknown>): string | undefined {
  const ts = entry['timestamp'];
  return typeof ts === 'string' && ts !== '' ? ts : undefined;
}

/**
 * Parse raw CC transcript JSONL lines into log events. Only 'user' and 'assistant' entries
 * are mirrored; everything else (summary/progress/system/…) is skipped. Tool calls are
 * recorded name-only — tool INPUTS often carry file contents/secrets, so the shadow records
 * THAT a tool ran, not its arguments.
 */
export function ccTranscriptLinesToEvents(lines: string[]): AdapterEvent[] {
  const events: AdapterEvent[] = [];

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Not JSON (truncated write, junk line) — skip, never throw.
      continue;
    }
    if (!isRecord(parsed)) continue;

    const entryType = parsed['type'];
    if (entryType !== 'user' && entryType !== 'assistant') continue;

    const message = parsed['message'];
    if (!isRecord(message)) continue;

    const at = timestampOf(parsed);
    const withAt = (payload: Record<string, unknown>): Record<string, unknown> =>
      at ? { ...payload, at } : payload;

    const content = message['content'];

    if (typeof content === 'string') {
      if (content.trim() === '') continue;
      events.push({
        harness: 'cc-shadow',
        actor: entryType,
        kind: 'turn_message',
        payload: withAt({ text: clipText(content) }),
      });
      continue;
    }

    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (!isRecord(block)) continue;

      if (block['type'] === 'text') {
        const text = block['text'];
        if (typeof text !== 'string' || text.trim() === '') continue;
        events.push({
          harness: 'cc-shadow',
          actor: entryType,
          kind: 'turn_message',
          payload: withAt({ text: clipText(text) }),
        });
        continue;
      }

      if (block['type'] === 'tool_use') {
        // Deliberately light payload: name only, never `input` (file contents, secrets).
        events.push({
          harness: 'cc-shadow',
          actor: 'assistant',
          kind: 'tool_call',
          payload: withAt({ name: String(block['name'] ?? 'unknown') }),
        });
        continue;
      }

      // tool_result (and any other block type) is skipped for v1: results largely duplicate
      // what the next assistant text summarizes, and their volume isn't worth mirroring.
    }
  }

  return events;
}

/** Ingest new lines from a CC session transcript into its shadow session. */
export async function ingestCcTranscript(
  service: SessionService,
  ccSessionId: string,
  lines: string[],
  opts?: { title?: string; cwd?: string },
): Promise<IngestResult> {
  return ingestBatch(
    service,
    {
      origin: 'cc-shadow',
      externalRef: ccSessionId,
      title: opts?.title ?? null,
      // CC sessions are the owner driving his own machine: tier is always 'owner'.
      tier: 'owner',
      metadata: opts?.cwd ? { cwd: opts.cwd } : {},
    },
    CC_SHADOW_HOLDER,
    ccTranscriptLinesToEvents(lines),
  );
}
