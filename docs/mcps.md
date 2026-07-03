# MCP companions for Tars

Tars is the **memory**. It gets far more useful when the assistant driving it can also
_read your world_ (messages, calendar, meetings, mail) and _act_ (send a note, look
something up). These are the MCP servers I run alongside Tars — the ones the
[routines](routines/) (nightly Dream, morning briefing, [voice personas](routines/voice-personas.md))
read from and report through.

None of them are required to use Tars. Add the ones that fit your life; skip the rest.

> **Copy [`.mcp.json.example`](../.mcp.json.example) to `.mcp.json`** and edit the
> placeholders. Claude Code auto-discovers a project-scoped `.mcp.json` at the repo root.
> Your real `.mcp.json` is gitignored — it holds machine paths and a bridge token, so it
> must never be committed.

---

## Local servers (you install these)

These run on your machine over stdio/HTTP and live in `.mcp.json`. Prerequisites: `uv`
/ `uvx` ([Astral uv](https://docs.astral.sh/uv/)) on your `PATH`. If Claude Code can't
find a command by name, use its absolute path (`which uv`).

| Server          | What it does                                                      | Install                                                                                  |
| --------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `tars`          | **The brain itself** — memory over HTTP (this repo).              | Runs from `make setup` / `pnpm start`; loopback at `http://127.0.0.1:8787/mcp`.          |
| `whatsapp`      | **Your** WhatsApp — read/reconcile chats (a source).              | [whatsapp-mcp](https://github.com/verygoodplugins/whatsapp-mcp) — Go bridge + uv server. |
| `whatsapp-tars` | **Tars's own** WhatsApp line — the outbox it messages you from.   | Second instance of the same bridge on a separate port + DB (see below).                  |
| `linkedin`      | Look up people/companies, read your inbox/feed.                   | `uvx mcp-server-linkedin@latest`                                                         |
| `x`             | **Your** X/Twitter — mentions, DMs, posting, replying (a source). | [xurl](https://github.com/xdevplatform/xurl) — X's official CLI, bundles an MCP bridge.  |
| `fli`           | Flight search (Google Flights).                                   | `fli-mcp` (installs `fli` + its MCP shim).                                               |
| `macos`         | Drive the macOS desktop (screens, shortcuts, apps).               | `uvx macos-mcp serve --transport stdio` — grant Accessibility/Automation perms.          |

### The two WhatsApp accounts — they do opposite jobs

This is the one bit worth getting right. Tars uses **two** WhatsApp numbers:

- **`whatsapp`** is _your_ personal account. It's a **source of truth**, like email: the
  routines read and reconcile real conversations from it. Don't send from it unless you
  mean to.
- **`whatsapp-tars`** is _Tars's own_ number — a dedicated line whose only job is to reach
  **you** (morning briefings, Dream reports, alerts). Treat it as an **outbox**, not a data
  source. Nothing in it is worth remembering.

Both point at the same [whatsapp-mcp](https://github.com/verygoodplugins/whatsapp-mcp)
project but run as **separate bridge instances** — different API ports (`8910` vs `8911`)
and separate SQLite stores — so the two accounts never cross. Generate your own random
`WHATSAPP_BRIDGE_TOKEN` (e.g. `openssl rand -hex 32`); the placeholder in the example is
not a real secret.

If you only want the reports and not the chat-reading, run just `whatsapp-tars`.

### X/Twitter — official API only, on purpose

`xurl` is X's own CLI; its `mcp` subcommand bridges to X's hosted MCP server over OAuth2. It's
the only integration path used here — cookie/session-scraping libraries exist but every one of
them carries real, maintainer-acknowledged account-ban risk, which isn't a trade worth making on
a real personal account. Setup, once per person/account:

1. Create an app at [developer.x.com](https://developer.x.com), on the **Pay-per-use** package
   (X's default now; billed per call, no flat tier). No free tier reads/writes anymore.
2. Under **User authentication settings**, set **App permissions** to **"Read and write and
   Direct Messages"** — the default "Read and write" tier silently blocks DM scopes and the
   OAuth consent screen fails with a generic error if you forget this.
3. Set the app type to a confidential client ("Web App, Automated App or Bot") and the callback
   URI to `http://localhost:8080/callback` — that's `xurl`'s default and what its OAuth2 flow
   listens on.
4. Put the Client ID/Secret in `.mcp.json`'s `x` entry (see `.mcp.json.example`), or register
   them locally with `xurl auth apps add <name> --client-id ... --client-secret ...`.
5. First run needs a one-time browser login (`xurl auth oauth2`, or `--headless` on a remote/
   headless box — it prints a URL, you paste back the redirected code). The token then
   auto-refreshes; you don't repeat this.
6. Add billing / credits to the app's Pay-per-use package before any read/write call will
   succeed — auth can complete fine while calls still 402 with `credits-depleted` if unfunded.

**DM ceiling:** official DM reads are capped at 15 requests/15min, user-context OAuth only —
there's no bulk or app-only tier. That's the real limitation vs. WhatsApp/LinkedIn; budget
routine polling intervals around it rather than reaching for an unofficial client.

---

## Chat-Claude connectors (add via claude.ai / Desktop, not `.mcp.json`)

The routines also draw on services exposed as **claude.ai Connectors** (OAuth, added
through the claude.ai / Claude Desktop **Settings → Connectors** UI — they aren't local
processes, so they don't go in `.mcp.json`). The ones I connect:

| Connector       | Used by Tars for…                                         |
| --------------- | --------------------------------------------------------- |
| Gmail           | Reading/triaging mail in the briefing; drafting replies.  |
| Google Calendar | Time-sensitive items and the day's schedule.              |
| Google Drive    | Pulling docs referenced in conversations.                 |
| Slack           | Reading work channels/DMs (a source) in Dream + briefing. |
| Granola         | Meeting transcripts to reconcile into the brain.          |
| Linear          | Issues/projects context for work items.                   |

Swap in whatever equivalents you use (Outlook, Notion, Jira, …). Granola and Slack also
have community stdio MCPs if you'd rather run them locally in `.mcp.json`.

---

## Verify

After editing `.mcp.json`, restart Claude Code and check the servers connected:

```bash
claude mcp list
```

`tars` should be reachable first (`make doctor` confirms the brain is up); the rest are
additive. A server that fails to start is skipped — Tars itself keeps working.
