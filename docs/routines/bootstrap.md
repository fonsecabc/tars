# Routine: Bootstrap — the first scrape

A **one-time** routine for a fresh Tars instance. [Dream](dream.md) and [Briefing](briefing.md)
only reconcile what changed _since their last run_ — on a brand-new brain there is no "last
run," so they'd have nothing to work with the first night. Bootstrap fixes that: it sweeps
**everything currently reachable** on each connected source and reconciles it into the graph in
one pass, so Dream and Briefing start from a populated brain instead of an empty one.

It talks to the brain only through the standard memory tools (`memory_recall`,
`memory_remember`, `memory_link`), exactly like Dream and Briefing — so it works against any
Tars deployment and any subset of connectors.

## When to run it

- **Once**, right after you've connected the MCP companions you want (see
  [`docs/mcps.md`](../mcps.md)) and wired the [system prompt](../tars-system-prompt.md).
- **Never on a schedule.** It's a backfill, not a recurring sweep — Dream and Briefing take
  over once it's done. Re-running it later is safe (the same find-or-create semantics as
  every other memory write mean it converges rather than duplicates) but usually pointless.
- **Re-run per connector** if you add a new source later (e.g. you connect Slack six months
  in) — scope a run to just that source instead of redoing everything.

## Configuration

Fill this in before running:

- **Sources** — every connector you have available and want ingested, e.g.: personal
  WhatsApp, Slack, Gmail, Google Calendar, Google Drive, Granola, Linear, LinkedIn. Skip
  anything not connected — the routine degrades gracefully.
- **Depth per source** — how far back to look. Full history is ideal but not always
  practical (a WhatsApp export can span years); a reasonable default is "everything
  available without an explicit date filter" for chat/email, and "all" for calendars,
  meetings, and project trackers, since those are naturally bounded.
- **Own identity** — who the user is (name, key aliases), so it can seed the `person` entity
  for the user themselves before reconciling everyone else against it. You don't need to fill
  this in by hand: the Seed phase below resolves it from whatever identity the host already
  exposes (Claude Code's local `git config`, an injected account identity) and only asks if
  that's ambiguous or missing.

## How it runs

Run it as a **multi-agent workflow**, one agent per source, fanned out — like Briefing's
sweep phase but wider (whole history, not a delta) and with no checkpoint to read first:

| Phase     | Parallelism                        | Why                                                                                                                                                                                                                                                                    |
| --------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seed      | single                             | Resolve who the user is (auto-detect, or ask once if ambiguous) and create/enrich their entity — everyone else links back to it.                                                                                                                                       |
| Sweep     | **fan-out per source**             | Each source is independent I/O; read the full available history and extract candidates.                                                                                                                                                                                |
| Reconcile | single (or sharded by entity type) | Fold every candidate person/org/project/event into the graph: find-or-create, add observations, link to the user and to each other. Do this after all sweeps finish — cross-source dedup (the same person in WhatsApp and Slack) needs the full candidate set at once. |

Unlike Briefing, **Reconcile here is a real barrier**: bootstrapping benefits from seeing every
source's candidates together before writing, so the same person mentioned across WhatsApp and
Slack becomes one entity, not two. This is the one place bootstrap intentionally trades latency
for correctness.

## Write policy

Same operating loop as Dream and Briefing: recall before writing (to reuse existing entities,
find-or-create by exact `(type, name)`), capture atomic observations with `validFrom` dates
where known, link every new entity back to the user and to related entities, and never
fabricate — if a source is ambiguous about a fact, lower confidence or skip it rather than
guessing. This is a write-heavy routine (a fresh brain has nothing yet), but the same "never
invent personal data" rule applies: only store what a source actually says.

## Routine prompt

Copy this into a Claude Code / claude.ai session with Tars and your source connectors
attached, fill in the `Configuration` block, and run it once:

```text
You are running the Tars BOOTSTRAP routine — a ONE-TIME initial scrape to seed a fresh
memory graph. This is not a recurring job; run it once, in full, then stop.

Configuration:
- User identity: <name + key aliases, if you already know them — otherwise leave blank and
  let the Seed phase resolve it>
- Sources to sweep: <list only the connectors actually available, e.g. "personal WhatsApp,
  Slack, Gmail, Google Calendar, Granola">
- Depth: full available history for chat/email; all records for calendar/meetings/trackers.

Do this as a multi-agent workflow with three phases:

1. SEED (single agent): resolve the user's identity, then create or find their `person`
   entity. If Configuration already names them, use that. Otherwise try to resolve a name/
   email without asking, from whatever the host environment already knows — Claude Code's
   local `git config user.name`/`user.email`, or an account identity already present in
   context (e.g. an injected email). Only ask the user directly ("What should I call you?")
   if nothing resolves unambiguously — don't infer identity from connector data (e.g. a
   WhatsApp display name) as a substitute for asking. Once resolved, memory_remember the
   `person` entity with an observation marking it as the brain's owner. Record its id —
   everything below links back to it.

2. SWEEP (fan out one agent per configured source, all in parallel): for each source, read as
   much history as the source reasonably exposes and extract candidate entities — people,
   organizations, projects, places, events — with the concrete facts and dates attached to
   each. Do not write to the brain yet; return a structured list of candidates with the
   source they came from.

3. RECONCILE (single pass, after every sweep agent has returned): merge the candidate lists
   across all sources — the same person appearing in two sources is one entity, not two.
   For each merged candidate: memory_recall first to check it doesn't already exist,
   memory_remember to create-or-enrich it with atomic observations (validFrom dates where
   known, lower confidence where inferred), then memory_link it to the user entity and to any
   other candidate entities it clearly relates to (works_at, manages, friend_of, part_of,
   etc., active-voice snake_case).

Never fabricate a fact, relation, or date that isn't actually supported by what a source
says. When a source is ambiguous, skip the observation rather than guessing. When you finish,
report a short summary: entities created, entities enriched, relations added, and any source
that was configured but unreachable.
```
