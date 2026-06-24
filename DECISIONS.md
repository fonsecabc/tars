# DECISIONS.md

Log of non-obvious design choices. Newest phase last. Format: decision — rationale.

## Phase 0 — Scaffold (2026-06-21)

1. **Monorepo via pnpm workspaces**, packages `@tars/core`, `@tars/mcp`,
   `@tars/server`. Matches the brief's package boundaries; `workspace:*` deps wire
   `mcp → core` and `server → mcp, core`.

2. **ESM + `NodeNext` module resolution**, repo-wide (`"type": "module"`). The MCP TS
   SDK requires `.js` import extensions; enforcing NodeNext everywhere keeps imports
   consistent and avoids dual-mode surprises. `verbatimModuleSyntax` + `isolatedModules`
   on for predictable emit and esbuild/vitest friendliness.

3. **TypeScript strictness:** `strict` + `noUncheckedIndexedAccess` +
   `noImplicitOverride` + `noFallthroughCasesInSwitch`.
   - Omitted `exactOptionalPropertyTypes` (high friction with pg/zod object spreads vs.
     marginal value at this stage).
   - Did **not** set TS `noUnusedLocals/Parameters`; ESLint owns unused-vars (honors the
     `_` prefix, less friction mid-edit).
   - `@typescript-eslint/no-explicit-any` is **error in `core` only** (the brief's "no
     `any` in core"); a warning-free default elsewhere.

4. **Build = `tsc -b` project references.** Root `tsconfig.json` is a solution file
   referencing each package. Test files are excluded from emit (clean `dist/`). A
   separate `tsconfig.check.json` (no-emit, path-aliased to source) typechecks
   everything **including tests** via `pnpm typecheck`.

5. **Test runner = vitest**, resolving `@tars/*` to source via `resolve.alias`, so
   tests run without a prior build. Tests co-located as `*.test.ts`.

6. **Lint/format = ESLint flat config + Prettier.** Using `typescript-eslint`
   **non-type-checked** `recommended` for Phase 0 robustness (no fiddly project-service
   wiring); type-checked rules (e.g. `no-floating-promises`) deferred to Phase 8
   hardening. `eslint-config-prettier` disables stylistic conflicts.

7. **DB image = `pgvector/pgvector:pg17`** via docker-compose, named volume
   `tars_pgdata`. Dev defaults are baked into the compose file (`:-` fallbacks) so
   `pnpm db:up` works with no `.env`.

8. **Migrations tool = `node-pg-migrate` with raw SQL** (to be implemented Phase 1).
   Chosen over an ORM (e.g. Drizzle) for transparent control over Postgres-specific
   features the brief leans on: `vector`/`pg_trgm` extensions, `tsvector` + GIN
   indexes, HNSW ANN indexes, and recursive CTEs for graph traversal.

9. **CI = GitHub Actions**, Node `20` + `24` matrix (tests the supported floor and the
   dev version), running `format:check → lint → typecheck → build → test`. A Postgres
   service will be added when integration tests land (Phase 1+).

10. **docker-compose ships only Postgres in Phase 0.** The server service is added once
    there is a server worth containerizing (Phase 8 deploy). The Mac runs the Node
    server directly under launchd; Postgres stays in Docker.

11. **esbuild build-script approval.** `pnpm-workspace.yaml` approves esbuild (a vitest
    dependency) to run its install script — needed to fetch its native binary — via two
    keys: `onlyBuiltDependencies` (canonical pnpm) and `allowBuilds` (consumed by the
    local sandbox's supply-chain wrapper). Both are harmless to vanilla pnpm.

## Phase 1 — Schema + Postgres store (2026-06-21)

1. **Migrations: `node-pg-migrate` with raw SQL files** (`-- Up Migration` /
   `-- Down Migration` markers). Imported as the named `runner` export (the package is
   CommonJS; the default import resolves to a non-callable namespace under NodeNext).
   Filenames are millisecond-timestamp-prefixed (the tool's convention; avoids its
   "can't determine timestamp" warning). `runMigrations(databaseUrl)` wraps it.

2. **Registries are FK-enforced + auto-registered.** `entities.type` →
   `entity_types(name)` and `relations.predicate` → `relation_predicates(name)`. The
   write path registers an unknown type/predicate (normalized to snake_case) before
   insert, so unknown vocabulary is **accepted**, never rejected. Nine starter entity
   types are seeded; predicates start empty.

3. **`usage_count` semantics:** maintained transactionally — `+1` on create, `-1` on
   hard-delete (floored at 0 via `GREATEST`). Soft-delete preserves the count (the row
   still exists and is recoverable).

4. **Observation correction = self-FK, not an entity relation.** Relations connect
   _entities_, so they can't link two observations. A correction (`memory.correct`)
   closes the old row's `valid_to` and inserts a new row with `corrects_id` pointing at
   it — preserving bi-temporal history ("what was true at T").

5. **`entities.search_tsv` is trigger-maintained; `observations.search_tsv` is a
   GENERATED column.** `array_to_string()` (needed to fold aliases into the FTS
   document) is only `STABLE`, which Postgres rejects in a generated column — so a
   `BEFORE INSERT OR UPDATE` trigger builds the entities vector instead. Observation
   text needs no array, so its `to_tsvector('english', …)` stays generated.

6. **`embedding vector(768)`** sized for the default local model `nomic-embed-text`. The
   HNSW (`vector_cosine_ops`) index is created now (empty is fine); embeddings are
   populated in Phase 4. A different model dimension (e.g. mxbai-embed-large = 1024)
   requires a migration.

7. **`source` is CHECK-constrained** to the documented values
   (`chat|manual|import|extraction`); extend via migration if needed. Audit `source` is
   free text (may also be `system`).

8. **Layering: `store` = pure data access; `memory` = the write path.** Store functions
   take a `Queryable` (pool or tx client) and do no auditing. The `memory` operations
   (remember/link/correct/forget/define-\*) own transactions and **guarantee** an audit
   row per action; they are what the MCP tools will call. Reads are exposed via the
   `store` namespace.

9. **Core input types are `z.input` ("drafts");** defaulted/optional fields may be
   omitted (e.g. `{ text }`), and the store applies defaults. Core works with real
   `Date`s — the zod schemas use `z.date()` (no coercion); ISO-string coercion happens
   at the MCP boundary (Phase 3). The schemas double as the MCP validation layer.

10. **Tests are real Postgres integration tests** against a dedicated `tars_test`
    database. A vitest `globalSetup` creates and migrates it; `resetDb` truncates
    between tests; `fileParallelism` is off (shared DB). Tests **require** a running
    Postgres (`pnpm db:up`); there is no skip-on-missing fallback yet (revisit in
    Phase 8). `TEST_DATABASE_URL` overrides the target (used by CI).

11. **vite-node + spaces in the project path.** The repo lives under a path containing a
    space; vite-node fails to native-import _externalized_ deps through the URL-encoded
    (`%20`) path. Fixed by inlining the Postgres deps (`pg`, `pg-*`, `pgpass`,
    `node-pg-migrate`) via `test.server.deps.inline`, which routes them through vite's
    own resolver. (Irrelevant in CI, where the checkout path has no space.)

## Phase 2 — Retrieval (keyword + graph) (2026-06-21)

1. **Hybrid recall via Reciprocal Rank Fusion.** `recall()` fuses two ranked entity
   lists today — entity name/alias FTS and observation FTS — and adds a third (vector)
   list in Phase 4. RRF combines by **rank order**, so signals on different scales
   (ts_rank, trigram similarity, vector distance) need no normalization. `k = 60`.

2. **Keyword search.** Observations: `tsvector` (`english`) via `websearch_to_tsquery`
   (forgiving of user phrasing), ranked by `ts_rank`. Entities: `tsvector` (`simple`)
   **plus** pg_trgm (`name % query`, scored by `similarity`), combined with `GREATEST`
   so fuzzy/substring name hits surface alongside exact ones.

3. **Graph expansion via recursive CTE.** Undirected walk from the top seeds, depth-
   bounded to 1–2 hops — the bound also prevents cycles (no explicit visited-set). Skips
   soft-deleted entities/relations; returns each reachable entity's minimum hop depth.
   Connecting relations are fetched in one pass as the edges whose **both** endpoints
   are in the result set.

4. **Result ordering & shape.** Keyword seeds first (by fused score), then graph-only
   entities by hop depth. Each entity carries its most relevant observations — the
   matched ones when keyword-hit, otherwise recent current observations (for name-only
   or graph-only entities). Output is bounded (`limit` entities, `observationsPerEntity`,
   both capped) per the brief's tool-output limits.

5. **Filters.** `types` (also post-filters graph-expanded entities), `predicates` (graph
   edges + returned relations), `asOf` (point-in-time validity on observations and
   relations).

6. **`recall` lives in `memory/`, building blocks in `retrieval/`** (`keyword`, `graph`,
   `rrf`, `vector` stub). The `vector` slot is a real, typed function returning `[]`
   until Phase 4, so wiring it in is additive.

## Phase 3 — MCP layer + HTTP server (localhost) (2026-06-22)

1. **MCP tools are thin adapters over a `Memory` facade.** `createMemory(pool)` exposes
   the core write/read ops; `registerMemoryTools(server, memory)` in `@tars/mcp` maps
   the 12 §7 tools onto it. The MCP package depends on the SDK contract + zod but knows
   nothing about HTTP — transport stays in `@tars/server`.

2. **Errors are returned in-band** (`{ isError: true, content: [text] }`), never thrown
   across the protocol, so the model sees a readable message (e.g. missing entity) and
   can recover, rather than getting a transport fault.

3. **Dates cross the boundary as ISO-8601 strings**, parsed to real `Date`s at the tool
   layer (invalid input → in-band error). Core stays on `Date`s; the camel/ISO mapping
   lives only in the adapters.

4. **Single `/mcp` endpoint over the SDK's Streamable HTTP transport on Express 5**,
   localhost-only this phase. No OAuth yet (Phase 5). `main.ts` loads `.env` (dotenv),
   runs migrations on boot, and serves; `createApp()` is exported for tests (which drive
   it via an in-memory transport + a real Postgres).

## Phase 4 — Local embeddings + vector retrieval (2026-06-22)

1. **`EmbeddingProvider` interface; `null` = disabled.** `embeddingProviderFromEnv` returns
   `OllamaEmbeddingProvider` (default), `OpenAIEmbeddingProvider` (hosted), or `null`
   (keyword-only, zero external calls — the "null impl"). Ollama uses the batch
   `/api/embed`; OpenAI requests `dimensions: 768` so `text-embedding-3-*` fits the column.

2. **Default model `nomic-embed-text` (768-dim)** matches the `vector(768)` column. A
   provider whose `dimensions` differ is rejected at backfill rather than failing per-row.

3. **Embeddings live on the write path, best-effort.** `createMemory(pool, { embeddings })`
   embeds new observations after `remember`/`correct` commit (outside the txn). A failure
   warns but never fails the write; `backfillEmbeddings` (idempotent, resumable — only
   NULL-embedding rows) is the durable catch-up, runnable on boot via
   `TARS_BACKFILL_ON_BOOT=1` or on demand.

4. **Vector slot fused into RRF.** `recall` takes an optional precomputed `queryEmbedding`;
   the facade computes it from the query when a provider is set (failure → keyword-only).
   `vectorSearchObservations` ranks by cosine (`<=>`, HNSW), with the same
   type/as-of filters as keyword search. Retrieval stays provider-agnostic —
   the facade owns the embedding call, keeping `retrieval/` pure.

5. **pgvector serialization is manual** (`toVectorLiteral` → `$n::vector`); no pgvector npm
   codec dependency. Tests use a deterministic offline `FakeEmbeddingProvider` (token-hash
   - pinned overrides) so the suite needs no Ollama; the real Ollama contract is verified
     separately.

## Phase 5 — OAuth + tunnel (2026-06-22)

1. **Two listeners, not per-request IP bypass.** A loopback listener (`127.0.0.1:$PORT`, no
   OAuth) serves Claude Code on the Mac; a separate public listener
   (`127.0.0.1:$PUBLIC_PORT`, OAuth-required) is what the tunnel forwards to. Safer than the
   brief's literal "skip OAuth for 127.0.0.1": Tailscale Funnel forwards via loopback, so
   source-IP trust would trust all tunnel traffic. Trust = which port the client reached
   (the tunnel can't reach the no-auth port). Both bind loopback; only the public one is the
   Funnel target.

2. **Custom `OAuthServerProvider` on the SDK** (`mcpAuthRouter` + `requireBearerAuth` +
   `TarsOAuthProvider`). The SDK validates PKCE (S256) itself via
   `challengeForAuthorizationCode` — we store the challenge and let it compare. Opaque
   tokens; refresh tokens rotate on use; dead codes/refresh return RFC 6749 `invalid_grant`
   (the SDK's `InvalidGrantError`).

3. **Audience (RFC 8707) by construction.** Tokens are bound to the canonical resource and
   persisted; `verifyAccessToken` only succeeds for tokens in our store, so foreign-audience
   tokens never verify. We are the AS and never forward tokens upstream.

4. **Single-owner shortcuts.** `/authorize` auto-approves (no login/consent UI); DCR accepts
   any client and returns a generated `client_id` (public client + PKCE, secret optional —
   claude.ai leaves it blank). Redirect URIs are captured per client at registration, which
   inherently covers loopback clients' chosen ports.

5. **OAuth schema stays out of `core`.** `runMigrations` gained `dir`/`migrationsTable`
   options; the server keeps its OAuth tables in `packages/server/migrations` under a
   separate `server_migrations` ledger. One migration mechanism, boundary intact.

6. **Body parsing.** The SDK OAuth handlers attach their own json/urlencoded parsers (+ cors
   - rate-limit), so `express.json` is scoped to `/mcp` only to avoid double-parsing.

7. **Live deploy needs the owner** (secrets/tunnel): Tailscale Funnel hostname →
   `PUBLIC_BASE_URL`, then add the claude.ai connector. Documented in `deploy/tunnel/`.

## Phase 6 — Mirror + export (2026-06-22)

1. **One-way DB → Markdown.** `writeMirror(pool, { dir })` regenerates an
   `entities/<type>/<slug>-<id8>.md` tree + a `README.md` index + a full `export.json`
   every run. The `entities/` tree is wiped and rewritten so renames/deletes leave no stale
   files. The DB stays the single source of truth; the mirror is a durable, diffable,
   vendor-neutral copy.

2. **Deterministic for clean git diffs.** Stable slugs (+ 8-char id suffix), stable
   ordering, and JSON-encoded frontmatter scalars (JSON is valid YAML) — re-running with no
   changes yields no diff. Relation links are computed relative to the entities tree.

3. **Rendering is pure; writing/git are side-effectful and separated.** `render.ts` touches
   no fs; `write.ts` does fs plus an optional `gitCommitMirror` (inline git identity, so no
   global config is needed; returns false when there is nothing to commit).

4. **`memory_export` gained `markdownDir`.** Without it the tool returns the bounded JSON
   dump (unchanged); with it, it writes the full mirror (optionally committing) and returns
   a summary — satisfying "export produces JSON + Markdown" within tool-output limits.

## Phase 7 — Auto fact-extraction (optional) (2026-06-22)

1. **Propose, don't write.** `extractFacts(text, llm)` returns a zod-validated proposal
   (entities/observations/relations keyed by local `ref` handles); `applyProposal(memory,
proposal)` persists it via the normal `remember`/`link` path (types/predicates normalized
   - audited). Confirm-before-write is the split between the two functions.

2. **Provider-agnostic + tolerant parsing.** `ExtractionLlm` is a one-method interface
   (`complete`); `OllamaExtractionLlm` uses `/api/generate` JSON mode. The parser extracts
   the first `{…}` from the completion (tolerating code fences/prose). Tested with a fake
   LLM — no model needed in CI.

3. **Off by default, behind a flag.** `extractionLlmFromEnv` returns null unless
   `EXTRACTION_ENABLED` is set; real use needs a pulled chat model (`OLLAMA_EXTRACTION_MODEL`,
   default `llama3.2`). Mainly for batch/autonomous ingestion — when Claude is the client it
   extracts and calls the tools directly.

4. **Core-only (no new MCP tool).** §7's tool surface is unchanged; extraction is a library
   building block applied through the existing write path.

## Phase 8 — Hardening & ops (2026-06-22)

1. **Audit-review tool.** `memory_audit` (the 13th tool) reads the append-only log via
   `listAudit` (filter by action/target). Read-only — the log stays append-only.

2. **Rate-limited public endpoint.** `express-rate-limit` (240/min) guards the public `/mcp`
   ahead of bearer auth; the loopback listener is unthrottled. OAuth endpoints carry the
   SDK's own limiter.

3. **Two independent backups.** Scheduled `pg_dump` (restorable snapshot) + the git mirror
   (human-readable, vendor-neutral). `mirror-once.ts` (`pnpm --filter @tars/server mirror`)
   is the scheduled mirror job; both live under `ops/backup/`.

4. **24/7 via launchd.** `ops/launchd/com.tars.server.plist` keeps the Node server up
   (RunAtLoad + KeepAlive); config/secrets come from `<repo>/.env` (dotenv reads
   WorkingDirectory), never the plist. Postgres stays under Docker/Colima; the tunnel under
   Tailscale's own agent.

5. **Encryption at rest = FileVault** (covers the DB volume, `.env`, mirror, dumps) rather
   than app-level crypto — simpler and complete for a single-Mac deployment. See
   `PRIVACY.md`.

6. **Output bounds.** Recall/list/timeline/export are limit-capped and tool payloads are IDs
   - summaries, honoring the per-surface output ceilings; `express.json` is capped at 4mb.
