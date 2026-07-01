# MCP companions for Tars

Tars is the **memory**. It gets far more useful when the assistant driving it can also
_read your world_ (messages, calendar, meetings, mail) and _act_ (send a note, look
something up). These are the MCP servers I run alongside Tars — the ones the
[routines](routines/) (nightly Dream, morning briefing) read from and report through.

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

| Server          | What it does                                                    | Install                                                                                  |
| --------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `tars`          | **The brain itself** — memory over HTTP (this repo).            | Runs from `make setup` / `pnpm start`; loopback at `http://127.0.0.1:8787/mcp`.          |
| `whatsapp`      | **Your** WhatsApp — read/reconcile chats (a source).            | [whatsapp-mcp](https://github.com/verygoodplugins/whatsapp-mcp) — Go bridge + uv server. |
| `whatsapp-tars` | **Tars's own** WhatsApp line — the outbox it messages you from. | Second instance of the same bridge on a separate port + DB (see below).                  |
| `linkedin`      | Look up people/companies, read your inbox/feed.                 | `uvx mcp-server-linkedin@latest`                                                         |
| `fli`           | Flight search (Google Flights).                                 | `fli-mcp` (installs `fli` + its MCP shim).                                               |
| `macos`         | Drive the macOS desktop (screens, shortcuts, apps).             | `uvx macos-mcp serve --transport stdio` — grant Accessibility/Automation perms.          |

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
