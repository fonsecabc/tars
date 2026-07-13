# Onboarding — from `git clone` to a living second brain

This is the **Day-0 runbook**: the order to do things in so a fresh clone ends up as an
always-on Tars — wired into the assistant you actually talk to, seeded with your real life,
and kept current on its own. Each step links to the doc that owns the detail; this page just
sequences them.

**New to Claude / not very technical? You're the target reader.** The default path installs
the least possible, asks you plain-language questions, and lets you seed your brain just by
_talking_ to it. You do not need to understand the graph, write any config, or run a local AI
model. When a step is only for power users, it says so — skip it.

> **If you're Claude Code doing this for someone:** follow it in order. Don't skip step 5 (the
> brain must have something in it before the nightly routines have anything to build on), and
> ask before anything that reaches off this machine (scheduling a task, connecting a new
> account, opening a tunnel).

---

## 1. Pick your setup, then stand up the server

```bash
git clone https://github.com/fonsecabc/tars.git && cd tars
make setup            # asks ONE question, installs prereqs, configures + starts everything
make install-service  # keep Tars running 24/7 in the background
make doctor           # check everything is green
```

`make setup` first **looks at your Mac** (memory, chip) and asks how you want TARS to remember:

- **Simple** _(recommended — pick this if you're unsure)_ — TARS thinks with its **smart
  brain and memory graph**. Nothing extra to install, nothing extra to keep running, and your
  notes stay on this Mac. Great on a laptop. **No local AI model, no Ollama.**
- **Full** _(power users, on a desktop Mac that stays on)_ — also installs a local AI model
  for extra-fuzzy search and the optional voice stack. A few GB of downloads; wants 16GB+ RAM.

You can skip the question by setting it ahead of time: `TARS_PROFILE=simple make setup` (or
`full`). Either way the brain ships **empty** — no data until you add it in steps 4–5.

Details, the Linux/dev path, and connecting your assistant to Tars:
[`README.md`](../README.md#install-macos).

## 2. Become TARS (wire the persona)

Paste the system prompt into whichever Claude you actually talk to — Claude Code's global
`~/.claude/CLAUDE.md`, and/or claude.ai's custom instructions. It's generic and copy-paste
ready; it turns plain Claude into TARS, the assistant that reads and writes your brain.

Full prompt + wiring notes per surface: [`docs/tars-system-prompt.md`](tars-system-prompt.md).

## 3. Connect the accounts you want it to read _(optional, do as much or as little as you like)_

Tars on its own is memory. It gets far more useful once your assistant can also see your world
— messages, mail, calendar, meetings — and fold it in for you. Connect only what you're
comfortable with; everything degrades gracefully if you skip it.

1. In your assistant, add the connectors you use (Gmail, Calendar, Slack, Granola, Linear…) —
   on claude.ai that's **Settings → Connectors**.
2. For local companions (WhatsApp, etc.): `cp .mcp.json.example .mcp.json`, keep the servers
   you want, delete the rest, then restart your assistant.

Server-by-server guide, including the two-WhatsApp-accounts pattern:
[`docs/mcps.md`](mcps.md).

## 4. Tell TARS about yourself — the interview _(the easy, no-connector way in)_

The single friendliest way to seed the brain: **just talk to it.** TARS asks a short,
plain-language sequence — what to call you, who's around you, what you're working on — and
quietly remembers it all. ~10 minutes, needs nothing connected, no forms.

Copy-paste prompt + what it covers: [`docs/routines/interview.md`](routines/interview.md).

**Already use ChatGPT / Gemini / another AI?** Skip the typing: ask it to hand over a profile
of you — who you are, how you talk, which apps you use — and paste that into TARS, which folds
it in, tunes its humor and voice to match yours, and suggests which connectors to set up.
Both copy-paste prompts: [`docs/routines/context-import.md`](routines/context-import.md).

## 5. First scrape — let it read the rest **(don't skip this)**

Once you've connected some accounts in step 3, run the one-time **Bootstrap** scrape. It
sweeps everything currently reachable — across your **computer and your connectors** — into
the graph in one pass, so the nightly routines start from a full brain instead of an empty
one. (They only ever reconcile what's _new_, so without this seed they'd have nothing to build
on.) It works the same on the Simple profile — it uses your assistant's reasoning, not any
local model.

Routine spec + copy-paste prompt: [`docs/routines/bootstrap.md`](routines/bootstrap.md).

## 6. Put the routines on a schedule

With the brain seeded, turn on the two recurring routines so Tars maintains itself:

- **Dream** (nightly consolidation) — [`docs/routines/dream.md`](routines/dream.md)
- **Briefing** (morning digest) — [`docs/routines/briefing.md`](routines/briefing.md)

Both docs have an "Instantiating on Claude Code" section: use the `/schedule` skill, keep the
in-repo doc as the abstract spec, and put your personal specifics (which sources, what time)
in a small drop-in file outside the repo (e.g. `~/tars-dream.md`).

## 7. Verify end to end

- `make doctor` — infra green.
- In your assistant, confirm Tars is connected (`claude mcp list` in Claude Code).
- Ask it something only your brain would know ("who's on my team?", "when's my next trip?")
  and confirm it answers from the real facts you seeded in steps 4–5.
- Check the scheduled Dream/Briefing tasks show up and a first manual run finished cleanly.

From here Tars runs itself: Dream consolidates every night, Briefing digests every morning,
and the brain grows every time you talk to your assistant.

---

## Power-user extras _(skip on the Simple path)_

- **Voice** — a hands-free "hey TARS" loop (mic → speech → answer). Needs the Full profile and
  an always-on Mac. See [`docs/routines/voice-personas.md`](routines/voice-personas.md) and
  the `voice/` directory.
- **Talk to it from claude.ai / your phone** — expose the OAuth listener with `make tunnel`
  (Tailscale). Read [`SECURITY.md`](../SECURITY.md) first: anyone who reaches the public URL
  can read and write your brain, so keep it tailnet-only.
- **Hosted embeddings instead of a local model** — if you want fuzzy search without running
  Ollama, set `EMBEDDING_PROVIDER=openai` + `OPENAI_API_KEY` in `.env` (note: observation text
  is then sent to that provider). Most people don't need this — the Simple brain is plenty.
