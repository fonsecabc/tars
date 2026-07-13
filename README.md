# Tars — Personal Memory MCP Server ("Second Brain")

A self-hosted, single-user **memory server**: one durable knowledge base about a
person's life — people, work, projects, trips, places, events, preferences, facts —
exposed to Claude over the **Model Context Protocol (MCP)**.

The same memory is reachable and writable from **every Claude surface**: web
(claude.ai), mobile, desktop (Cowork), and Claude Code — through one HTTP server.

It ships **empty and content-free**: a generic engine + schema, populated by the
owner afterward. No names, no real data, no assumptions about whose life it is.

## Status

Built in phases (see [`DECISIONS.md`](DECISIONS.md)).

- [x] **Phase 0** — Scaffold
- [x] **Phase 1** — Schema + Postgres store
- [x] **Phase 2** — Retrieval (keyword + graph)
- [x] **Phase 3** — MCP layer + HTTP server (localhost)
- [x] **Phase 4** — Local embeddings + vector retrieval
- [x] **Phase 5** — OAuth + tunnel (code + tests; live deploy steps in `deploy/tunnel/`)
- [x] **Phase 6** — Mirror + export
- [x] **Phase 7** — (optional) Auto fact-extraction
- [x] **Phase 8** — Hardening & ops

## Architecture

```
packages/
  core/     ← all memory logic. Transport-agnostic. No HTTP/OAuth/tunnel awareness.
  mcp/      ← MCP tool definitions (thin; call into core).
  server/   ← the single HTTP server: Streamable HTTP + OAuth/DCR + loopback trust.
deploy/
  docker/   ← docker-compose: Postgres (pgvector).
  tunnel/   ← Tailscale Serve (default, tailnet-only) / Funnel / Cloudflare.
ops/
  launchd/  ← keep server + tunnel running 24/7 on the Mac.
  backup/   ← pg_dump schedule + git mirror = two independent backups.
```

**Design rule:** `core` and `mcp` know nothing about HTTP, OAuth, tunnels, or
deployment. `server` is the only transport-aware package.

## Install (macOS)

From a fresh clone to an always-on Tars in two commands:

```bash
git clone https://github.com/fonsecabc/tars.git && cd tars
make setup            # install prereqs, configure .env, build, start Postgres
make install-service  # run Tars 24/7 under launchd
make doctor           # verify everything is green
```

> **Tars ships EMPTY.** No names, no real data — just the engine and schema. Fixtures use
> abstract placeholders (`Person:A`, `Project:X`). You populate it afterward.

> **New here?** [`docs/onboarding.md`](docs/onboarding.md) is the full first-time runbook —
> server, MCPs, the TARS persona, seeding the brain, and turning on the nightly/morning
> routines, in order.

`make setup` starts by **assessing your Mac** (RAM/chip) and asking how you want TARS to
remember — a one-question choice between two profiles:

- **Simple** (default, recommended) — smart brain + memory graph, **no local AI model**.
  Lightest install, great on a laptop, best for non-technical users. Sets
  `EMBEDDING_PROVIDER=null` (keyword + graph recall; your assistant does the semantic
  reasoning on top).
- **Full** — also installs Ollama and pulls `nomic-embed-text` (the 768-dim embedding model
  the schema expects) for fuzzy semantic search and the voice stack. Wants 16GB+ RAM and an
  always-on Mac. Sets `EMBEDDING_PROVIDER=ollama`.

Set `TARS_PROFILE=simple` (or `full`) to answer ahead of time and run unattended. Otherwise
`make setup` is idempotent (safe to re-run) and **detects-or-installs** the rest via Homebrew:
Node 20+ (24 recommended, pinned in `.nvmrc`), pnpm (corepack), and Colima + the Docker CLI +
Compose. It starts Colima, generates a real `POSTGRES_PASSWORD` into `.env` +
`deploy/docker/.env` (an **existing** data volume keeps its password so your brain is never
locked out), installs deps, builds, and brings up Postgres. The only manual prerequisite is
[Homebrew](https://brew.sh).

### Make targets

| Command                     | What it does                                                     |
| --------------------------- | ---------------------------------------------------------------- |
| `make setup`                | One-command install / re-provision (idempotent)                  |
| `make install-service`      | Generate + bootstrap the launchd service (always-on)             |
| `make uninstall-service`    | Stop and remove the launchd service                              |
| `make start｜stop｜restart` | Server lifecycle via launchd                                     |
| `make logs`                 | Tail the server logs                                             |
| `make doctor`               | Health-check the whole stack, with fixes                         |
| `make tunnel`               | Expose the OAuth listener for chat Claude (see `deploy/tunnel/`) |
| `make check` / `make test`  | Run the green gate / the test suite                              |

The launchd service runs [`ops/launchd/tars-server-run.sh`](ops/launchd/tars-server-run.sh),
which boots Colima → Postgres → the server in order, so the whole stack returns on
login/reboot. Config/secrets come from the repo-root `.env` (gitignored).

> The `make` flow above (Homebrew / Colima / launchd / Tailscale) is the **macOS
> production deploy**. For development on any OS, use the platform-neutral path below.

### Linux / development (any OS)

The core is platform-neutral — CI builds and tests it on Linux. To run the suite or
hack on Tars without the macOS tooling, you need **Node 20+** (24 recommended), **pnpm**
(via corepack), and **Docker** for Postgres:

```bash
pnpm install
pnpm db:up          # start Postgres (pgvector) in Docker
pnpm build
pnpm db:migrate     # apply migrations (core schema + OAuth tables)
pnpm test           # full suite (real-Postgres integration tests)
pnpm start          # run the server (supervise with systemd for always-on)
```

Then connect Claude Code to the loopback listener:

```bash
claude mcp add --transport http tars http://localhost:8787/mcp
```

Windows is supported via WSL2 (use the Linux path inside the WSL environment).

### Connecting

**Claude Code (this Mac)** — loopback, no auth:

```bash
claude mcp add --transport http tars http://localhost:8787/mcp
```

**Chat Claude (web / desktop / mobile)** — needs an internet-reachable connector.

> ⚠️ **Read this first.** Tars's single-owner OAuth flow **auto-approves** `/authorize`
> and accepts open client registration: _anyone who can reach the public URL can obtain a
> token and read/write your brain._ So the default is **Tailscale Serve (tailnet-only)** —
> reachable only by your own devices. The public-internet **Funnel** path requires you to
> set `TARS_PUBLIC_AUTH_ACK=1` to acknowledge this model. See [`SECURITY.md`](SECURITY.md).

Install Tailscale, `tailscale up`, then expose the OAuth listener on your tailnet and add
`https://<machine>.<tailnet>.ts.net/mcp` on claude.ai → **Settings → Connectors → Add
custom connector** (leave the secret blank). Paste
[`docs/tars-system-prompt.md`](docs/tars-system-prompt.md) into the project / custom
instructions. Full steps (Serve, Funnel, Cloudflare): [`deploy/tunnel/`](deploy/tunnel/).

Tars exposes **13 memory tools**: remember, recall, link, get_entity, timeline, correct,
forget, list_entities, list_types, define_type, list_predicates, export, audit.

### MCP companions (optional)

Tars is the memory; it gets more useful when the assistant can also read your world
(messages, calendar, meetings, mail) and act. Copy [`.mcp.json.example`](.mcp.json.example)
to `.mcp.json` (gitignored — it holds machine paths + a bridge token) and keep the servers
you want. These are the ones the [routines](docs/routines/) read from and report through —
notably **two WhatsApp accounts** doing opposite jobs (read from yours, get pinged by
Tars's own line). Full setup, including the claude.ai OAuth connectors (Gmail, Calendar,
Slack, Granola, Linear): [`docs/mcps.md`](docs/mcps.md). All optional — Tars works alone.

### Useful pnpm scripts

| Command                                          | What it does                                              |
| ------------------------------------------------ | --------------------------------------------------------- |
| `pnpm build`                                     | `tsc -b` across all packages (project references)         |
| `pnpm start`                                     | Run the server (reads repo-root `.env`)                   |
| `pnpm db:migrate`                                | Apply migrations (core schema + OAuth tables)             |
| `pnpm typecheck`                                 | unified no-emit typecheck incl. tests                     |
| `pnpm test` / `pnpm test:watch`                  | run vitest                                                |
| `pnpm lint` / `pnpm lint:fix`                    | ESLint                                                    |
| `pnpm format` / `pnpm format:check`              | Prettier                                                  |
| `pnpm db:up` / `db:down` / `db:logs` / `db:psql` | Postgres dev stack                                        |
| `pnpm check`                                     | the green gate (format + lint + typecheck + build + test) |

- **Backups:** `pg_dump` schedule + git mirror — see [`ops/backup/`](ops/backup/).

## Privacy

Default configuration is **fully local on the Mac** — Postgres on the box + local
Ollama embeddings — so nothing leaves the machine. See [`PRIVACY.md`](PRIVACY.md) for
exactly what data lives where under each configuration.

## Docs

- [`docs/onboarding.md`](docs/onboarding.md) — Day-0 runbook: server → MCPs → persona → seed → routines.
- [`docs/mcps.md`](docs/mcps.md) — MCP companions (WhatsApp, Slack, Gmail, Calendar, Granola, Linear, …).
- [`docs/tars-system-prompt.md`](docs/tars-system-prompt.md) — the TARS persona + memory prompt, and how to wire it in.
- [`docs/routines/`](docs/routines/) — Bootstrap (one-time seed), Dream (nightly), Briefing (morning).
- [`CLAUDE.md`](CLAUDE.md) — working guide & conventions for this repo.
- [`docs/routines/voice-personas.md`](docs/routines/voice-personas.md) — learn how the user
  writes per platform (Slack, email, WhatsApp, LinkedIn, Twitter/X…) and draft in their voice.
- [`DECISIONS.md`](DECISIONS.md) — log of non-obvious design choices.
- [`PRIVACY.md`](PRIVACY.md) — data handling and privacy posture.
- [`SECURITY.md`](SECURITY.md) — security model & vulnerability reporting.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — dev setup & how to contribute.

## License

[MIT](LICENSE) © Caio Fonseca
