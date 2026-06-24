import { randomUUID } from 'node:crypto';

import type { Memory } from '@tars/core';
import { registerMemoryTools } from '@tars/mcp';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express, { type Express, type Request, type RequestHandler, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';

export interface AuthConfig {
  /** OAuth provider implementing authorize/token/verify (e.g. TarsOAuthProvider). */
  provider: OAuthServerProvider;
  /** Canonical public base URL — the OAuth issuer and the RFC 8707 resource identifier. */
  baseUrl: URL;
  scopesSupported?: string[];
  resourceName?: string;
}

export interface AppOptions {
  memory: Memory;
  serverInfo?: { name: string; version: string };
  /**
   * When present, OAuth endpoints are mounted and `/mcp` requires a valid bearer token.
   * Omit for the trusted loopback listener used by Claude Code on the same machine.
   */
  auth?: AuthConfig;
  /**
   * Allowed `Host` header values (e.g. `['127.0.0.1:8787','localhost:8787']`). When set,
   * DNS-rebinding protection is enabled and requests with any other Host are rejected —
   * defense-in-depth for the no-auth loopback listener against a malicious web page
   * reaching `http://127.0.0.1:PORT/mcp` from the owner's browser. Omit to disable
   * (the check needs the concrete bind port, which only the entrypoint knows).
   */
  allowedHosts?: string[];
}

const DEFAULT_SERVER_INFO = { name: 'tars', version: '0.0.0' };

/**
 * Build the Express app exposing the MCP Streamable HTTP endpoint at `/mcp`.
 *
 * Uses the SDK's stateful session pattern: an `initialize` POST mints a session id and a
 * transport (bound to a fresh McpServer with the memory tools); subsequent POST/GET/DELETE
 * requests carrying that `mcp-session-id` reuse it. With `auth`, the SDK's OAuth router is
 * mounted at the root and `/mcp` is guarded by `requireBearerAuth`; without it, `/mcp` is
 * open (intended to be bound to loopback only).
 */
export function createApp(options: AppOptions): Express {
  const serverInfo = options.serverInfo ?? DEFAULT_SERVER_INFO;
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const app = express();

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  const guards: RequestHandler[] = [];
  if (options.auth) {
    const { provider, baseUrl } = options.auth;
    // Mounts /authorize, /token, /register, /revoke and the RFC 8414/9728 metadata
    // documents (advertising PKCE S256). These endpoints stay public for discovery.
    app.use(
      mcpAuthRouter({
        provider,
        issuerUrl: baseUrl,
        resourceServerUrl: baseUrl,
        ...(options.auth.scopesSupported ? { scopesSupported: options.auth.scopesSupported } : {}),
        resourceName: options.auth.resourceName ?? 'Tars personal memory',
      }),
    );
    // Throttle the public endpoint (the loopback listener stays unthrottled).
    guards.push(
      rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false }),
    );
    guards.push(
      requireBearerAuth({
        verifier: provider,
        resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(baseUrl),
      }),
    );
  }

  const handlePost: RequestHandler = async (req: Request, res: Response) => {
    const headerSession = req.headers['mcp-session-id'];
    const sessionId = typeof headerSession === 'string' ? headerSession : undefined;
    const existing = sessionId ? transports.get(sessionId) : undefined;

    let transport: StreamableHTTPServerTransport;
    if (existing) {
      transport = existing;
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        ...(options.allowedHosts && options.allowedHosts.length > 0
          ? { enableDnsRebindingProtection: true, allowedHosts: options.allowedHosts }
          : {}),
        onsessioninitialized: (id) => {
          transports.set(id, transport);
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
        }
      };
      const mcp = new McpServer(serverInfo);
      registerMemoryTools(mcp, options.memory);
      await mcp.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: missing or invalid session ID' },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  };

  const handleSessionRequest: RequestHandler = async (req: Request, res: Response) => {
    const headerSession = req.headers['mcp-session-id'];
    const sessionId = typeof headerSession === 'string' ? headerSession : undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    await transport.handleRequest(req, res);
  };

  // Bearer guard (if any) runs first; body is parsed only for the POST handler.
  app.post('/mcp', ...guards, express.json({ limit: '4mb' }), handlePost);
  app.get('/mcp', ...guards, handleSessionRequest);
  app.delete('/mcp', ...guards, handleSessionRequest);

  return app;
}
