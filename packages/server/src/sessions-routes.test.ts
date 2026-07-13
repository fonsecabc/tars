import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type {
  ListEventsOptions,
  ListSessionsOptions,
  Session,
  SessionEvent,
  SessionService,
} from '@tars/core';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createSessionsRouter } from './sessions-routes.js';

const SESSION_ID = '11111111-1111-1111-1111-111111111111';
const MISSING_ID = '22222222-2222-2222-2222-222222222222';

const session: Session = {
  id: SESSION_ID,
  origin: 'voice',
  externalRef: 'inbox',
  title: 'Test session',
  status: 'active',
  tier: 'owner',
  lastSeq: '2',
  metadata: {},
  createdAt: new Date('2026-07-12T00:00:00.000Z'),
  updatedAt: new Date('2026-07-12T00:00:01.000Z'),
};

function makeEvent(seq: string): SessionEvent {
  return {
    id: `event-${seq}`,
    seq,
    sessionId: SESSION_ID,
    ts: new Date('2026-07-12T00:00:00.000Z'),
    harness: 'voice',
    actor: 'user',
    kind: 'turn_message',
    payload: { text: `event ${seq}` },
  };
}

const SEEDED_EVENTS: SessionEvent[] = [makeEvent('1'), makeEvent('2')];

// Records what the router forwarded so tests can assert filters/cursors were passed through.
const received: {
  listSessions?: ListSessionsOptions;
  listEvents?: ListEventsOptions;
} = {};

const notUsed = (): never => {
  throw new Error('not used');
};

const fakeService: SessionService = {
  // Reads exercised by the router --------------------------------------------------------
  listSessions: (opts?: ListSessionsOptions) => {
    received.listSessions = opts;
    return Promise.resolve([session]);
  },
  getSession: (id: string) => Promise.resolve(id === SESSION_ID ? session : undefined),
  listEvents: (_sessionId: string, opts?: ListEventsOptions) => {
    received.listEvents = opts;
    // Filter by the bigint-as-string cursor so the SSE pump naturally drains to [] once the
    // cursor advances past the seeded events (mirrors real seq > afterSeq semantics).
    const after = BigInt(opts?.afterSeq ?? '0');
    return Promise.resolve(SEEDED_EVENTS.filter((e) => BigInt(e.seq) > after));
  },

  // Unused by this transport surface -----------------------------------------------------
  getSessionByRef: notUsed,
  open: notUsed,
  append: notUsed,
  checkpoint: notUsed,
  acquireLease: notUsed,
  renewLease: notUsed,
  takeOverLease: notUsed,
  releaseLease: notUsed,
  getLease: notUsed,
  listEventsSince: notUsed,
};

let httpServer!: Server;
let baseUrl!: string;

beforeAll(async () => {
  const app = express();
  app.use(createSessionsRouter(fakeService));
  await new Promise<void>((resolve) => {
    httpServer = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  delete received.listSessions;
  delete received.listEvents;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    httpServer.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('sessions routes — reads', () => {
  it('GET /sessions returns the list', async () => {
    const res = await fetch(`${baseUrl}/sessions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Session[];
    expect(body).toHaveLength(1);
    expect(body[0]?.id).toBe(SESSION_ID);
  });

  it('GET /sessions forwards the status filter', async () => {
    const res = await fetch(`${baseUrl}/sessions?status=active`);
    expect(res.status).toBe(200);
    expect(received.listSessions?.status).toBe('active');
  });

  it('GET /sessions/:id returns the session', async () => {
    const res = await fetch(`${baseUrl}/sessions/${SESSION_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Session;
    expect(body.id).toBe(SESSION_ID);
  });

  it('GET /sessions/:id returns 404 for an unknown id', async () => {
    const res = await fetch(`${baseUrl}/sessions/${MISSING_ID}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('session not found');
  });

  it('GET /sessions/:id/events returns events', async () => {
    const res = await fetch(`${baseUrl}/sessions/${SESSION_ID}/events`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SessionEvent[];
    expect(body).toHaveLength(2);
    expect(body[0]?.seq).toBe('1');
  });

  it('GET /sessions/:id/events forwards the afterSeq cursor', async () => {
    const res = await fetch(`${baseUrl}/sessions/${SESSION_ID}/events?afterSeq=5`);
    expect(res.status).toBe(200);
    expect(received.listEvents?.afterSeq).toBe('5');
  });

  it('GET /sessions/:id/events returns 404 when the session is unknown', async () => {
    const res = await fetch(`${baseUrl}/sessions/${MISSING_ID}/events`);
    expect(res.status).toBe(404);
  });
});

describe('sessions routes — SSE tail', () => {
  it('returns 404 for an unknown session', async () => {
    const res = await fetch(`${baseUrl}/sessions/${MISSING_ID}/tail`);
    expect(res.status).toBe(404);
  });

  it('streams the replayed events then can be aborted', async () => {
    const ac = new AbortController();
    const res = await fetch(`${baseUrl}/sessions/${SESSION_ID}/tail`, {
      signal: ac.signal,
      headers: { Accept: 'text/event-stream' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const deadline = Date.now() + 500;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) text += decoder.decode(value, { stream: true });
      if (text.includes('id: 2')) break;
    }

    ac.abort();
    await reader.cancel().catch(() => undefined);

    expect(text).toContain('data:');
    expect(text).toContain('id: 1');
    expect(text).toContain('id: 2');
  });
});
