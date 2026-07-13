-- Up Migration

-- Chronicle — cross-harness shared sessions (event-sourced).
--
-- session_events is the SOURCE OF TRUTH: an append-only log. `sessions` and
-- `session_leases` are rebuildable OPERATIONAL projections / live state derived off the
-- log; NEITHER is FK-linked to it, so the projection can be TRUNCATEd and replayed freely
-- (and a live lease is never nuked by a projection rebuild). session_events.session_id is a
-- logical grouping key, not a foreign key into the derived `sessions` read-model.

-- Event log -------------------------------------------------------------------

CREATE TABLE session_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Global monotonic total order. Doubles as the Last-Event-ID / SSE tail cursor AND the
  -- per-session replay cursor (WHERE session_id = ? AND seq > cursor). One IDENTITY column
  -- sidesteps message-lane append collisions: concurrent appends by different harnesses each
  -- get a distinct increasing seq, so the message lane is "ordered by Postgres append" with
  -- no per-session counter to contend on.
  seq        bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  session_id uuid NOT NULL,
  ts         timestamptz NOT NULL DEFAULT now(),
  -- Producing harness (voice / whatsapp / cron / cc-shadow / slack). Plain text, no CHECK:
  -- adapters are code-known but the vocabulary is meant to grow without a migration.
  harness    text NOT NULL,
  -- Who acted: 'user' | 'assistant' | 'tool' | 'system', or a session/harness id for messages.
  actor      text NOT NULL,
  -- The EventKind discriminant. CHECK mirrors the frozen union in sessions/types.ts (same
  -- precedent as observations.source): both lanes are complete at WU-0, so adding a kind is a
  -- deliberate contract change, not an incidental one.
  kind       text NOT NULL CHECK (kind IN (
               'session_opened', 'session_closed', 'turn_started', 'turn_message',
               'turn_completed', 'tool_call', 'tool_result', 'checkpoint',
               'message', 'signal')),
  payload    jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX session_events_session_seq_idx ON session_events (session_id, seq);
CREATE INDEX session_events_kind_idx        ON session_events (kind);
CREATE INDEX session_events_ts_idx          ON session_events (ts);

-- Session projection ----------------------------------------------------------
-- Fast operational read-model (list active sessions, last activity). Rebuildable by
-- replaying session_opened/… events. Distinct from the brain-graph Session entities the
-- graph projector (Batch 3) mints — this is the relational fast path.

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin       text NOT NULL,
  external_ref text,
  title        text,
  status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'idle', 'closed', 'archived')),
  -- Trust tier gates watch/resume ACLs (owner|trusted|guest; 'blocked' never gets a session).
  tier         text NOT NULL DEFAULT 'owner'
                 CHECK (tier IN ('owner', 'trusted', 'guest')),
  -- Watermark: seq of the latest event folded into this projection.
  last_seq     bigint,
  metadata     jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Find-or-create by harness-native identity (CC sessionId, cron task id, the well-known
-- per-harness 'inbox', …). Partial unique so multiple NULL external_refs coexist.
CREATE UNIQUE INDEX sessions_origin_extref_idx
  ON sessions (origin, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX sessions_status_idx ON sessions (status);

-- Write leases ----------------------------------------------------------------
-- One active lease row per session (single-writer turn lane). Take-over transfers the token;
-- the message lane is NOT lease-gated.

CREATE TABLE session_leases (
  session_id  uuid PRIMARY KEY,
  holder      text NOT NULL,
  harness     text NOT NULL,
  -- Fencing token: bumped on every take-over so a stale (paused-then-resumed) holder's next
  -- turn-lane append is rejected. This is the answer to "what happens to an in-flight tool
  -- call on mid-turn take-over" — the old writer is fenced out at its next append.
  epoch       bigint NOT NULL DEFAULT 1,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  renewed_at  timestamptz NOT NULL DEFAULT now(),
  -- TTL: a lease past expires_at is cooperatively takeable by another harness.
  expires_at  timestamptz NOT NULL
);

CREATE INDEX session_leases_expires_idx ON session_leases (expires_at);

-- Down Migration

DROP TABLE IF EXISTS session_leases;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS session_events;
