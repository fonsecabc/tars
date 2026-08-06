# Tars — Personal Memory MCP Server ("Second Brain")

[![Stars](https://img.shields.io/github/stars/fonsecabc/tars?style=flat&logo=github&label=stars&color=black)](https://github.com/fonsecabc/tars/stargazers)
[![License: MIT](https://img.shields.io/badge/license-MIT-black)](LICENSE)
[![Release](https://img.shields.io/github/v/release/fonsecabc/tars?style=flat&color=black)](https://github.com/fonsecabc/tars/releases/latest)

A self-hosted, single-user **memory server**: one durable knowledge base about a
person's life — people, work, projects, trips, places, events, preferences, facts —
exposed to Claude over the **Model Context Protocol (MCP)**.

The same memory is reachable and writable from **every Claude surface**: web
(claude.ai), mobile, desktop (Cowork), and Claude Code — through one HTTP server.

It ships **empty and content-free**: a generic engine + schema, populated by the
owner afterward. No names, no real data, no assumptions about whose life it is.

## Benchmarks — does the memory actually work?

Tars is measured on **[LOCOMO](https://github.com/snap-research/locomo)** (10 long
multi-session conversations, 1,986 QA), run **fully locally** — a `qwen2.5:14b` answerer and a
`qwen2.5:32b` LLM-judge, no cloud API — ingesting each turn as a verbatim, timestamped
observation and answering from `memory_recall`.

| Metric                                        | Baseline   | + dated-context fix  |
| --------------------------------------------- | ---------- | -------------------- |
| **Retrieval hit-rate** (answerable questions) | **82.9 %** | **82.9 %**           |
| Overall answer accuracy (all 1,986)           | 48.4 %     | **54.6 %** (+6.1 pp) |
| Temporal questions                            | 4.0 %      | **27.1 %** (~7×)     |
| Single-hop                                    | 54.8 %     | 59.3 %               |
| Adversarial (correctly abstains on traps)     | 90.4 %     | **92.4 %**           |

**How retrieval hit-rate is defined:** the share of questions where the gold evidence turn
appears verbatim in the context `memory_recall` assembled. It is measured over the **1,540
answerable** questions and excludes LOCOMO's 446 category-5 adversarial questions, whose gold
"evidence" is a deliberate distractor and where the correct behaviour is to abstain rather than
retrieve. Across all 1,986 questions the same figure is 81.3 %. Answer accuracy is over all
1,986.

The wedge is **retrieval**: the right memory lands in context **82.9 %** of the time. The
before/after shows the method working — we found the temporal answers were a date-_formatting_
gap (the model had the fact, not the absolute date), surfaced bracketed dates, and temporal
accuracy jumped ~7× while adversarial abstention held.

**Honest caveats.** These are small **local** models (a laptop-grade 14B answerer, a local
judge) — so treat the numbers as comparable **across Tars configurations**, not head-to-head
with vendors' GPT-4-judged leaderboard scores. Bigger answerers lift the answer accuracy; the
retrieval hit-rate is the model-independent signal.

Reproduce it yourself (needs [Ollama](https://ollama.com) + the two models pulled):

```bash
bash  packages/core/src/eval/locomo/download.sh        # fetch the dataset (gitignored)
pnpm tsx packages/core/src/eval/locomo/run-locomo.ts   # run; see that dir's README for knobs
```

### How Tars compares

Tars is a **self-hosted, single-user personal memory graph** — a different target than the
agent-framework and hosted-platform memory layers. Rough positioning (capabilities evolve —
verify current state before relying on any cell):

|                                         | **Tars**                  | mem0                   | Letta                  | Zep                        | basic-memory      |
| --------------------------------------- | ------------------------- | ---------------------- | ---------------------- | -------------------------- | ----------------- |
| Shape                                   | personal memory graph     | app/agent memory layer | agent runtime + memory | agent memory + temporal KG | local Markdown KB |
| Store                                   | Postgres + pgvector       | pluggable vector DBs   | Postgres               | Postgres                   | Markdown files    |
| Entities + observations + **relations** | ✅                        | partial                | agent state            | ✅ (temporal graph)        | links             |
| Ingest                                  | **verbatim, timestamped** | LLM-summarized         | agent-curated          | LLM-extracted              | you write it      |
| Runs with **no cloud LLM**              | ✅ (local Ollama)         | optional               | optional               | optional                   | ✅                |
| **MCP-native** server                   | ✅                        | adapter                | adapter                | adapter                    | ✅                |
| Published local benchmark               | ✅ (above, reproducible)  | —                      | —                      | —                          | —                 |
| License                                 | MIT                       | Apache-2.0             | Apache-2.0             | Apache-2.0                 | see project       |

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

## Install

### Let your agent do it

The setup driver is **agent-first**: hand this to Claude Code and it stands Tars up for you.
One command clones the repo and runs `tars init`, which provisions any of four components —
the **engine**, an **always-on service**, the **Claude Code MCP registration**, and a
**personalized TARS persona** — and prints a JSON summary the agent reads to continue:

```bash
# agent-driven (headless, parseable): pick components, pass a name, get JSON back
curl -fsSL https://raw.githubusercontent.com/fonsecabc/tars/main/install.sh | bash -s -- \
  --all --owner-name "Ada" --install-prompt --yes --json
```

Everything is flag-driven and non-interactive, so nothing ever hangs on a prompt:

```bash
tars init --components engine,mcp,persona --owner-name "Ada" --yes --json
tars init --status --json        # inspect current state
tars init --all --dry-run --json # preview the plan, change nothing
```

Prefer to drive it yourself? Run `./install.sh` (or `make init` / `tars init`) with no flags
and you get an interactive menu. It's idempotent — re-run any time to add a component.

### Manual (macOS)

Prefer to drive it yourself — from a fresh clone to an always-on Tars in two commands:

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

### Linux — one command (Docker)

The whole stack — Postgres, local embeddings (Ollama), and the Tars server — in a single
compose file. Nothing to install but Docker; the server auto-migrates on boot:

```bash
docker compose -f deploy/docker/docker-compose.full.yml up -d --build
claude mcp add --transport http tars http://127.0.0.1:8787/mcp
```

That's it — the brain is live and empty, reachable by Claude Code on this machine. It uses
host networking so the no-auth loopback listener stays bound to **your** `127.0.0.1` and
nowhere else. (macOS: use `make setup` — Docker Desktop lacks Linux host networking.)

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

- [`docs/how-tars-works.md`](docs/how-tars-works.md) — why this exists, how recall and Dream work, and what the LOCOMO numbers mean.
- [`docs/onboarding.md`](docs/onboarding.md) — Day-0 runbook: server → MCPs → persona → seed → routines.
- [`docs/mcps.md`](docs/mcps.md) — MCP companions (WhatsApp, Slack, Gmail, Calendar, Granola, Linear, …).
- [`docs/tars-system-prompt.md`](docs/tars-system-prompt.md) — the TARS persona + memory prompt, and how to wire it in.
- [`docs/routines/`](docs/routines/) — Bootstrap (one-time seed), Dream (nightly), Briefing (morning).
- [`skills/`](skills/) — agent skills Tars ships, starting with [`handoff`](skills/handoff/SKILL.md)
  for carrying work across a session reset, worktree, or subagent boundary.
- [`CLAUDE.md`](CLAUDE.md) — working guide & conventions for this repo.
- [`docs/routines/voice-personas.md`](docs/routines/voice-personas.md) — learn how the user
  writes per platform (Slack, email, WhatsApp, LinkedIn, Twitter/X…) and draft in their voice.
- [`DECISIONS.md`](DECISIONS.md) — log of non-obvious design choices.
- [`PRIVACY.md`](PRIVACY.md) — data handling and privacy posture.
- [`SECURITY.md`](SECURITY.md) — security model & vulnerability reporting.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — dev setup & how to contribute.

## Stars

<img width="3664" height="2808" alt="star-history-202686" src="https://github.com/user-attachments/assets/99ee27d7-0ae9-4f82-afc3-ab49f091729a" />

## Contributors

<a href="https://github.com/fonsecabc">
  <img src="https://avatars.githubusercontent.com/u/84057597?v=4&s=80" width="80" height="80" alt="fonsecabc" />
</a>

Built by [@fonsecabc](https://github.com/fonsecabc). Full history in the
[contributors graph](https://github.com/fonsecabc/tars/graphs/contributors). Want your face
here? Start with [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Caio Fonseca. Use it, change it, ship it — no strings.
