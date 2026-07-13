/**
 * Chronicle HTTP MESSAGING surface — the loopback transport that lets out-of-process harnesses
 * (voice loop, WhatsApp responder, cron scripts) send inter-session messages/signals and read
 * their harness inbox. A pure transport shim over `SessionService`: every route validates the
 * body, forwards to the bound service, and maps the ops layer's typed errors to HTTP statuses —
 * no `pg`, no transactions, no business logic (repo law: server = transport only).
 *
 * SECURITY: this router is mounted ONLY on the trusted loopback listener (same trust model as
 * the no-auth /mcp). Delivered message bodies are DATA from a named sender, never instructions
 * to the receiving agent — consumers surface them, they don't execute them. bigint fields
 * (seq/epoch) are strings passing through JSON untouched — never Number()'d.
 *
 * The orchestrator mounts this router at the app root, so the paths here are absolute. The app
 * does NOT globally parse JSON, so each POST route carries its own `express.json()` middleware.
 */
import express, { Router } from 'express';
import type { Request, Response } from 'express';

import { sessions } from '@tars/core';
import type { SessionService } from '@tars/core';

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

/** Read a query param that must be a string; undefined when absent or mistyped. */
function queryString(req: Request, key: string): string | undefined {
  const value: unknown = req.query[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Map the ops layer's TYPED errors to HTTP statuses; anything else is rethrown (Express 5
 * turns it into a 500). Input problems the ops layer reports as plain `Error` (bad '@'
 * address, empty body, unknown signal) are pre-validated at the route level instead, so an
 * unexpected plain `Error` here (e.g. a pg connection failure) surfaces as a 500 — never a
 * misleading 400 that a harness client would treat as its own fault. Matches the
 * write-routes sibling.
 */
function handleErrors(res: Response, error: unknown): void {
  if (error instanceof sessions.SessionNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof sessions.HopCountExceededError) {
    res.status(409).json({ code: 'hop_count_exceeded', error: error.message });
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

/** Route-level check for '@harness' addresses; concrete session ids pass through untouched. */
function invalidAddress(to: string): string | undefined {
  if (to.startsWith('@') && !sessions.isHarness(to.slice(1))) {
    return `unknown address '${to}' (valid: ${sessions.HARNESSES.map((h) => `@${h}`).join(', ')})`;
  }
  return undefined;
}

/** Runtime guard for signal verbs arriving from transport. */
function isSignalKind(value: string): value is sessions.SignalKind {
  return (sessions.SIGNAL_KINDS as readonly string[]).includes(value);
}

export function createSessionsMessageRouter(service: SessionService): Router {
  const router = Router();

  // Send an inter-session message: append a `message` event to the target's log (its mailbox).
  // `to` is a session uuid or a '@harness' address — addresses are validated here (the ops
  // layer would reject them too, but as a plain Error, which this surface treats as a 500).
  router.post('/messages', express.json(), async (req: Request, res: Response) => {
    const body = bodyOf(req);
    const to = stringField(body, 'to');
    if (to === undefined) {
      res.status(400).json({ error: 'to is required and must be a string' });
      return;
    }
    const fromHarness = stringField(body, 'fromHarness');
    if (fromHarness === undefined || !sessions.isHarness(fromHarness)) {
      res.status(400).json({
        error: `fromHarness is required and must be one of ${sessions.HARNESSES.join(', ')}`,
      });
      return;
    }
    const messageBody = stringField(body, 'body');
    if (messageBody === undefined || messageBody.trim() === '') {
      res.status(400).json({ error: 'body is required and must be a non-empty string' });
      return;
    }
    const addressError = invalidAddress(to);
    if (addressError !== undefined) {
      res.status(400).json({ error: addressError });
      return;
    }
    try {
      const event = await service.sendMessage({
        to,
        fromHarness,
        fromSession: stringField(body, 'fromSession'),
        body: messageBody,
        replyTo: stringField(body, 'replyTo'),
        hopCount: numberField(body, 'hopCount'),
      });
      res.status(201).json(event);
    } catch (error) {
      handleErrors(res, error);
    }
  });

  // Send a control signal (ping/pause/cancel/wake): append a `signal` event to the target's log.
  router.post('/signals', express.json(), async (req: Request, res: Response) => {
    const body = bodyOf(req);
    const to = stringField(body, 'to');
    if (to === undefined) {
      res.status(400).json({ error: 'to is required and must be a string' });
      return;
    }
    const signal = stringField(body, 'signal');
    if (signal === undefined || !isSignalKind(signal)) {
      res.status(400).json({
        error: `signal is required and must be one of ${sessions.SIGNAL_KINDS.join(', ')}`,
      });
      return;
    }
    const fromHarness = stringField(body, 'fromHarness');
    if (fromHarness === undefined || !sessions.isHarness(fromHarness)) {
      res.status(400).json({
        error: `fromHarness is required and must be one of ${sessions.HARNESSES.join(', ')}`,
      });
      return;
    }
    const addressError = invalidAddress(to);
    if (addressError !== undefined) {
      res.status(400).json({ error: addressError });
      return;
    }
    try {
      const event = await service.sendSignal({
        to,
        signal,
        fromHarness,
        payload: recordField(body, 'payload'),
      });
      res.status(201).json(event);
    } catch (error) {
      handleErrors(res, error);
    }
  });

  // Read a harness's pending inter-session messages (its well-known inbox session), oldest
  // first. `afterSeq` is a bigint-as-string cursor and stays a string end-to-end.
  router.get('/harnesses/:harness/inbox', async (req: Request, res: Response) => {
    const harness = String(req.params.harness);
    if (!sessions.isHarness(harness)) {
      res.status(400).json({
        error: `unknown harness '${harness}' (valid harnesses: ${sessions.HARNESSES.join(', ')})`,
      });
      return;
    }
    const limitRaw = queryString(req, 'limit');
    const limit =
      limitRaw !== undefined && limitRaw !== '' && Number.isFinite(Number(limitRaw))
        ? Number(limitRaw)
        : undefined;
    try {
      const inbox = await service.listInbox(harness, {
        afterSeq: queryString(req, 'afterSeq'),
        limit,
      });
      res.status(200).json(inbox);
    } catch (error) {
      handleErrors(res, error);
    }
  });

  return router;
}
