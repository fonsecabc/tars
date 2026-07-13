/**
 * Chronicle HTTP WRITE surface — the loopback transport that lets out-of-process harnesses
 * (voice loop, WhatsApp responder, cron scripts) open sessions, append events, and work the
 * turn-lane lease at activation time. A pure transport shim over `SessionService`: every route
 * validates the body, forwards to the bound service, and maps the ops layer's typed errors to
 * HTTP statuses — no `pg`, no transactions, no business logic (repo law: server = transport only).
 *
 * SECURITY: this router is mounted ONLY on the trusted loopback listener (same trust model as
 * the no-auth /mcp) and behind `...guards` if auth is ever attached; per-tier ACLs are a later
 * batch. bigint fields (seq/epoch) are strings passing through JSON untouched — never Number()'d.
 *
 * The orchestrator mounts this router at the app root, so the paths here are absolute. The app
 * does NOT globally parse JSON, so each route carries its own `express.json()` middleware.
 */
import express, { Router } from 'express';
import type { Request, Response } from 'express';

import { sessions } from '@tars/core';
import type { SessionService, SessionTier, Harness, EventKind } from '@tars/core';

/** Route params are typed loosely under Express 5; the `:id` segment is always a string. */
function pathId(req: Request): string {
  return String(req.params.id);
}

/** The parsed JSON body as a plain record; anything non-object collapses to `{}`. */
function bodyOf(req: Request): Record<string, unknown> {
  const body: unknown = req.body;
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

/** Read a body field that must be a string; undefined when absent or mistyped. */
function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === 'string' ? value : undefined;
}

/** Read a body field that must be a plain object; undefined when absent or mistyped. */
function recordField(
  body: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = body[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Read a body field that must be a finite number; undefined when absent or mistyped. */
function numberField(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Map the ops layer's typed errors to HTTP statuses. Anything unrecognized is rethrown so
 * Express 5's default handler turns it into a 500 (async handler rejections are caught).
 */
function handleErrors(res: Response, error: unknown): void {
  if (error instanceof sessions.SessionNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof sessions.LeaseConflictError) {
    res.status(409).json({ code: 'lease_conflict', error: error.message });
    return;
  }
  if (error instanceof sessions.StaleLeaseError) {
    res.status(409).json({ code: 'stale_lease', error: error.message });
    return;
  }
  if (error instanceof sessions.LeaseExpiredError) {
    res.status(409).json({ code: 'lease_expired', error: error.message });
    return;
  }
  if (error instanceof sessions.LeaseRequiredError) {
    res.status(409).json({ code: 'lease_required', error: error.message });
    return;
  }
  if (error instanceof sessions.LeaseNotRenewableError) {
    res.status(409).json({ code: 'lease_not_renewable', error: error.message });
    return;
  }
  throw error;
}

const LEASE_ACTIONS = ['acquire', 'renew', 'takeover', 'release'] as const;
type LeaseAction = (typeof LEASE_ACTIONS)[number];

function isLeaseAction(value: string): value is LeaseAction {
  return (LEASE_ACTIONS as readonly string[]).includes(value);
}

export function createSessionsWriteRouter(service: SessionService): Router {
  const router = Router();

  // Genesis: find-or-create the session row and log a `session_opened` marker.
  router.post('/sessions', express.json(), async (req: Request, res: Response) => {
    const body = bodyOf(req);
    const origin = stringField(body, 'origin');
    if (origin === undefined) {
      res.status(400).json({ error: 'origin is required and must be a string' });
      return;
    }
    const tier = stringField(body, 'tier');
    if (tier !== undefined && !['owner', 'trusted', 'guest'].includes(tier)) {
      res.status(400).json({ error: 'tier must be one of owner, trusted, guest' });
      return;
    }
    try {
      const opened = await service.open({
        origin: origin as Harness,
        externalRef: stringField(body, 'externalRef'),
        title: stringField(body, 'title'),
        tier: tier as SessionTier | undefined,
        metadata: recordField(body, 'metadata'),
      });
      res.status(201).json(opened);
    } catch (error) {
      handleErrors(res, error);
    }
  });

  // Append one event to a session's log (turn-lane appends are lease-gated by the ops layer).
  router.post('/sessions/:id/events', express.json(), async (req: Request, res: Response) => {
    const sessionId = pathId(req);
    const body = bodyOf(req);
    const harness = stringField(body, 'harness');
    const actor = stringField(body, 'actor');
    const kind = stringField(body, 'kind');
    if (harness === undefined || actor === undefined || kind === undefined) {
      res.status(400).json({ error: 'harness, actor, and kind are required and must be strings' });
      return;
    }
    // The ops layer appends best-effort even to unknown ids; the HTTP surface is stricter.
    const session = await service.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    try {
      const event = await service.append(
        {
          sessionId,
          harness: harness as Harness,
          actor,
          kind: kind as EventKind,
          payload: recordField(body, 'payload'),
        },
        {
          holder: stringField(body, 'holder'),
          expectedEpoch: stringField(body, 'expectedEpoch'),
        },
      );
      res.status(201).json(event);
    } catch (error) {
      handleErrors(res, error);
    }
  });

  // Turn-lane lease lifecycle: acquire / renew / takeover return the lease; release a boolean.
  router.post('/sessions/:id/lease', express.json(), async (req: Request, res: Response) => {
    const sessionId = pathId(req);
    const body = bodyOf(req);
    const action = stringField(body, 'action');
    const holder = stringField(body, 'holder');
    if (action === undefined || !isLeaseAction(action)) {
      res.status(400).json({ error: 'action must be one of acquire, renew, takeover, release' });
      return;
    }
    if (holder === undefined) {
      res.status(400).json({ error: 'holder is required and must be a string' });
      return;
    }
    const harness = stringField(body, 'harness');
    if ((action === 'acquire' || action === 'takeover') && harness === undefined) {
      res.status(400).json({ error: `harness is required for action '${action}'` });
      return;
    }
    const ttlSeconds = numberField(body, 'ttlSeconds');
    try {
      switch (action) {
        case 'acquire': {
          const lease = await service.acquireLease({
            sessionId,
            holder,
            harness: harness as Harness,
            ttlSeconds,
          });
          res.status(200).json(lease);
          return;
        }
        case 'renew': {
          const lease = await service.renewLease({ sessionId, holder, ttlSeconds });
          res.status(200).json(lease);
          return;
        }
        case 'takeover': {
          const lease = await service.takeOverLease({
            sessionId,
            holder,
            harness: harness as Harness,
            ttlSeconds,
            reason: stringField(body, 'reason'),
          });
          res.status(200).json(lease);
          return;
        }
        case 'release': {
          const released = await service.releaseLease({ sessionId, holder });
          res.status(200).json({ released });
          return;
        }
      }
    } catch (error) {
      handleErrors(res, error);
    }
  });

  return router;
}
