# Security Policy

Tars is a **single-user, self-hosted personal memory server**. It is designed to
hold deeply private data (a graph of the owner's life, work, and relationships).
Treat any deployment as security-sensitive.

## Reporting a vulnerability

**Do not open a public issue for security problems.**

Report privately via GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
(repo **Security → Report a vulnerability**). Please include:

- a description and impact assessment,
- reproduction steps or a proof of concept,
- affected version / commit.

You'll get an acknowledgement as soon as possible. Coordinated disclosure is
appreciated — give a reasonable window to ship a fix before going public.

## Deployment security model

Tars exposes **two ingress paths** from one process:

| Path     | Bind               | Auth               | Intended reach            |
| -------- | ------------------ | ------------------ | ------------------------- |
| Loopback | `127.0.0.1:$PORT`  | **none** (trusted) | Claude Code on this host  |
| Public   | OAuth 2.1 listener | OAuth 2.1 + PKCE   | chat Claude, via a tunnel |

Key properties you must understand before exposing the public path:

- **The loopback listener has no authentication.** Anything that can reach it has
  full read/write of the brain. It is hard-bound to `127.0.0.1`. Do **not** put it
  behind a reverse proxy or bind it to a routable address.
- **The single-owner OAuth flow auto-approves `/authorize` and accepts open Dynamic
  Client Registration.** With this model, _anyone who can reach the public URL can
  obtain a token and read/write the brain_ — PKCE does not change that, because the
  client controls the whole flow. Therefore:
  - **Prefer Tailscale Serve (tailnet-only) over Funnel (public internet).** The
    default documented path is tailnet-only.
  - The public OAuth listener will **refuse to start** unless you explicitly
    acknowledge this model by setting `TARS_PUBLIC_AUTH_ACK=1`. Only set it if the
    public URL is reachable solely by you (e.g. tailnet-restricted) or you have added
    your own owner-authentication gate.
- **Keep everything local for maximum privacy.** With `EMBEDDING_PROVIDER=null` or
  `ollama`, no data leaves the machine. The hosted embedding option sends observation
  text to a third party — opt in knowingly.

See [`PRIVACY.md`](PRIVACY.md) and [`deploy/tunnel/`](deploy/tunnel/) for details.

## Supported versions

This is a personal project under active development. Only the `main` branch is
supported; please report against the latest commit.
