/**
 * Chronicle LEASE ops — the transactional control plane for the single-writer turn lane.
 *
 * These wrap the pure lease store fns (`../store/leases.ts`) in a transaction + audit trail,
 * owning the clock/TTL policy the store deliberately leaves to the ops layer. They touch ONLY
 * the lease store + the audit log — no session EVENT is emitted here (recording handoffs into
 * the event log is a later batch). Fencing (epoch bumps on take-over) lives in the store; these
 * ops surface it in the audit `detail` so a seizure is traceable.
 */
import type { Pool } from 'pg';

import { withTransaction } from '../../db/tx.js';
import type { Uuid } from '../../schema/common.js';
import { appendAudit } from '../../store/audit.js';
import { LeaseConflictError, LeaseNotRenewableError } from '../errors.js';
import * as store from '../store/index.js';
import type { Harness, SessionLease } from '../types.js';

/**
 * Default lease lifetime. Leases are short and kept alive by an active writer's renew
 * heartbeat; a lapsed heartbeat lets another harness cooperatively take over after this window.
 */
const DEFAULT_LEASE_TTL_SECONDS = 120;

/** Compute the absolute expiry deadline for an op, honoring an explicit ttl override. */
function expiryFrom(ttlSeconds: number | undefined): Date {
  return new Date(Date.now() + (ttlSeconds ?? DEFAULT_LEASE_TTL_SECONDS) * 1000);
}

// --- acquire ----------------------------------------------------------------

export interface AcquireLeaseInput {
  sessionId: Uuid;
  holder: string;
  harness: Harness;
  ttlSeconds?: number;
}

/**
 * Cooperative claim of the turn-lane write token. Succeeds when the lease is free, expired, or
 * already this holder's (a same-holder re-claim keeps the epoch). Throws {@link LeaseConflictError}
 * when a different writer still holds a live lease.
 */
export async function acquireLease(pool: Pool, input: AcquireLeaseInput): Promise<SessionLease> {
  const expiresAt = expiryFrom(input.ttlSeconds);
  return withTransaction(pool, async (tx) => {
    const lease = await store.claimLease(tx, {
      sessionId: input.sessionId,
      holder: input.holder,
      harness: input.harness,
      expiresAt,
    });
    if (lease === undefined) {
      const live = await store.getLease(tx, input.sessionId);
      throw new LeaseConflictError(input.sessionId, live?.holder ?? 'unknown', input.holder);
    }
    await appendAudit(tx, {
      action: 'lease.claim',
      targetKind: 'session',
      targetId: input.sessionId,
      source: 'chat',
      detail: { holder: input.holder, harness: input.harness, epoch: lease.epoch },
    });
    return lease;
  });
}

// --- renew ------------------------------------------------------------------

export interface RenewLeaseInput {
  sessionId: Uuid;
  holder: string;
  ttlSeconds?: number;
}

/**
 * Heartbeat: extend a live lease held by this holder. Throws {@link LeaseNotRenewableError} when
 * the lease is expired or held by someone else (an expired lease must go back through
 * {@link acquireLease}). Deliberately writes NO audit row — renews are high-frequency heartbeats
 * and auditing every one would drown the log.
 */
export async function renewLease(pool: Pool, input: RenewLeaseInput): Promise<SessionLease> {
  const expiresAt = expiryFrom(input.ttlSeconds);
  return withTransaction(pool, async (tx) => {
    const lease = await store.renewLease(tx, input.sessionId, input.holder, expiresAt);
    if (lease === undefined) {
      throw new LeaseNotRenewableError(input.sessionId, input.holder);
    }
    return lease;
  });
}

// --- take over --------------------------------------------------------------

export interface TakeOverLeaseInput {
  sessionId: Uuid;
  holder: string;
  harness: Harness;
  ttlSeconds?: number;
  reason?: string;
}

/**
 * Forced transfer ("grab the wheel"): unconditionally seize the token, bumping the fencing epoch
 * so the previous holder is fenced out at its next turn-lane append. The store's takeOverLease
 * always succeeds, so this never throws. The seizure is security-relevant, so it is always
 * audited — including the previous holder and the caller's reason.
 */
export async function takeOverLease(pool: Pool, input: TakeOverLeaseInput): Promise<SessionLease> {
  const expiresAt = expiryFrom(input.ttlSeconds);
  return withTransaction(pool, async (tx) => {
    // Read the current holder FIRST so the audit trail records who was displaced.
    const prev = await store.getLease(tx, input.sessionId);
    const lease = await store.takeOverLease(tx, {
      sessionId: input.sessionId,
      holder: input.holder,
      harness: input.harness,
      expiresAt,
      reason: input.reason,
    });
    await appendAudit(tx, {
      action: 'lease.takeover',
      targetKind: 'session',
      targetId: input.sessionId,
      source: 'chat',
      detail: {
        holder: input.holder,
        harness: input.harness,
        epoch: lease.epoch,
        previousHolder: prev?.holder ?? null,
        reason: input.reason ?? null,
      },
    });
    return lease;
  });
}

// --- release ----------------------------------------------------------------

export interface ReleaseLeaseInput {
  sessionId: Uuid;
  holder: string;
}

/**
 * Give up the token. Only the holder can release; a no-op release by a non-holder returns false
 * and writes no audit row. A successful release is audited.
 */
export async function releaseLease(pool: Pool, input: ReleaseLeaseInput): Promise<boolean> {
  return withTransaction(pool, async (tx) => {
    const released = await store.releaseLease(tx, input.sessionId, input.holder);
    if (released) {
      await appendAudit(tx, {
        action: 'lease.release',
        targetKind: 'session',
        targetId: input.sessionId,
        source: 'chat',
        detail: { holder: input.holder },
      });
    }
    return released;
  });
}
