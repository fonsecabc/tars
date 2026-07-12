/**
 * Chronicle HTTP read + live-watch surface. A pure transport shim over `SessionService`:
 * every route just forwards to the bound service — no `pg`, no transactions, no business
 * logic (repo law: server = transport only). Writes over HTTP are intentionally out of
 * scope; adapters call the service in-process and tier-gated write endpoints land later.
 *
 * The orchestrator mounts this router at the app root, so the paths here are absolute.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';

import type { SessionService, SessionStatus, SessionTier, Harness } from '@tars/core';

/** SSE tail cadence: re-poll for new events, and emit a keepalive comment. */
const PUMP_INTERVAL_MS = 1000;
const HEARTBEAT_INTERVAL_MS = 15_000;

/** Read a query param that may arrive as string | string[] | undefined as a single string. */
function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Route params are typed loosely under Express 5; the `:id` segment is always a string. */
function pathId(req: Request): string {
  return String(req.params.id);
}

/** Parse a numeric query param; undefined when absent or not a finite number. */
function numberParam(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function createSessionsRouter(service: SessionService): Router {
  const router = Router();

  // List sessions with optional filters. Every param is optional and forwarded as-is.
  router.get('/sessions', async (req: Request, res: Response) => {
    const sessions = await service.listSessions({
      status: stringParam(req.query.status) as SessionStatus | undefined,
      origin: stringParam(req.query.origin) as Harness | undefined,
      tier: stringParam(req.query.tier) as SessionTier | undefined,
      limit: numberParam(req.query.limit),
    });
    res.json(sessions);
  });

  // Fetch a single session, or 404 when unknown.
  router.get('/sessions/:id', async (req: Request, res: Response) => {
    const session = await service.getSession(pathId(req));
    if (!session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    res.json(session);
  });

  // Replay: events for a session after an optional seq cursor.
  router.get('/sessions/:id/events', async (req: Request, res: Response) => {
    const sessionId = pathId(req);
    const session = await service.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    const events = await service.listEvents(sessionId, {
      afterSeq: stringParam(req.query.afterSeq),
      limit: numberParam(req.query.limit),
    });
    res.json(events);
  });

  // Server-Sent Events live tail: replay since the cursor, then stream new events.
  router.get('/sessions/:id/tail', async (req: Request, res: Response) => {
    const sessionId = pathId(req);
    const session = await service.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }

    // Reconnecting SSE clients resend their last seen id via Last-Event-ID; fall back to the
    // ?afterSeq query, then to '0' (bigint cursor stays a string — never Number() it).
    const lastEventId = req.headers['last-event-id'];
    const cursorStart =
      (typeof lastEventId === 'string' ? lastEventId : undefined) ??
      stringParam(req.query.afterSeq) ??
      '0';
    let cursor = cursorStart;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(': connected\n\n');

    let inFlight = false;
    let closed = false;

    const stop = (): void => {
      closed = true;
      clearInterval(pumpTimer);
      clearInterval(heartbeatTimer);
      res.end();
    };

    const pump = async (): Promise<void> => {
      if (inFlight || closed) return;
      inFlight = true;
      try {
        const events = await service.listEvents(sessionId, { afterSeq: cursor });
        // The client may have disconnected during the await — don't write to an ended response.
        if (closed) return;
        for (const event of events) {
          res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
          cursor = event.seq;
        }
      } catch {
        // A read failure shouldn't crash the process; tear the stream down cleanly.
        stop();
      } finally {
        inFlight = false;
      }
    };

    const pumpTimer = setInterval(() => void pump(), PUMP_INTERVAL_MS);
    const heartbeatTimer = setInterval(() => {
      res.write(': keepalive\n\n');
    }, HEARTBEAT_INTERVAL_MS);

    req.on('close', stop);

    // Immediate replay since the cursor, before the polling interval kicks in.
    await pump();
  });

  return router;
}
