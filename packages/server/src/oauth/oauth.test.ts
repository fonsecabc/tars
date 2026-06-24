import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createMemory, runMigrations } from '@tars/core';
import { closeTestPool, getTestPool, testDatabaseUrl } from '@tars/core/testing';
import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../http-app.js';
import { SERVER_MIGRATIONS_DIR, SERVER_MIGRATIONS_TABLE } from '../migrations.js';
import { TarsOAuthProvider } from './provider.js';

const pool = getTestPool();
const RESOURCE = new URL('https://tars.example.test');
const REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback';

beforeAll(async () => {
  await runMigrations(testDatabaseUrl, {
    dir: SERVER_MIGRATIONS_DIR,
    migrationsTable: SERVER_MIGRATIONS_TABLE,
  });
});

beforeEach(async () => {
  await pool.query('TRUNCATE oauth_clients CASCADE');
});

afterAll(async () => {
  await closeTestPool();
});

function makeApp(): Express {
  const memory = createMemory(pool);
  const provider = new TarsOAuthProvider(pool, { resource: RESOURCE });
  return createApp({ memory, auth: { provider, baseUrl: RESOURCE } });
}

async function startApp(app: Express): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function initializeRequest(): unknown {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    },
  };
}

/** Raw GET that does NOT follow redirects (fetch opaques manual redirects in Node). */
function rawGet(urlStr: string): Promise<{ status: number; location: string | undefined }> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = http.request(
      { method: 'GET', hostname: u.hostname, port: u.port, path: `${u.pathname}${u.search}` },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0, location: res.headers.location });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('OAuth metadata & guards', () => {
  it('advertises AS metadata with PKCE S256 and DCR', async () => {
    const { baseUrl, close } = await startApp(makeApp());
    try {
      const res = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
      expect(res.status).toBe(200);
      const meta = (await res.json()) as Record<string, unknown>;
      expect(meta.code_challenge_methods_supported).toContain('S256');
      expect(meta.registration_endpoint).toBeTruthy();
      expect(meta.authorization_endpoint).toBeTruthy();
      expect(meta.token_endpoint).toBeTruthy();
    } finally {
      await close();
    }
  });

  it('advertises protected-resource metadata with an authorization server', async () => {
    const { baseUrl, close } = await startApp(makeApp());
    try {
      const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
      expect(res.status).toBe(200);
      const meta = (await res.json()) as { authorization_servers?: string[] };
      expect(meta.authorization_servers?.length ?? 0).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it('rejects /mcp without a bearer token (401 + WWW-Authenticate)', async () => {
    const { baseUrl, close } = await startApp(makeApp());
    try {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(initializeRequest()),
      });
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toMatch(/Bearer/i);
    } finally {
      await close();
    }
  });
});

describe('OAuth end-to-end (DCR → authorize → token → /mcp → refresh)', () => {
  it('completes the flow with one-time codes and refresh rotation', async () => {
    const { baseUrl, close } = await startApp(makeApp());
    try {
      const tokenEndpoint = async (params: Record<string, string>): Promise<Response> =>
        fetch(`${baseUrl}/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(params).toString(),
        });

      // 1. Dynamic client registration (public client + PKCE).
      const reg = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          redirect_uris: [REDIRECT_URI],
          token_endpoint_auth_method: 'none',
        }),
      });
      expect(reg.status).toBe(201);
      const client = (await reg.json()) as { client_id: string };
      expect(client.client_id).toBeTruthy();

      // 2. PKCE pair.
      const verifier = base64url(randomBytes(32));
      const challenge = base64url(createHash('sha256').update(verifier).digest());

      // 3. Authorize → 302 back to the redirect URI with code + state.
      const authUrl = new URL(`${baseUrl}/authorize`);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', client.client_id);
      authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
      authUrl.searchParams.set('code_challenge', challenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('state', 'xyz');
      authUrl.searchParams.set('resource', RESOURCE.href);
      const authRes = await rawGet(authUrl.href);
      expect(authRes.status).toBeGreaterThanOrEqual(300);
      expect(authRes.status).toBeLessThan(400);
      expect(authRes.location).toBeTruthy();
      const callback = new URL(authRes.location as string);
      expect(callback.searchParams.get('state')).toBe('xyz');
      const code = callback.searchParams.get('code');
      expect(code).toBeTruthy();

      // 4. Exchange the code for tokens.
      const tokRes = await tokenEndpoint({
        grant_type: 'authorization_code',
        code: code as string,
        code_verifier: verifier,
        redirect_uri: REDIRECT_URI,
        client_id: client.client_id,
      });
      expect(tokRes.status).toBe(200);
      const tokens = (await tokRes.json()) as {
        access_token: string;
        refresh_token: string;
        token_type: string;
      };
      expect(tokens.access_token).toBeTruthy();
      expect(tokens.refresh_token).toBeTruthy();
      expect(tokens.token_type).toBe('Bearer');

      // 5. The authorization code is one-time: reusing it fails (invalid_grant).
      const reuse = await tokenEndpoint({
        grant_type: 'authorization_code',
        code: code as string,
        code_verifier: verifier,
        redirect_uri: REDIRECT_URI,
        client_id: client.client_id,
      });
      expect(reuse.status).toBe(400);

      // 6. The access token authenticates an MCP initialize.
      const mcpRes = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${tokens.access_token}`,
        },
        body: JSON.stringify(initializeRequest()),
      });
      expect(mcpRes.status).toBe(200);

      // 7. Refresh rotates the tokens.
      const refRes = await tokenEndpoint({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
      });
      expect(refRes.status).toBe(200);
      const refreshed = (await refRes.json()) as { access_token: string };
      expect(refreshed.access_token).toBeTruthy();
      expect(refreshed.access_token).not.toBe(tokens.access_token);

      // 8. The old refresh token is now dead (rotation).
      const stale = await tokenEndpoint({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
      });
      expect(stale.status).toBe(400);
    } finally {
      await close();
    }
  });
});
