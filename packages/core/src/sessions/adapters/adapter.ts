/**
 * Chronicle adapter shared kit — orchestrator-owned. The per-harness adapters (voice,
 * whatsapp, cron, cc-shadow) each map their harness-native records into `AdapterEvent`s and
 * compose `ingestBatch` to land them in the log. Keeping the find-or-open + lease + append +
 * release choreography here means every adapter gets the same single-writer discipline.
 *
 * BUILD-DON'T-ACTIVATE: adapters are exercised against synthetic data only until the
 * encryption-at-rest gate (FileVault) is cleared — nothing here wires into a live harness.
 */
import type { SessionService } from '../service.js';
import type { AppendEventInput, Harness, Session, SessionEvent, SessionTier } from '../types.js';

/** A harness-native session identity. `tier` is stamped at creation and preserved after. */
export interface AdapterSessionRef {
  origin: Harness;
  /** Harness-native id: voice conversation id, WhatsApp chat JID, cron task name, CC session id. */
  externalRef: string;
  title?: string | null;
  tier?: SessionTier;
  metadata?: Record<string, unknown>;
}

/** An event as adapters produce them — the session id is resolved by `ingestBatch`. */
export type AdapterEvent = Omit<AppendEventInput, 'sessionId'>;

export interface IngestResult {
  session: Session;
  /** Newly created this call (false = the session already existed). */
  sessionCreated: boolean;
  appended: SessionEvent[];
}

/** Observation/text payloads are clipped to keep events atomic and replay cheap. */
export const MAX_TEXT_LENGTH = 2000;

/** Clip harness text to a payload-safe length (adapters apply this to every text field). */
export function clipText(text: string): string {
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}…` : text;
}

/**
 * Land a batch of harness events in a session's log with single-writer discipline:
 * find-or-open the session (no `session_opened` spam on re-ingest), acquire the turn-lane
 * lease as `holder`, append every event fenced by the lease epoch, then release.
 *
 * Throws `LeaseConflictError` if another harness is live-driving the session — batch
 * ingestion never steals the wheel; the caller decides whether a take-over is warranted.
 * An empty `events` array just ensures the session exists (no lease taken).
 */
export async function ingestBatch(
  service: SessionService,
  ref: AdapterSessionRef,
  holder: string,
  events: AdapterEvent[],
): Promise<IngestResult> {
  const existing = await service.getSessionByRef(ref.origin, ref.externalRef);
  let session = existing;
  let sessionCreated = false;
  if (!session) {
    const opened = await service.open(
      {
        origin: ref.origin,
        externalRef: ref.externalRef,
        title: ref.title ?? null,
        ...(ref.tier ? { tier: ref.tier } : {}),
        metadata: ref.metadata ?? {},
      },
      { actor: 'system' },
    );
    session = opened.session;
    sessionCreated = true;
  }

  if (events.length === 0) {
    return { session, sessionCreated, appended: [] };
  }

  const lease = await service.acquireLease({
    sessionId: session.id,
    holder,
    harness: ref.origin,
  });

  const appended: SessionEvent[] = [];
  try {
    for (const event of events) {
      appended.push(
        await service.append(
          { ...event, sessionId: session.id },
          { holder, expectedEpoch: lease.epoch },
        ),
      );
    }
  } finally {
    // Batch ingestion holds the wheel only while writing. A failed release must never mask
    // the original append error (the lease self-heals via its TTL anyway).
    try {
      await service.releaseLease({ sessionId: session.id, holder });
    } catch {
      // Swallowed deliberately: the append error (if any) is the one that matters.
    }
  }

  return { session, sessionCreated, appended };
}
