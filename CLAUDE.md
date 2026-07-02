# CLAUDE.md — working guide for Tars

Tars is a self-hosted, single-user **personal memory MCP server** ("Second Brain").
This file is the running, practical guide for working in the repo. Keep it current.

## Onboarding a new user

If you're asked to set Tars up end-to-end for someone (fresh clone, "get this running for
me"), follow [`docs/onboarding.md`](docs/onboarding.md) in order: server → MCP companions →
persona wiring → **one-time bootstrap scrape** → schedule Dream/Briefing → verify. Don't
skip the bootstrap step — Dream and Briefing only reconcile _new_ activity since their last
run, so a brain that never got seeded stays empty no matter how long the routines run.

## Golden rules

- **Never invent personal data.** The system ships empty. Fixtures use abstract
  placeholders (`Person:A`, `Project:X`, `Trip:T1`). Tool descriptions assume zero
  prior knowledge of the user.
- **Transport boundary.** `core` and `mcp` know nothing about HTTP / OAuth / tunnels.
  Only `server` is transport-aware. Never leak transport concerns inward.
- **No `any` in `core`** — ESLint-enforced. Strict TypeScript everywhere.
- **ESM + NodeNext.** Relative imports MUST carry `.js` extensions
  (`import { x } from './x.js'`). Cross-package imports use the bare `@tars/<pkg>`
  specifier. Use `import type` for type-only imports (`verbatimModuleSyntax`).
- **Test + commit per phase.** Green (`pnpm check`) before moving on.
- **Brain over Markdown.** Don't create handoff / recap / decision-log / summary `.md`
  files — they waste tokens and confuse future sessions. Record non-obvious decisions,
  rationale, and project state in the **brain** (Tars, via its memory tools); it's the
  single source of that memory. `DECISIONS.md` is the frozen Phase 0–8 build log — don't
  append to it. Add new `.md` only for durable, user-facing docs, and only when asked.
- **Bounded tool output** (~150k chars on claude.ai/Desktop; ~25k tokens in Claude
  Code). Prefer IDs + summaries + a follow-up fetch over big dumps.

## Layout

```
packages/core    memory engine: schema, db, store, embeddings, retrieval, memory, mirror, extraction
packages/mcp     MCP tool definitions (thin; calls into core)
packages/server  the single HTTP server (Streamable HTTP + OAuth + loopback trust)
deploy/docker    Postgres + pgvector compose
deploy/tunnel    Tailscale Funnel (default) / Cloudflare (alternative)
ops/launchd      24/7 process management on the Mac
ops/backup       pg_dump schedule + git mirror
```

## Commands

```
pnpm install
pnpm db:up | db:down | db:logs | db:psql   # Postgres dev stack
pnpm build        # tsc -b (project references)
pnpm typecheck    # unified no-emit check incl. tests (tsconfig.check.json)
pnpm lint | lint:fix
pnpm format | format:check
pnpm test | test:watch
pnpm check        # format:check + lint + typecheck + build + test (pre-commit gate)
```

## Conventions

- Internal package scope: `@tars/*`.
- Tests are co-located as `*.test.ts` and run by vitest **against source** (aliased in
  `vitest.config.ts`; no build needed to run tests).
- Build excludes test files from emit; `pnpm typecheck` covers tests via
  `tsconfig.check.json` (no-emit, with path aliases to source).
- Migrations: raw SQL via `node-pg-migrate` in `packages/core/migrations`
  (timestamp-prefixed files with `-- Up Migration` / `-- Down Migration` markers).
- `store/` = pure data access over a `Queryable`; `memory/` = transactional write ops
  (remember/link/correct/forget/define-\*) that own the transaction and the audit row.
- Store/memory tests are **real Postgres integration tests** against an `tars_test`
  database — run `pnpm db:up` first. Tests run serially (one shared test DB).
- Secrets via env only (`.env`, gitignored); see `.env.example`. Never commit secrets.
- The DB is the single source of truth; the Markdown mirror is one-way (DB → Markdown).

## Phase status

- [x] Phase 0 — Scaffold
- [x] Phase 1 — Schema + Postgres store
- [x] Phase 2 — Retrieval (keyword + graph)
- [x] Phase 3 — MCP layer + HTTP server (localhost)
- [x] Phase 4 — Local embeddings + vector retrieval
- [x] Phase 5 — OAuth + tunnel (code + tests; live tunnel/connector is a guided deploy)
- [x] Phase 6 — Mirror + export
- [x] Phase 7 — (optional) Auto fact-extraction
- [x] Phase 8 — Hardening & ops
