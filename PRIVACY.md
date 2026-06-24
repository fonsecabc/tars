# PRIVACY.md

Tars stores a person's memory. This document states exactly what data lives where and
what (if anything) leaves the machine under each configuration. It is updated as
privacy-relevant features land.

## Posture

- **Self-hosted, single-user.** Runs on the owner's Mac. No telemetry. No analytics.
  No outbound calls except to a model provider you explicitly configure.
- **Default config is fully local:** Postgres on the box + local Ollama embeddings (or
  embeddings disabled entirely) → **zero third-party calls**. This is the recommended
  posture. `EMBEDDING_PROVIDER=null` is keyword-only; `ollama` adds semantic recall, still
  fully on-device.

## Where data lives

| Data                              | Location                               | Notes                                                   |
| --------------------------------- | -------------------------------------- | ------------------------------------------------------- |
| Entities, observations, relations | Postgres (Docker volume `tars_pgdata`) | Single source of truth.                                 |
| Audit log                         | Postgres                               | Append-only; every write/delete recorded (Phase 1).     |
| Markdown mirror                   | A separate local git repo              | One-way DB → Markdown; human-readable export (Phase 6). |
| Secrets (DB password, tokens)     | `.env` / OS keychain                   | Gitignored. Never committed.                            |
| Embeddings vectors                | Postgres                               | Derived from observation text (Phase 4).                |

## What leaves the machine, per configuration

| `EMBEDDING_PROVIDER` | What leaves the machine                                                |
| -------------------- | ---------------------------------------------------------------------- |
| `null` (default)     | Nothing. Keyword-only retrieval.                                       |
| `ollama`             | Nothing. Embeddings computed locally on the Mac GPU.                   |
| `openai`             | Observation text is sent to OpenAI to compute embeddings. Opt-in only. |

When the cross-surface tunnel is enabled (Phase 5), MCP tool traffic from Claude's apps
reaches the server over HTTPS via the tunnel. The memory contents themselves still live
only in your Postgres; Claude reads/writes them through authenticated MCP calls.

## Handling third-party & sensitive data

This store may hold **personal data about third parties** (people the owner knows) and
possibly **sensitive categories**. Everything is stored as-is — there is no in-database
redaction or gating; protection comes from keeping the data on-device and controlling what
leaves:

- **Fully local by default** — Postgres + local (or no) embeddings make **zero third-party
  calls** (see the table above). This is the primary safeguard.
- **Encryption at rest** via FileVault (DB volume, `.env`, the mirror, and dumps).
- **Keep the Markdown mirror private.** The mirror / `export.json` is a complete copy of the
  store, including third-party and sensitive facts. Keep its git repo local (or on an
  encrypted, private remote) — never push it anywhere public.
- **Data minimization** — store only what's needed; tool descriptions discourage
  over-collection of others' data.
- **Soft-delete by default**, hard-delete available — both logged (Phase 1).
- **Full export** (JSON + Markdown) and **erasure** (`memory_forget`) for data-subject-rights
  requests; every write and delete is in the append-only **audit trail** (Phase 1).

> **Operator responsibility:** Before storing other people's personal — and especially
> sensitive — data, review against your organization's privacy policy and consult your
> DPO / data-protection lead. Under data-protection regimes (e.g. LGPD / GDPR), a clear
> legal basis and purpose are required for processing third-party and sensitive data.

## Encryption at rest & operational hardening

- **Encryption at rest:** enable **FileVault** on the Mac — it covers the Postgres Docker
  volume, `.env`, the Markdown mirror, and `pg_dump` output (keep backups on the same
  encrypted disk, or an encrypted external/remote).
- **Backups:** two independent copies — scheduled `pg_dump` plus the git mirror
  (`ops/backup/`).
- **Cross-surface auth:** the public listener requires OAuth 2.1 (PKCE, short-lived access
  tokens, rotating refresh) and is rate-limited; the loopback listener binds `127.0.0.1`.
  The trusted/untrusted split is by listener, not by spoofable source IP.
- **Auditability:** every write/delete is in the append-only audit log, reviewable via the
  `memory_audit` tool.
- **Right to erasure / portability:** `memory_forget` (soft or hard delete) and
  `memory_export` (JSON + Markdown) support data-subject requests.
