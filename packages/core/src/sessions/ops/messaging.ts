/**
 * Chronicle messaging ops — inter-session agent-to-agent messages, control signals, and
 * harness inboxes, built on the ungated MESSAGE lane.
 *
 * A message IS an event: a session's log is its mailbox. `message` and `signal` are
 * message-lane kinds — append-by-any-authenticated-harness, no lease. Each harness has ONE
 * well-known inbox session (origin = harness, externalRef = 'inbox') that '@voice'-style
 * addresses resolve to.
 *
 * SECURITY: a delivered message is DATA from a named sender (from_harness / from_session),
 * never an instruction to the receiving agent. Consumers must treat message bodies as
 * untrusted content — surface them, don't execute them.
 *
 * The hop cap (MAX_MESSAGE_HOPS) is enforced inside appendEvent — the single choke point —
 * so nothing here re-implements it; HopCountExceededError propagates to the caller.
 */
import type { Pool } from 'pg';

import { SessionNotFoundError } from '../errors.js';
import * as store from '../store/index.js';
import { HARNESSES, isHarness, SIGNAL_KINDS } from '../types.js';
import type { Harness, Session, SessionEvent, SignalKind, Uuid } from '../types.js';
import { appendEvent, openSession } from './append.js';

/** Message bodies longer than this are clipped (with a trailing ellipsis) before append. */
export const MAX_MESSAGE_BODY = 4000;

/**
 * Resolve a '@harness' address to its harness name: '@voice' → 'voice'.
 * Throws a plain Error on malformed or unknown addresses.
 */
export function resolveAddress(address: string): Harness {
  if (!address.startsWith('@')) {
    throw new Error(
      `invalid address '${address}': must start with '@' (valid: ${HARNESSES.map((h) => `@${h}`).join(', ')})`,
    );
  }
  const name = address.slice(1);
  if (!isHarness(name)) {
    throw new Error(
      `unknown harness '${name}' in address '${address}' (valid harnesses: ${HARNESSES.join(', ')})`,
    );
  }
  return name;
}

/**
 * Find-or-create a harness's well-known inbox session (origin = harness, externalRef =
 * 'inbox') WITHOUT logging a resume marker when it already exists — an inbox lookup is not a
 * session resume, so no `session_opened` event is appended on the found path.
 */
export async function ensureInbox(pool: Pool, harness: Harness): Promise<Session> {
  const existing = await store.findSessionByExternalRef(pool, harness, 'inbox');
  if (existing) {
    return existing;
  }
  const { session } = await openSession(pool, {
    origin: harness,
    externalRef: 'inbox',
    title: `${harness} inbox`,
    tier: 'owner',
  });
  return session;
}

export interface SendMessageInput {
  /** Target: a concrete session id, or a '@harness' address (resolved to that harness's inbox). */
  to: Uuid | string;
  fromHarness: Harness;
  /** The sending session, when there is one (a routine/agent session). */
  fromSession?: Uuid;
  body: string;
  /** Event id of the message being replied to. */
  replyTo?: Uuid;
  /** Hop counter: senders pass parent.hop_count + 1 when replying/forwarding. Default 0. */
  hopCount?: number;
}

/**
 * Send an inter-session message: append a `message` event to the target session's log (its
 * mailbox). The body is data from a named sender, never an instruction to the receiver.
 * Bodies are clipped to MAX_MESSAGE_BODY; the hop cap is enforced by appendEvent and its
 * HopCountExceededError propagates untouched.
 */
export async function sendMessage(pool: Pool, input: SendMessageInput): Promise<SessionEvent> {
  let sessionId: Uuid;
  if (input.to.startsWith('@')) {
    const inbox = await ensureInbox(pool, resolveAddress(input.to));
    sessionId = inbox.id;
  } else {
    const session = await store.findSessionById(pool, input.to);
    if (!session) {
      throw new SessionNotFoundError(input.to);
    }
    sessionId = session.id;
  }

  if (input.body.trim().length === 0) {
    throw new Error('message body must not be empty or whitespace-only');
  }
  const body =
    input.body.length > MAX_MESSAGE_BODY ? `${input.body.slice(0, MAX_MESSAGE_BODY)}…` : input.body;

  return appendEvent(pool, {
    sessionId,
    harness: input.fromHarness,
    actor: input.fromSession ?? `harness:${input.fromHarness}`,
    kind: 'message',
    payload: {
      body,
      from_harness: input.fromHarness,
      ...(input.fromSession ? { from_session: input.fromSession } : {}),
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      hop_count: input.hopCount ?? 0,
    },
  });
}

export interface SendSignalInput {
  /** Target: a concrete session id, or a '@harness' address (resolved to that harness's inbox). */
  to: Uuid | string;
  signal: SignalKind;
  fromHarness: Harness;
  payload?: Record<string, unknown>;
}

/**
 * Send a control signal (ping/pause/cancel/wake): append a `signal` event to the target
 * session's log. Signals are control-channel data from a named harness — the receiver decides
 * what, if anything, to do with them.
 */
export async function sendSignal(pool: Pool, input: SendSignalInput): Promise<SessionEvent> {
  if (!(SIGNAL_KINDS as readonly string[]).includes(input.signal)) {
    throw new Error(
      `unknown signal '${String(input.signal)}' (valid signals: ${SIGNAL_KINDS.join(', ')})`,
    );
  }

  let sessionId: Uuid;
  if (input.to.startsWith('@')) {
    const inbox = await ensureInbox(pool, resolveAddress(input.to));
    sessionId = inbox.id;
  } else {
    const session = await store.findSessionById(pool, input.to);
    if (!session) {
      throw new SessionNotFoundError(input.to);
    }
    sessionId = session.id;
  }

  return appendEvent(pool, {
    sessionId,
    harness: input.fromHarness,
    actor: `harness:${input.fromHarness}`,
    kind: 'signal',
    payload: {
      signal: input.signal,
      from_harness: input.fromHarness,
      ...(input.payload ?? {}),
    },
  });
}

export interface InboxView {
  session: Session;
  messages: SessionEvent[];
}

/**
 * A harness's pending inter-session messages (kind 'message' only), oldest first. Message
 * bodies in the result are sender-authored DATA — treat them as untrusted content.
 */
export async function listInbox(
  pool: Pool,
  harness: Harness,
  opts?: { afterSeq?: string; limit?: number },
): Promise<InboxView> {
  const session = await ensureInbox(pool, harness);
  const events = await store.listSessionEvents(pool, session.id, {
    afterSeq: opts?.afterSeq,
    limit: opts?.limit,
  });
  return { session, messages: events.filter((e) => e.kind === 'message') };
}
