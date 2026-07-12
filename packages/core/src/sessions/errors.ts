/**
 * Chronicle typed errors — the shared failure vocabulary for the ops layer (append + lease).
 * Orchestrator-owned: both ops builders import from here so their thrown types line up (and so
 * Batch 3's server can map each to an HTTP status). All extend the engine's `TarsError` base.
 */
import { NotFoundError, TarsError } from '../errors.js';

/** A session id has no projection row. */
export class SessionNotFoundError extends NotFoundError {
  constructor(id: string) {
    super('session', id);
  }
}

/**
 * A lease-gated (turn-lane) append was attempted without presenting a held lease — either no
 * lease exists for the session or the caller supplied no holder.
 */
export class LeaseRequiredError extends TarsError {
  constructor(readonly sessionId: string) {
    super(`turn-lane write to session ${sessionId} requires holding the lease`);
  }
}

/** The lease exists but has expired; the caller must re-acquire or take over before writing. */
export class LeaseExpiredError extends TarsError {
  constructor(readonly sessionId: string) {
    super(`lease for session ${sessionId} has expired; re-acquire or take over`);
  }
}

/** The live lease is held by a different writer. */
export class LeaseConflictError extends TarsError {
  constructor(
    readonly sessionId: string,
    readonly heldBy: string,
    readonly requestedBy: string,
  ) {
    super(`lease for session ${sessionId} is held by ${heldBy}, not ${requestedBy}`);
  }
}

/**
 * Fencing rejection: the caller's expected epoch does not match the live lease epoch, i.e. a
 * take-over has happened since the caller last held the write token. The caller is stale.
 */
export class StaleLeaseError extends TarsError {
  constructor(
    readonly sessionId: string,
    readonly expectedEpoch: string,
    readonly actualEpoch: string,
  ) {
    super(
      `stale write to session ${sessionId}: expected epoch ${expectedEpoch}, live epoch is ${actualEpoch}`,
    );
  }
}

/** A renew was attempted on a lease that is expired or not held by the caller. */
export class LeaseNotRenewableError extends TarsError {
  constructor(
    readonly sessionId: string,
    readonly holder: string,
  ) {
    super(`lease for session ${sessionId} is not renewable by ${holder} (expired or not held)`);
  }
}
