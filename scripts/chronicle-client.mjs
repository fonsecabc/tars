// Chronicle loopback client — the tiny HTTP shim out-of-process harnesses (voice router,
// cron helpers, ad-hoc scripts) use to write to the session log. Zero dependencies; every
// call talks to the trusted loopback listener. Failures THROW — callers that must never be
// disrupted by Chronicle (live responders) wrap calls fire-and-forget.
//
// bigint fields (seq/epoch) are strings end-to-end; never Number() them.

const BASE = process.env.CHRONICLE_URL ?? 'http://127.0.0.1:8787';

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`chronicle ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`chronicle ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

/** Find-or-create a session; logs a session_opened marker. Returns { session, event }. */
export function openSession({ origin, externalRef, title, tier, metadata }) {
  return post('/sessions', { origin, externalRef, title, tier, metadata });
}

export function acquireLease(sessionId, holder, harness, ttlSeconds) {
  return post(`/sessions/${sessionId}/lease`, { action: 'acquire', holder, harness, ttlSeconds });
}

export function releaseLease(sessionId, holder) {
  return post(`/sessions/${sessionId}/lease`, { action: 'release', holder });
}

export function appendEvent(sessionId, { harness, actor, kind, payload, holder, expectedEpoch }) {
  return post(`/sessions/${sessionId}/events`, {
    harness,
    actor,
    kind,
    payload,
    holder,
    expectedEpoch,
  });
}

/**
 * The standard harness capture: find-or-open the session by (origin, externalRef), take the
 * lease, append every event fenced by its epoch, release. Mirrors the core ingestBatch
 * semantics over HTTP. `events` = [{ actor, kind, payload }].
 */
export async function ingestBatch({ origin, externalRef, title, tier, metadata }, holder, events) {
  const sessions = await get(
    `/sessions?origin=${encodeURIComponent(origin)}&limit=500`,
  ).catch(() => []);
  let session = sessions.find((s) => s.externalRef === externalRef);
  if (!session) {
    session = (await openSession({ origin, externalRef, title, tier, metadata })).session;
  }
  if (!events.length) return { session, appended: [] };
  const lease = await acquireLease(session.id, holder, origin);
  const appended = [];
  try {
    for (const e of events) {
      appended.push(
        await appendEvent(session.id, {
          harness: origin,
          actor: e.actor,
          kind: e.kind,
          payload: e.payload,
          holder,
          expectedEpoch: lease.epoch,
        }),
      );
    }
  } finally {
    await releaseLease(session.id, holder).catch(() => {});
  }
  return { session, appended };
}

/** Send an inter-session message. `to` = session uuid or '@harness'. */
export function sendMessage({ to, fromHarness, fromSession, body, replyTo, hopCount }) {
  return post('/messages', { to, fromHarness, fromSession, body, replyTo, hopCount });
}

/** Send a control signal (ping/pause/cancel/wake). */
export function sendSignal({ to, signal, fromHarness, payload }) {
  return post('/signals', { to, signal, fromHarness, payload });
}

/** A harness's pending inter-session messages. */
export function listInbox(harness, { afterSeq, limit } = {}) {
  const params = new URLSearchParams();
  if (afterSeq !== undefined) params.set('afterSeq', afterSeq);
  if (limit !== undefined) params.set('limit', String(limit));
  const qs = params.toString();
  return get(`/harnesses/${harness}/inbox${qs ? `?${qs}` : ''}`);
}
