import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { sessions } from '@tars/core';
import type {
  AppendEventInput,
  OpenSessionInput,
  Session,
  SessionEvent,
  SessionLease,
  SessionService,
} from '@tars/core';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createSessionsWriteRouter } from './sessions-write-routes.js';

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

const event: SessionEvent = {
  id: 'event-3',
  seq: '3',
  sessionId: SESSION_ID,
  ts: new Date('2026-07-12T00:00:02.000Z'),
  harness: 'voice',
  actor: 'user',
  kind: 'turn_message',
  payload: { text: 'hello' },
};

const lease: SessionLease = {
  sessionId: SESSION_ID,
  holder: 'voice-loop',
  harness: 'voice',
  epoch: '1',
  acquiredAt: new Date('2026-07-12T00:00:00.000Z'),
  renewedAt: new Date('2026-07-12T00:00:00.000Z'),
  expiresAt: new Date('2026-07-12T00:01:00.000Z'),
};

// Per-write-method injected failures: when set, the fake throws instead of returning the
// canned object — this is how the error-class → HTTP status mapping is exercised.
const failures: {
  append?: Error;
  acquireLease?: Error;
  renewLease?: Error;
  takeOverLease?: Error;
  releaseLease?: Error;
} = {};

// Records what the router forwarded so tests can assert inputs/options passed through.
const received: {
  open?: OpenSessionInput;
  append?: { input: AppendEventInput; opts?: { holder?: string; expectedEpoch?: string } };
  lease?: Record<string, unknown>;
} = {};

const notUsed = (): never => {
  throw new Error('not used');
};

const fakeService: SessionService = {
  // Writes exercised by the router -------------------------------------------------------
  open: (input) => {
    received.open = input;
    return Promise.resolve({ session, event });
  },
  append: (input, opts) => {
    if (failures.append) return Promise.reject(failures.append);
    received.append = { input, opts };
    return Promise.resolve(event);
  },
  acquireLease: (input) => {
    if (failures.acquireLease) return Promise.reject(failures.acquireLease);
    received.lease = { action: 'acquire', ...input };
    return Promise.resolve(lease);
  },
  renewLease: (input) => {
    if (failures.renewLease) return Promise.reject(failures.renewLease);
    received.lease = { action: 'renew', ...input };
    return Promise.resolve(lease);
  },
  takeOverLease: (input) => {
    if (failures.takeOverLease) return Promise.reject(failures.takeOverLease);
    received.lease = { action: 'takeover', ...input };
    return Promise.resolve(lease);
  },
  releaseLease: (input) => {
    if (failures.releaseLease) return Promise.reject(failures.releaseLease);
    received.lease = { action: 'release', ...input };
    return Promise.resolve(true);
  },

  // Reads: only getSession is exercised (the 404 gate on the events route) ----------------
  getSession: (id: string) => Promise.resolve(id === SESSION_ID ? session : undefined),

  // Unused by this transport surface -----------------------------------------------------
  checkpoint: notUsed,
  getLease: notUsed,
  listSessions: notUsed,
  getSessionByRef: notUsed,
  listEvents: notUsed,
  listEventsSince: notUsed,
  sendMessage: notUsed,
  sendSignal: notUsed,
  ensureInbox: notUsed,
  listInbox: notUsed,
};

let httpServer!: Server;
let baseUrl!: string;

beforeAll(async () => {
  const app = express();
  app.use(createSessionsWriteRouter(fakeService));
  await new Promise<void>((resolve) => {
    httpServer = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  delete failures.append;
  delete failures.acquireLease;
  delete failures.renewLease;
  delete failures.takeOverLease;
  delete failures.releaseLease;
  delete received.open;
  delete received.append;
  delete received.lease;
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

describe('sessions write routes — POST /sessions', () => {
  it('opens a session and returns 201 with session + event', async () => {
    const res = await post('/sessions', { origin: 'voice', externalRef: 'inbox', title: 'Hi' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { session: Session; event: SessionEvent };
    expect(body.session.id).toBe(SESSION_ID);
    expect(body.event.kind).toBe('turn_message');
    expect(received.open?.origin).toBe('voice');
    expect(received.open?.externalRef).toBe('inbox');
  });

  it('returns 400 when origin is missing', async () => {
    const res = await post('/sessions', { title: 'No origin' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('origin');
  });

  it('returns 400 for an invalid tier (never reaches the DB CHECK)', async () => {
    const res = await post('/sessions', { origin: 'voice', tier: 'blocked' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('tier');
  });
});

describe('sessions write routes — POST /sessions/:id/events', () => {
  it('appends an event and returns 201, forwarding sessionId/holder/expectedEpoch', async () => {
    const res = await post(`/sessions/${SESSION_ID}/events`, {
      harness: 'voice',
      actor: 'user',
      kind: 'turn_message',
      payload: { text: 'hello' },
      holder: 'voice-loop',
      expectedEpoch: '1',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as SessionEvent;
    expect(body.seq).toBe('3');
    expect(received.append?.input.sessionId).toBe(SESSION_ID);
    expect(received.append?.input.kind).toBe('turn_message');
    expect(received.append?.opts?.holder).toBe('voice-loop');
    expect(received.append?.opts?.expectedEpoch).toBe('1');
  });

  it('returns 404 for an unknown session id', async () => {
    const res = await post(`/sessions/${MISSING_ID}/events`, {
      harness: 'voice',
      actor: 'user',
      kind: 'turn_message',
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when kind is missing', async () => {
    const res = await post(`/sessions/${SESSION_ID}/events`, {
      harness: 'voice',
      actor: 'user',
    });
    expect(res.status).toBe(400);
  });

  it('maps LeaseConflictError to 409 lease_conflict', async () => {
    failures.append = new sessions.LeaseConflictError(SESSION_ID, 'other-holder', 'voice-loop');
    const res = await post(`/sessions/${SESSION_ID}/events`, {
      harness: 'voice',
      actor: 'user',
      kind: 'turn_message',
      holder: 'voice-loop',
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe('lease_conflict');
    expect(body.error).toContain('other-holder');
  });

  it('maps StaleLeaseError to 409 stale_lease', async () => {
    failures.append = new sessions.StaleLeaseError(SESSION_ID, '1', '2');
    const res = await post(`/sessions/${SESSION_ID}/events`, {
      harness: 'voice',
      actor: 'user',
      kind: 'turn_message',
      holder: 'voice-loop',
      expectedEpoch: '1',
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('stale_lease');
  });
});

describe('sessions write routes — POST /sessions/:id/lease', () => {
  it('acquire returns 200 with the lease', async () => {
    const res = await post(`/sessions/${SESSION_ID}/lease`, {
      action: 'acquire',
      holder: 'voice-loop',
      harness: 'voice',
      ttlSeconds: 60,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SessionLease;
    expect(body.holder).toBe('voice-loop');
    expect(body.epoch).toBe('1');
    expect(received.lease?.action).toBe('acquire');
    expect(received.lease?.ttlSeconds).toBe(60);
  });

  it('release returns 200 with { released: true }', async () => {
    const res = await post(`/sessions/${SESSION_ID}/lease`, {
      action: 'release',
      holder: 'voice-loop',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { released: boolean };
    expect(body.released).toBe(true);
    expect(received.lease?.action).toBe('release');
  });

  it('maps LeaseConflictError on acquire to 409 lease_conflict', async () => {
    failures.acquireLease = new sessions.LeaseConflictError(SESSION_ID, 'other', 'voice-loop');
    const res = await post(`/sessions/${SESSION_ID}/lease`, {
      action: 'acquire',
      holder: 'voice-loop',
      harness: 'voice',
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('lease_conflict');
  });

  it('maps LeaseNotRenewableError on renew to 409 lease_not_renewable', async () => {
    failures.renewLease = new sessions.LeaseNotRenewableError(SESSION_ID, 'voice-loop');
    const res = await post(`/sessions/${SESSION_ID}/lease`, {
      action: 'renew',
      holder: 'voice-loop',
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('lease_not_renewable');
  });

  it('returns 400 for an unknown action', async () => {
    const res = await post(`/sessions/${SESSION_ID}/lease`, {
      action: 'steal',
      holder: 'voice-loop',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when takeover is missing harness', async () => {
    const res = await post(`/sessions/${SESSION_ID}/lease`, {
      action: 'takeover',
      holder: 'voice-loop',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('harness');
  });
});
