/**
 * Chronicle WhatsApp adapter — maps responder chat exchanges (bridge webhook → trust-gate →
 * recall → reply) into `turn_message` log events and ingests them via the shared kit.
 *
 * Trust-tier policy: the responder's trust-gate classifies every chat as
 * owner | trusted | guest | blocked. **'blocked' never reaches this adapter** — the harness
 * filters blocked traffic before ingestion, which is why `WhatsAppChatRef.tier` is the
 * three-value `SessionTier` and not the gate's four-value vocabulary. The session's `tier`
 * is stamped from the chat's trust tier at CREATION; find-or-create preserves the original
 * tier afterwards, so a later re-ingest with a different tier never rewrites it.
 *
 * BUILD-DON'T-ACTIVATE: exercised against synthetic data only until the encryption-at-rest
 * gate is cleared — nothing here reads live chats or wires into the responder.
 */
import type { AdapterEvent, IngestResult } from './adapter.js';
import { clipText, ingestBatch } from './adapter.js';
import type { SessionService } from '../service.js';
import type { SessionTier } from '../types.js';

/** One message in a WhatsApp chat exchange. */
export interface WhatsAppMessage {
  /** True when TARS sent it (the responder's own reply). */
  fromMe: boolean;
  /** Display name of the sender (used as actor for inbound; ignored for fromMe). */
  senderName?: string;
  text: string;
  at?: Date;
}

/** The chat a batch of messages belongs to — the harness-native session identity. */
export interface WhatsAppChatRef {
  /** Chat JID — the stable per-chat identity (external_ref). */
  chatJid: string;
  chatName?: string;
  /** Trust tier of this chat per the responder's trust-gate. Blocked chats never get here. */
  tier: SessionTier;
}

export const WHATSAPP_HOLDER = 'whatsapp:adapter';

/** Map an exchange to log events. Empty/whitespace-only messages are dropped. */
export function whatsappMessagesToEvents(messages: WhatsAppMessage[]): AdapterEvent[] {
  const events: AdapterEvent[] = [];
  for (const message of messages) {
    const text = message.text.trim();
    if (text === '') continue;
    events.push({
      harness: 'whatsapp',
      actor: message.fromMe ? 'assistant' : (message.senderName?.trim() ?? '') || 'user',
      kind: 'turn_message',
      payload: {
        text: clipText(text),
        ...(message.at ? { at: message.at.toISOString() } : {}),
      },
    });
  }
  return events;
}

/**
 * Ingest a chat exchange into the chat's session (origin 'whatsapp', externalRef = chat JID).
 * The chat's tier is stamped on the session only when this call creates it.
 */
export async function ingestWhatsAppExchange(
  service: SessionService,
  chat: WhatsAppChatRef,
  messages: WhatsAppMessage[],
): Promise<IngestResult> {
  return ingestBatch(
    service,
    {
      origin: 'whatsapp',
      externalRef: chat.chatJid,
      title: chat.chatName ?? null,
      tier: chat.tier,
    },
    WHATSAPP_HOLDER,
    whatsappMessagesToEvents(messages),
  );
}
