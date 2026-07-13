/**
 * Chronicle voice adapter — maps terse voice-loop turn records (open-mic → whisper →
 * router → speak) into `turn_message` log events and ingests them via the shared kit.
 *
 * Session-boundary policy — what counts as one `conversationId` (a silence gap, a wake-word
 * reset, a daily bucket, …) — is decided by the voice router at activation time. The adapter
 * is agnostic; it just needs a stable id per conversation.
 *
 * BUILD-DON'T-ACTIVATE: exercised against synthetic data only until the encryption-at-rest
 * gate is cleared — nothing here reads live transcripts or wires into the voice loop.
 */
import type { AdapterEvent, IngestResult } from './adapter.js';
import { clipText, ingestBatch } from './adapter.js';
import type { SessionService } from '../service.js';

/** One utterance in a voice conversation. */
export interface VoiceTurn {
  /** 'user' (the owner speaking) or 'assistant' (TARS speaking). */
  role: 'user' | 'assistant';
  text: string;
  at?: Date;
  /** Optional extras (e.g. confidence from whisper, wake-word flag). */
  extra?: Record<string, unknown>;
}

export const VOICE_HOLDER = 'voice:adapter';

/** Map voice turns to log events. Empty/whitespace-only turns are dropped. */
export function voiceTurnsToEvents(turns: VoiceTurn[]): AdapterEvent[] {
  const events: AdapterEvent[] = [];
  for (const turn of turns) {
    const text = turn.text.trim();
    if (text === '') continue;
    events.push({
      harness: 'voice',
      actor: turn.role,
      kind: 'turn_message',
      payload: {
        text: clipText(text),
        ...(turn.at ? { at: turn.at.toISOString() } : {}),
        ...(turn.extra ?? {}),
      },
    });
  }
  return events;
}

/** Ingest a batch of voice turns into the conversation's session (origin 'voice'). */
export async function ingestVoiceTurns(
  service: SessionService,
  conversationId: string,
  turns: VoiceTurn[],
  opts?: { title?: string },
): Promise<IngestResult> {
  return ingestBatch(
    service,
    {
      origin: 'voice',
      externalRef: conversationId,
      title: opts?.title ?? null,
      // Voice is the owner's own mic: tier is always 'owner'.
      tier: 'owner',
    },
    VOICE_HOLDER,
    voiceTurnsToEvents(turns),
  );
}
