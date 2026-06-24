# Tunnel & cross-surface setup

Tars runs on your Mac and exposes **two ingress paths** from one process:

| Path     | Listener                                | Auth           | Used by                                          |
| -------- | --------------------------------------- | -------------- | ------------------------------------------------ |
| Loopback | `127.0.0.1:$PORT` (default 8787)        | none (trusted) | Claude Code on this Mac                          |
| Public   | `127.0.0.1:$PUBLIC_PORT` (default 8788) | OAuth 2.1      | claude.ai web / mobile / desktop, via the tunnel |

Both bind to loopback. The tunnel forwards public HTTPS to the **public** port only;
the loopback port is never exposed. Trust is decided by _which port_ a client reached
(the tunnel can't reach the no-auth port), not by source IP — important because the
tunnel forwards via loopback, so IP-based "trust 127.0.0.1" would trust the whole world.

> ⚠️ **Single-owner auth model — read before exposing the public path.** The OAuth flow
> **auto-approves `/authorize`** and accepts **open Dynamic Client Registration**. That
> means _anyone who can reach the public URL can register a client, mint a token, and
> read/write your brain_ — PKCE does not prevent this, because the client controls the
> whole flow. So:
>
> - **Default to Tailscale _Serve_ (Section B) — tailnet-only.** Only your own devices can
>   reach it. This is the recommended path.
> - **Tailscale _Funnel_ (Section C) exposes the URL to the entire internet.** Only use it
>   if you have added your own owner-authentication gate.
> - The public listener **refuses to start unless `TARS_PUBLIC_AUTH_ACK=1`** is set,
>   acknowledging this model. See [`../../SECURITY.md`](../../SECURITY.md).

---

## A. Claude Code (same Mac) — no tunnel, no OAuth

```bash
claude mcp add --transport http tars http://localhost:8787/mcp
```

That's it. Loopback is trusted.

---

## B. Tailscale Serve (default: tailnet-only, recommended)

Serve gives a stable hostname `https://<machine>.<tailnet>.ts.net` with automatic TLS
that is reachable **only by devices on your own tailnet** — not the public internet. This
is the safe default given the single-owner auth model above: your phone/laptop running
the Claude apps (signed into your tailnet) can reach it; nobody else can.

1. Install Tailscale and `tailscale up` on both this Mac and the device running Claude.
2. Start Tars with the public listener enabled (set `PUBLIC_BASE_URL` to the hostname),
   acknowledging the single-owner auth model:

   ```bash
   PUBLIC_BASE_URL=https://<machine>.<tailnet>.ts.net PUBLIC_PORT=8788 \
     TARS_PUBLIC_AUTH_ACK=1 EMBEDDING_PROVIDER=ollama pnpm --filter @tars/server start
   ```

3. Point Serve at the public listener (tailnet-only):

   ```bash
   tailscale serve --bg --https=443 http://127.0.0.1:8788
   tailscale serve status
   ```

4. Verify discovery from another tailnet device:

   ```bash
   curl https://<machine>.<tailnet>.ts.net/.well-known/oauth-protected-resource
   curl https://<machine>.<tailnet>.ts.net/.well-known/oauth-authorization-server
   ```

`PUBLIC_BASE_URL` is the OAuth issuer **and** the RFC 8707 resource identifier, so it
must exactly equal the public hostname clients reach.

---

## C. Tailscale Funnel (public internet — advanced, opt-in)

Funnel is identical to Serve but exposes the hostname to the **entire internet**. Given
the auto-approving single-owner flow, **only use Funnel if you've added your own owner
authentication** in front of `/authorize`. Otherwise anyone who discovers the URL has
full read/write of your brain.

Steps are the same as Serve, but: install the **standalone (non-App-Store)** Tailscale
build (the App Store build can't run Funnel), enable `funnel` for the node in the admin
console, and swap `serve` for `funnel`:

```bash
tailscale funnel --bg --https=443 http://127.0.0.1:8788
tailscale funnel status
```

---

## D. Add the connector on claude.ai (web / desktop / mobile)

1. claude.ai → **Settings → Connectors → Add custom connector**.
2. URL: `https://<machine>.<tailnet>.ts.net/mcp`
3. **Leave the client-secret field blank** (Tars registers a public client + PKCE via DCR).
4. Click connect → you'll be redirected through `/authorize` (auto-approved for the single
   owner) and back. Tokens are issued to claude.ai's callback
   `https://claude.ai/api/mcp/auth_callback`.
5. The same connector then works on **desktop (Cowork)** and the **mobile apps** once
   added to your account.

---

## E. Alternative: Cloudflare Tunnel (if you want a custom domain)

Needs a domain on Cloudflare DNS (~$10/yr). Trade-offs vs. Tailscale:

- Cloudflare's edge has a **100s request timeout** (raising it is Enterprise-only) and
  **buffers SSE** — fine for Tars's short request/response tool calls, but keep tools snappy.
- Run a named tunnel, persisted via launchd:
  ```bash
  cloudflared tunnel create tars
  # route DNS: cloudflared tunnel route dns tars tars.example.com
  cloudflared tunnel run --url http://127.0.0.1:8788 tars
  ```
- Set `PUBLIC_BASE_URL=https://tars.example.com`.
- If you firewall inbound, allow Anthropic's egress range `160.79.104.0/21`.

---

## Notes

- DCR makes claude.ai register a fresh client per connection — harmless, but prune
  `oauth_clients` periodically (Phase 8 adds maintenance).
- Keeping the server alive 24/7 (launchd) is covered in `ops/launchd/` (Phase 8).
