import { describe, expect, it } from 'vitest';

import type { SessionService } from '../service.js';
import type { Session, SessionLease } from '../types.js';
import { clipText, ingestBatch, MAX_TEXT_LENGTH, type AdapterEvent } from './adapter.js';

// Pure fake-service tests for the shared kit's lease discipline — the paths the per-adapter
// integration tests can't reach (mid-batch failure, release failure, empty-batch short-circuit).

const SESSION: Session = {
  id: '00000000-0000-4000-8000-000000000001',
  origin: 'voice',
  externalRef: 'conv-1',
  title: null,
  status: 'active',
  tier: 'owner',
  lastSeq: null,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

const LEASE: SessionLease = {
  sessionId: SESSION.id,
  holder: 'voice:adapter',
  harness: 'voice',
  epoch: '1',
  acquiredAt: new Date(),
  renewedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
};

const TURN: AdapterEvent = {
  harness: 'voice',
  actor: 'user',
  kind: 'turn_message',
  payload: { text: 'synthetic turn' },
};

const notUsed = (): never => {
  throw new Error('not used');
};

interface FakeOverrides {
  existingSession?: Session;
  appendFailsAtCall?: number;
  releaseThrows?: boolean;
}

interface FakeCalls {
  opened: boolean;
  leaseAcquired: boolean;
  released: boolean;
  appends: number;
}

function makeFake(overrides: FakeOverrides = {}): { service: SessionService; calls: FakeCalls } {
  const calls: FakeCalls = { opened: false, leaseAcquired: false, released: false, appends: 0 };
  const service: SessionService = {
    getSessionByRef: () => Promise.resolve(overrides.existingSession),
    open: () => {
      calls.opened = true;
      return Promise.resolve({
        session: SESSION,
        event: {
          id: '00000000-0000-4000-8000-0000000000ee',
          seq: '1',
          sessionId: SESSION.id,
          ts: new Date(),
          harness: 'voice',
          actor: 'system',
          kind: 'session_opened',
          payload: {},
        },
      });
    },
    acquireLease: () => {
      calls.leaseAcquired = true;
      return Promise.resolve(LEASE);
    },
    append: (input) => {
      calls.appends += 1;
      if (overrides.appendFailsAtCall === calls.appends) {
        return Promise.reject(new Error('append blew up'));
      }
      return Promise.resolve({
        id: '00000000-0000-4000-8000-0000000000aa',
        seq: String(calls.appends + 1),
        sessionId: input.sessionId,
        ts: new Date(),
        harness: input.harness,
        actor: input.actor,
        kind: input.kind,
        payload: input.payload ?? {},
      });
    },
    releaseLease: () => {
      calls.released = true;
      return overrides.releaseThrows
        ? Promise.reject(new Error('release blew up'))
        : Promise.resolve(true);
    },
    checkpoint: notUsed,
    renewLease: notUsed,
    takeOverLease: notUsed,
    getLease: notUsed,
    listSessions: notUsed,
    getSession: notUsed,
    listEvents: notUsed,
    listEventsSince: notUsed,
    sendMessage: notUsed,
    sendSignal: notUsed,
    ensureInbox: notUsed,
    listInbox: notUsed,
  };
  return { service, calls };
}

const REF = { origin: 'voice' as const, externalRef: 'conv-1' };

describe('ingestBatch — lease discipline', () => {
  it('releases the lease when an append fails mid-batch, surfacing the ORIGINAL error', async () => {
    const { service, calls } = makeFake({ appendFailsAtCall: 2 });

    await expect(ingestBatch(service, REF, 'voice:adapter', [TURN, TURN, TURN])).rejects.toThrow(
      'append blew up',
    );
    expect(calls.released).toBe(true);
    expect(calls.appends).toBe(2); // stopped at the failure, third append never attempted
  });

  it('a failing release never masks the append error', async () => {
    const { service, calls } = makeFake({ appendFailsAtCall: 1, releaseThrows: true });

    // The append error must win; 'release blew up' is swallowed.
    await expect(ingestBatch(service, REF, 'voice:adapter', [TURN])).rejects.toThrow(
      'append blew up',
    );
    expect(calls.released).toBe(true);
  });

  it('an empty batch ensures the session exists but takes NO lease', async () => {
    const { service, calls } = makeFake();

    const result = await ingestBatch(service, REF, 'voice:adapter', []);

    expect(calls.opened).toBe(true);
    expect(result.sessionCreated).toBe(true);
    expect(result.appended).toEqual([]);
    expect(calls.leaseAcquired).toBe(false);
    expect(calls.released).toBe(false);
  });

  it('an existing session is reused without opening (no resume-marker spam)', async () => {
    const { service, calls } = makeFake({ existingSession: SESSION });

    const result = await ingestBatch(service, REF, 'voice:adapter', []);

    expect(calls.opened).toBe(false);
    expect(result.sessionCreated).toBe(false);
    expect(result.session.id).toBe(SESSION.id);
  });
});

describe('clipText', () => {
  it('passes short text through and clips long text with an ellipsis', () => {
    expect(clipText('short')).toBe('short');
    const clipped = clipText('x'.repeat(MAX_TEXT_LENGTH + 5));
    expect(clipped.length).toBe(MAX_TEXT_LENGTH + 1);
    expect(clipped.endsWith('…')).toBe(true);
  });
});
