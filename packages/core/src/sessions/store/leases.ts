import type { Queryable } from '../../db/pool.js';
import type { Uuid } from '../../schema/common.js';
import { affected, maybeOne, one } from '../../store/util.js';
import type { ClaimLeaseInput, Harness, SessionLease, TakeOverInput } from '../types.js';

type SessionLeaseRow = {
  session_id: string;
  holder: string;
  harness: string;
  /** bigint — surfaces as a string from node-pg; never coerce to number. */
  epoch: string;
  acquired_at: Date;
  renewed_at: Date;
  expires_at: Date;
};

const COLUMNS = 'session_id, holder, harness, epoch, acquired_at, renewed_at, expires_at';

function mapSessionLease(r: SessionLeaseRow): SessionLease {
  return {
    sessionId: r.session_id,
    holder: r.holder,
    // The DB column is plain text; the vocabulary is adapter-controlled, so a
    // straight assertion onto the contract union is the accepted mapping here.
    harness: r.harness as Harness,
    epoch: r.epoch,
    acquiredAt: r.acquired_at,
    renewedAt: r.renewed_at,
    expiresAt: r.expires_at,
  };
}

/**
 * Read the lease row for a session, or undefined if none exists. The returned lease may
 * already be expired — callers check `expiresAt` themselves; this does not filter.
 */
export async function getLease(q: Queryable, sessionId: Uuid): Promise<SessionLease | undefined> {
  const res = await q.query<SessionLeaseRow>(
    `SELECT ${COLUMNS} FROM session_leases WHERE session_id = $1`,
    [sessionId],
  );
  const row = maybeOne(res);
  return row ? mapSessionLease(row) : undefined;
}

/**
 * Cooperative claim: succeeds iff the lease is free, expired, or already held by this
 * holder. One atomic upsert — no read-then-write. The epoch bumps IFF the holder changes
 * (fencing tracks writer identity); a same-holder re-claim keeps epoch and acquired_at and
 * just refreshes the expiry. Resolves undefined when another holder still holds a live lease.
 */
export async function claimLease(
  q: Queryable,
  input: ClaimLeaseInput,
): Promise<SessionLease | undefined> {
  const res = await q.query<SessionLeaseRow>(
    `INSERT INTO session_leases (session_id, holder, harness, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (session_id) DO UPDATE SET
       holder      = EXCLUDED.holder,
       harness     = EXCLUDED.harness,
       renewed_at  = now(),
       expires_at  = EXCLUDED.expires_at,
       acquired_at = CASE WHEN session_leases.holder = EXCLUDED.holder
                          THEN session_leases.acquired_at ELSE now() END,
       epoch       = CASE WHEN session_leases.holder = EXCLUDED.holder
                          THEN session_leases.epoch ELSE session_leases.epoch + 1 END
     WHERE session_leases.expires_at <= now() OR session_leases.holder = EXCLUDED.holder
     RETURNING ${COLUMNS}`,
    [input.sessionId, input.holder, input.harness, input.expiresAt],
  );
  const row = maybeOne(res);
  return row ? mapSessionLease(row) : undefined;
}

/**
 * Renew a LIVE lease held by this holder, extending its expiry. An expired lease cannot be
 * renewed — it must go back through claimLease. Resolves undefined when not renewable.
 */
export async function renewLease(
  q: Queryable,
  sessionId: Uuid,
  holder: string,
  expiresAt: Date,
): Promise<SessionLease | undefined> {
  const res = await q.query<SessionLeaseRow>(
    `UPDATE session_leases SET renewed_at = now(), expires_at = $3
     WHERE session_id = $1 AND holder = $2 AND expires_at > now()
     RETURNING ${COLUMNS}`,
    [sessionId, holder, expiresAt],
  );
  const row = maybeOne(res);
  return row ? mapSessionLease(row) : undefined;
}

/**
 * Forced transfer ("grab the wheel"): upsert unconditionally. An existing row ALWAYS gets
 * its epoch bumped — even for the same holder, a takeover declares a new writing era — so a
 * stale writer is fenced out at its next turn-lane append. A fresh row starts at epoch 1.
 *
 * `input.reason` is accepted per the contract but intentionally NOT stored here: the ops
 * layer records it in the event log + audit trail; this store row only carries live state.
 */
export async function takeOverLease(q: Queryable, input: TakeOverInput): Promise<SessionLease> {
  const res = await q.query<SessionLeaseRow>(
    `INSERT INTO session_leases (session_id, holder, harness, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (session_id) DO UPDATE SET
       holder      = EXCLUDED.holder,
       harness     = EXCLUDED.harness,
       epoch       = session_leases.epoch + 1,
       acquired_at = now(),
       renewed_at  = now(),
       expires_at  = EXCLUDED.expires_at
     RETURNING ${COLUMNS}`,
    [input.sessionId, input.holder, input.harness, input.expiresAt],
  );
  return mapSessionLease(one(res));
}

/**
 * Release a lease — only its holder can. Releasing an expired-but-still-yours lease is
 * fine. Returns whether a row was actually deleted.
 */
export async function releaseLease(
  q: Queryable,
  sessionId: Uuid,
  holder: string,
): Promise<boolean> {
  const res = await q.query('DELETE FROM session_leases WHERE session_id = $1 AND holder = $2', [
    sessionId,
    holder,
  ]);
  return affected(res);
}
