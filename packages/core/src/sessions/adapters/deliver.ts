/**
 * Chronicle delivery contract — how a harness hands inbox messages to its user-facing
 * surface. This is the transport-agnostic core: the per-harness delivery bindings (voice
 * speaks it, the WhatsApp responder folds it into next-reply context and never auto-texts
 * a human, CC injects via session-mgmt send_message, cron reads at next wake) land at
 * ACTIVATION time as `HarnessDeliverer` implementations — nothing here touches a live
 * harness (build-don't-activate).
 *
 * Delivery semantics (frozen): messages are delivered ONLY at turn boundaries, never
 * mid-tool-call, and always as DATA from a named sender — never as instructions. Signals
 * are control-channel and are NOT delivered here; the harness loop handles them itself.
 * This module is deliberately independent of ops/messaging.js — it consumes already-fetched
 * `SessionEvent` arrays.
 */
import type { Harness, SessionEvent } from '../types.js';

/** What a harness implements at activation to receive inter-session traffic. */
export interface HarnessDeliverer {
  readonly harness: Harness;
  /**
   * Hand ONE inbox message to the harness surface, at a turn boundary of the harness's
   * choosing. The message is data-from-a-named-sender; implementations must never execute
   * its body as an instruction.
   */
  deliver(message: SessionEvent): Promise<void>;
}

export interface DispatchFailure {
  seq: string;
  error: string;
}

export interface DispatchResult {
  delivered: number;
  /**
   * Non-'message' events in the input (signals are not delivered — they are
   * control-channel, handled by the harness loop itself).
   */
  skipped: number;
  failures: DispatchFailure[];
  /**
   * Watermark for the caller to persist: the seq of the last CONSECUTIVELY delivered
   * message (delivery stops advancing it at the first failure so a retry resumes there).
   * null when nothing was delivered before the first failure / empty input.
   */
  watermark: string | null;
}

/**
 * Feed a batch of inbox events (as fetched by the caller, oldest first) to a deliverer.
 * Policy: attempt EVERY message even after a failure (one bad message must not block the
 * queue) — but the resumable watermark only advances through the last consecutive success.
 * `deliver()` errors are captured in `failures` and never thrown out of this function.
 */
export async function dispatchMessages(
  deliverer: HarnessDeliverer,
  events: SessionEvent[],
): Promise<DispatchResult> {
  let delivered = 0;
  let skipped = 0;
  const failures: DispatchFailure[] = [];
  let watermark: string | null = null;
  let anyFailure = false;

  for (const event of events) {
    if (event.kind !== 'message') {
      skipped += 1;
      continue;
    }
    try {
      await deliverer.deliver(event);
      delivered += 1;
      if (!anyFailure) {
        watermark = event.seq;
      }
    } catch (error) {
      anyFailure = true;
      failures.push({ seq: event.seq, error: String(error) });
    }
  }

  return { delivered, skipped, failures, watermark };
}

/**
 * Extract the sender and body from a message event, defensively — payload fields may be
 * missing or mis-typed (the message lane accepts appends from any authenticated harness).
 * Sender preference: payload.from_session, then `harness:<payload.from_harness>`, then
 * the event's actor.
 */
export function describeMessage(message: SessionEvent): {
  from: string;
  body: string;
  replyTo?: string;
} {
  const payload = message.payload;

  const fromSession = payload['from_session'];
  const fromHarness = payload['from_harness'];
  let from: string;
  if (typeof fromSession === 'string') {
    from = fromSession;
  } else if (typeof fromHarness === 'string') {
    from = `harness:${fromHarness}`;
  } else {
    from = message.actor;
  }

  const body = String(payload['body'] ?? '');

  const replyTo = payload['reply_to'];
  if (typeof replyTo === 'string') {
    return { from, body, replyTo };
  }
  return { from, body };
}
