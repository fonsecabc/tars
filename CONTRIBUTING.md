# Contributing to Tars

Thanks for your interest in improving Tars. It's a self-hosted, single-user
personal memory MCP server — small, strict, and test-driven. This guide gets you
from clone to a green build.

## Ground rules

- **Never commit personal data.** Tars ships empty and content-free. Tests and
  fixtures use abstract placeholders (`Person:A`, `Project:X`, `Trip:T1`). Tool
  descriptions assume zero prior knowledge of any user. No real names, emails,
  hostnames, or secrets — in code, tests, docs, or commit messages.
- **No secrets in git.** Configuration is env-only (`.env`, gitignored). See
  [`.env.example`](.env.example). If you think you committed a secret, rotate it.
- **Brain over Markdown.** Don't add handoff / recap / decision-log / summary `.md`
  files. `DECISIONS.md` is a frozen build log — don't append to it. Add new docs
  only when they're durable and user-facing.
- **Security issues** go through [`SECURITY.md`](SECURITY.md), not public issues.

## Architecture & boundaries

```
packages/core    memory engine: schema, db, store, embeddings, retrieval, memory, mirror, extraction
packages/mcp     MCP tool definitions (thin; calls into core)
packages/server  the single HTTP server (Streamable HTTP + OAuth + loopback trust)
```

- **Transport boundary:** `core` and `mcp` know nothing about HTTP / OAuth / tunnels.
  Only `server` is transport-aware. Never leak transport concerns inward.
- **No `any` in `core`** — ESLint-enforced. Strict TypeScript everywhere.
- **ESM + NodeNext.** Relative imports carry `.js` extensions
  (`import { x } from './x.js'`). Cross-package imports use the bare `@tars/<pkg>`
  specifier. Use `import type` for type-only imports.

## Development setup

Prerequisites: **Node 20+** (24 recommended — see [`.nvmrc`](.nvmrc)), **pnpm**
(via corepack), and **Docker** (or Colima) for Postgres + pgvector.

```bash
pnpm install
pnpm db:up         # start Postgres (pgvector) in Docker
pnpm db:migrate    # apply migrations (core schema + OAuth tables)
pnpm test          # run the suite (real-Postgres integration tests)
```

Store/memory/OAuth tests are **real Postgres integration tests** against a
`tars_test` database — `pnpm db:up` must be running first. Tests run serially
against one shared test DB.

## Before you open a PR

Run the green gate — it must pass:

```bash
pnpm check         # format:check + lint + typecheck + build + test
```

- Co-locate tests as `*.test.ts`.
- Migrations are raw SQL via `node-pg-migrate` in `packages/core/migrations`
  (timestamp-prefixed, with `-- Up Migration` / `-- Down Migration` markers).
- Keep commits focused; conventional-commit style messages are appreciated
  (`feat:`, `fix:`, `docs:`, `chore:` …).

## Opening the PR

- Describe the change and the motivation; link any related issue.
- Note any new env vars, migrations, or security-relevant behavior.
- CI runs the green gate on Node 20 and 24 against a pgvector Postgres service.

By contributing you agree your contributions are licensed under the
[MIT License](LICENSE).
