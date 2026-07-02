import 'dotenv/config';
import type { Server } from 'node:http';

import {
  backfillEmbeddings,
  createMemory,
  createPool,
  databaseUrlFromEnv,
  embeddingProviderFromEnv,
  rerankLlmFromEnv,
  runMigrations,
} from '@tars/core';

import { createApp } from './http-app.js';
import { SERVER_MIGRATIONS_DIR, SERVER_MIGRATIONS_TABLE } from './migrations.js';
import { TarsOAuthProvider } from './oauth/provider.js';

const loopbackPort = Number(process.env.PORT ?? 8787);
// The no-auth loopback listener is ALWAYS bound to a loopback address, regardless of any
// HOST override — it has no authentication, so exposing it to the network would hand the
// whole brain to anyone who can route to it.
const LOOPBACK_HOST = '127.0.0.1';
const publicPort = Number(process.env.PUBLIC_PORT ?? 8788);
// Bind address for the OAuth (public) listener. Defaults to loopback because the tunnel
// forwards to it over loopback; override only if you front it differently.
const publicHost = process.env.PUBLIC_HOST ?? '127.0.0.1';
// The stable public HTTPS hostname from the tunnel (Phase 5). When unset, the OAuth
// listener is disabled and only the trusted loopback listener runs (dev default).
const publicBaseUrl = process.env.PUBLIC_BASE_URL;

async function main(): Promise<void> {
  const databaseUrl = databaseUrlFromEnv();
  await runMigrations(databaseUrl);
  await runMigrations(databaseUrl, {
    dir: SERVER_MIGRATIONS_DIR,
    migrationsTable: SERVER_MIGRATIONS_TABLE,
  });

  const pool = createPool(databaseUrl);
  const provider = embeddingProviderFromEnv();
  // Optional LLM reranker (off unless RERANK_ENABLED). Worth enabling for the small-model
  // serving path; it adds an LLM call per recall, so it stays opt-in for the Claude Code path.
  const reranker = rerankLlmFromEnv();
  const memory = createMemory(pool, { embeddings: provider, reranker });

  // 1. Loopback listener — trusted, NO OAuth. For Claude Code on this Mac. Hard-bound to
  //    127.0.0.1 so it is unreachable from the network; the tunnel never points here.
  //    allowedHosts adds DNS-rebinding protection so a browser page can't reach it either.
  const loopbackApp = createApp({
    memory,
    allowedHosts: [`127.0.0.1:${loopbackPort}`, `localhost:${loopbackPort}`],
  });
  const loopbackServer = loopbackApp.listen(loopbackPort, LOOPBACK_HOST, () => {
    console.log(`Tars (loopback, no auth)  http://${LOOPBACK_HOST}:${loopbackPort}/mcp`);
    console.log(provider ? `Embeddings: ${provider.id}` : 'Embeddings: disabled (keyword-only)');
  });

  // 2. Public listener — OAuth-protected. A tunnel forwards public HTTPS here. Enabled
  //    only when PUBLIC_BASE_URL is set AND the operator acknowledges the single-owner
  //    auth model: /authorize auto-approves and DCR is open, so ANYONE who can reach the
  //    public URL can mint a token and read/write the brain. Prefer a tailnet-only tunnel
  //    (Tailscale Serve). Require explicit TARS_PUBLIC_AUTH_ACK=1 to start it.
  let publicServer: Server | undefined;
  if (publicBaseUrl) {
    if (process.env.TARS_PUBLIC_AUTH_ACK !== '1') {
      console.warn(
        '⚠️  Public OAuth listener NOT started: PUBLIC_BASE_URL is set but TARS_PUBLIC_AUTH_ACK is not 1.\n' +
          '    The single-owner flow auto-approves /authorize and accepts open client registration,\n' +
          '    so anyone who can reach the public URL gets full read/write of your brain.\n' +
          '    Use a tailnet-only tunnel (Tailscale Serve), or set TARS_PUBLIC_AUTH_ACK=1 to proceed.\n' +
          '    See SECURITY.md.',
      );
    } else {
      const baseUrl = new URL(publicBaseUrl);
      const oauth = new TarsOAuthProvider(pool, { resource: baseUrl });
      // No allowedHosts here: tunnels (Serve/Funnel/Cloudflare) may rewrite the Host
      // header, and this listener is already bearer-token protected.
      const publicApp = createApp({ memory, auth: { provider: oauth, baseUrl } });
      publicServer = publicApp.listen(publicPort, publicHost, () => {
        console.log(
          `Tars (public, OAuth)      http://${publicHost}:${publicPort}/mcp  (issuer ${publicBaseUrl})`,
        );
      });
    }
  } else {
    console.log('Public OAuth listener disabled (set PUBLIC_BASE_URL to enable the tunnel path).');
  }

  if (provider && process.env.TARS_BACKFILL_ON_BOOT === '1') {
    backfillEmbeddings(pool, provider)
      .then((result) => console.log(`Backfilled ${result.embedded} embedding(s)`))
      .catch((error: unknown) => console.warn('Embedding backfill failed:', error));
  }

  const shutdown = (): void => {
    loopbackServer.close(() => {
      const done = (): void => {
        void pool.end().finally(() => process.exit(0));
      };
      if (publicServer) {
        publicServer.close(done);
      } else {
        done();
      }
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  console.error('Failed to start Tars server:', error);
  process.exit(1);
});
