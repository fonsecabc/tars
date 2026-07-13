import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { sessions } from '@tars/core';
import type { Harness, Session, SessionEvent, SessionService } from '@tars/core';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createSessionsMessageRouter } from './sessions-message-routes.js';

type SendMessageInput = Parameters<SessionService['sendMessage']>[0];
type SendSignalInput = Parameters<SessionService['sendSignal']>[0];
type InboxOptions = Parameters<SessionService['listInbox']>[1];

const SESSION_ID = '11111111-1111-1111-1111-111111111111';

const inboxSession: Session = {
  id: SESSION_ID,
  origin: 'voice',
  externalRef: 'inbox',
  title: 'voice inbox',
  status: 'active',
  tier: 'owner',
  lastSeq: '7',
  metadata: {},
  createdAt: new Date('2026-07-12T00:00:00.000Z'),
  updatedAt: new Date('2026-07-12T00:00:01.000Z'),
};

const messageEvent: SessionEvent = {
  id: 'event-7',
  seq: '7',
  sessionId: SESSION_ID,
  ts: new Date('2026-07-12T00:00:02.000Z'),
  harness: 'whatsapp',
  actor: 'harness:whatsapp',
  kind: 'message',
  payload: { body: 'ping from whatsapp', from_harness: 'whatsapp', hop_count: 0 },
};

const signalEvent: SessionEvent = {
  id: 'event-8',
  seq: '8',
  sessionId: SESSION_ID,
  ts: new Date('2026-07-12T00:00:03.000Z'),
  harness: 'cron',
  actor: 'harness:cron',
  kind: 'signal',
  payload: { signal: 'cancel', from_harness: 'cron' },
};

// Per-method injected failures: when set, the fake throws instead of returning the canned
// object — this is how the error-class → HTTP status mapping is exercised.
const failures: {
  sendMessage?: Error;
  sendSignal?: Error;
} = {};

// Records what the router forwarded so tests can assert inputs/options passed through.
const received: {
  message?: SendMessageInput;
  signal?: SendSignalInput;
  inbox?: { harness: Harness; opts?: InboxOptions };
} = {};

const notUsed = (): never => {
  throw new Error('not used');
};

const fakeService: SessionService = {
  // Messaging exercised by the router ------------------------------------------------------
  sendMessage: (input) => {
    if (failures.sendMessage) return Promise.reject(failures.sendMessage);
    received.message = input;
    return Promise.resolve(messageEvent);
  },
  sendSignal: (input) => {
    if (failures.sendSignal) return Promise.reject(failures.sendSignal);
    received.signal = input;
    return Promise.resolve(signalEvent);
  },
  listInbox: (harness, opts) => {
    received.inbox = { harness, opts };
    return Promise.resolve({ session: inboxSession, messages: [messageEvent] });
  },

  // Unused by this transport surface -------------------------------------------------------
  open: notUsed,
  append: notUsed,
  checkpoint: notUsed,
  acquireLease: notUsed,
  renewLease: notUsed,
  takeOverLease: notUsed,
  releaseLease: notUsed,
  ensureInbox: notUsed,
  getLease: notUsed,
  listSessions: notUsed,
  getSession: notUsed,
  getSessionByRef: notUsed,
  listEvents: notUsed,
  listEventsSince: notUsed,
};

let httpServer!: Server;
let baseUrl!: string;

beforeAll(async () => {
  const app = express();
  app.use(createSessionsMessageRouter(fakeService));
  await new Promise<void>((resolve) => {
    httpServer = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  delete failures.sendMessage;
  delete failures.sendSignal;
  delete received.message;
  delete received.signal;
  delete received.inbox;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    httpServer.close((error) => (error ? reject(error) : resolve()));
  });
});

async function post(path: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('sessions message routes — POST /messages', () => {
  it('sends a message and returns 201, forwarding to/fromHarness/body/hopCount', async () => {
    const res = await post('/messages', {
      to: SESSION_ID,
      fromHarness: 'whatsapp',
      body: 'ping from whatsapp',
      replyTo: 'event-1',
      hopCount: 2,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as SessionEvent;
    expect(body.kind).toBe('message');
    expect(body.seq).toBe('7');
    expect(received.message?.to).toBe(SESSION_ID);
    expect(received.message?.fromHarness).toBe('whatsapp');
    expect(received.message?.body).toBe('ping from whatsapp');
    expect(received.message?.replyTo).toBe('event-1');
    expect(received.message?.hopCount).toBe(2);
  });

  it("passes a '@harness' address through verbatim", async () => {
    const res = await post('/messages', {
      to: '@whatsapp',
      fromHarness: 'voice',
      body: 'hello inbox',
    });
    expect(res.status).toBe(201);
    expect(received.message?.to).toBe('@whatsapp');
  });

  it('returns 400 when body is missing', async () => {
    const res = await post('/messages', { to: SESSION_ID, fromHarness: 'voice' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('body');
    expect(received.message).toBeUndefined();
  });

  it('returns 400 for an unknown fromHarness before reaching the service', async () => {
    const res = await post('/messages', { to: SESSION_ID, fromHarness: 'bogus', body: 'hi' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('fromHarness');
    expect(received.message).toBeUndefined();
  });

  it('maps HopCountExceededError to 409 hop_count_exceeded', async () => {
    failures.sendMessage = new sessions.HopCountExceededError(SESSION_ID, 5, 4);
    const res = await post('/messages', {
      to: SESSION_ID,
      fromHarness: 'voice',
      body: 'one hop too many',
      hopCount: 5,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe('hop_count_exceeded');
    expect(body.error).toContain('hop cap');
  });

  it('maps SessionNotFoundError to 404', async () => {
    failures.sendMessage = new sessions.SessionNotFoundError(SESSION_ID);
    const res = await post('/messages', {
      to: SESSION_ID,
      fromHarness: 'voice',
      body: 'to nowhere',
    });
    expect(res.status).toBe(404);
  });

  it('rejects a whitespace-only body at the route (400, service never called)', async () => {
    const res = await post('/messages', { to: SESSION_ID, fromHarness: 'voice', body: '   ' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('body');
    expect(received.message).toBeUndefined();
  });

  it("rejects an unknown '@' address at the route (400, service never called)", async () => {
    const res = await post('/messages', { to: '@bogus', fromHarness: 'voice', body: 'hello' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('@bogus');
    expect(received.message).toBeUndefined();
  });

  it('an unexpected plain Error (e.g. infra failure) surfaces as 500, never a misleading 400', async () => {
    failures.sendMessage = new Error('connection terminated unexpectedly');
    const res = await post('/messages', { to: SESSION_ID, fromHarness: 'voice', body: 'hello' });
    expect(res.status).toBe(500);
  });
});

describe('sessions message routes — POST /signals', () => {
  it('sends a signal and returns 201, forwarding to/signal/fromHarness/payload', async () => {
    const res = await post('/signals', {
      to: SESSION_ID,
      signal: 'cancel',
      fromHarness: 'cron',
      payload: { reason: 'shutdown' },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as SessionEvent;
    expect(body.kind).toBe('signal');
    expect(received.signal?.to).toBe(SESSION_ID);
    expect(received.signal?.signal).toBe('cancel');
    expect(received.signal?.fromHarness).toBe('cron');
    expect(received.signal?.payload).toEqual({ reason: 'shutdown' });
  });

  it('returns 400 for an unknown signal, listing the valid kinds', async () => {
    const res = await post('/signals', {
      to: SESSION_ID,
      signal: 'explode',
      fromHarness: 'cron',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    for (const kind of sessions.SIGNAL_KINDS) {
      expect(body.error).toContain(kind);
    }
    expect(received.signal).toBeUndefined();
  });

  it('returns 400 when to is missing', async () => {
    const res = await post('/signals', { signal: 'ping', fromHarness: 'voice' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('to');
    expect(received.signal).toBeUndefined();
  });
});

describe('sessions message routes — GET /harnesses/:harness/inbox', () => {
  it('returns 200 with the inbox view and forwards afterSeq/limit', async () => {
    const res = await fetch(`${baseUrl}/harnesses/voice/inbox?afterSeq=5&limit=10`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: Session; messages: SessionEvent[] };
    expect(body.session.externalRef).toBe('inbox');
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]?.kind).toBe('message');
    expect(received.inbox?.harness).toBe('voice');
    expect(received.inbox?.opts?.afterSeq).toBe('5');
    expect(received.inbox?.opts?.limit).toBe(10);
  });

  it('returns 400 for an unknown harness', async () => {
    const res = await fetch(`${baseUrl}/harnesses/bogus/inbox`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('bogus');
    expect(received.inbox).toBeUndefined();
  });
});
