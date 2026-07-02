# Onboarding — from `git clone` to a living second brain

This is the **Day-0 runbook**: the order to do things in so a fresh clone ends up as an
always-on Tars, wired into the assistant you actually talk to, seeded with your real context,
and kept current by the nightly/morning routines. Each step links to the doc that owns the
detail — this page only sequences them.

If you're Claude Code working through this on someone's behalf: follow it in order, don't
skip step 4 (the brain must have something in it before Dream/Briefing have anything to
reconcile), and ask before taking any action outside this machine (registering a scheduled
task, connecting a new OAuth connector) if you're not sure it's wanted yet.

## 1. Stand up the server

```bash
git clone https://github.com/fonsecabc/tars.git && cd tars
make setup            # install prereqs, configure .env, build, start Postgres
make install-service  # run Tars 24/7 under launchd
make doctor           # verify everything is green
```

Details, Linux/dev path, and connecting Claude Code to the loopback listener:
[`README.md`](../README.md#install-macos).

## 2. Connect the MCPs you actually use

Tars alone is just memory. It's far more useful once the assistant can also read your world
(messages, mail, calendar, meetings) and reconcile it in.

1. `cp .mcp.json.example .mcp.json` and fill in the servers you want (delete the rest).
2. Add the claude.ai OAuth connectors you use (Gmail, Calendar, Slack, Granola, Linear, …) via
   **Settings → Connectors**.
3. Restart Claude Code and confirm: `claude mcp list`.

Full server-by-server guide, including the two-WhatsApp-accounts pattern:
[`docs/mcps.md`](mcps.md).

## 3. Become TARS (wire the persona)

Paste the system prompt into whatever Claude you're actually going to talk to day-to-day —
Claude Code's global `~/.claude/CLAUDE.md`, and/or claude.ai's custom instructions if you use
chat Claude too. The prompt is generic and copy-paste ready.

Full prompt, compact prompt, and wiring notes per surface:
[`docs/tars-system-prompt.md`](tars-system-prompt.md).

## 4. First scrape — seed the brain

**Don't skip this.** Tars ships empty on purpose, but Dream and Briefing only reconcile
_new_ activity since their last run — on an empty brain there's nothing for them to build on.
Run the one-time Bootstrap routine now, once step 2's connectors are live, to sweep everything
currently reachable into the graph in one pass.

Routine spec + copy-paste prompt: [`docs/routines/bootstrap.md`](routines/bootstrap.md).

## 5. Put the routines on a schedule

With the brain seeded, turn on the two recurring routines:

- **Dream** (nightly consolidation) — [`docs/routines/dream.md`](routines/dream.md)
- **Briefing** (morning digest) — [`docs/routines/briefing.md`](routines/briefing.md)

Both docs now include an "Instantiating on Claude Code" section: use the `/schedule` skill,
keep the in-repo doc as the abstract spec, and put your personal specifics (which sources,
what time) in a small drop-in file outside the repo (e.g. `~/tars-dream.md`).

## 6. Verify end to end

- `make doctor` — infra green.
- `claude mcp list` — `tars` plus your companions connected.
- Ask your assistant something only your brain would know (e.g. "who's on my team?") and
  confirm it calls `memory_recall` and answers from real data seeded in step 4.
- Check that the scheduled Dream/Briefing tasks from step 5 show up (`/schedule` list) and
  that a manual first run completed without pausing on tool-permission prompts.

From here, Tars runs itself: Dream consolidates every night, Briefing digests every morning,
and the brain keeps growing every time you talk to your assistant.
