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
  over once it's done. Re-running it later is safe: the same find-or-create semantics as every
  other memory write mean it converges rather than duplicates. That safety is deliberate and
  the tiers below rely on it, so a second run to widen your history is expected, not wasteful.
- **Re-run per connector** if you add a new source later (e.g. you connect Slack six months
  in) — scope a run to just that source instead of redoing everything.

## Configuration

Fill this in before running:

- **Sources** — everything you have available and want ingested, across two kinds:
  - **Connectors:** personal WhatsApp, Slack, Gmail, Google Calendar, Google Drive, Granola,
    Linear, LinkedIn, Notion…
  - **This computer:** local files and notes the host can reach — e.g. the macOS MCP
    (Desktop/Documents, Notes, Contacts, Calendar) and any folders you point it at.

  Skip anything not connected — the routine degrades gracefully, source by source.

- **Depth per source**: how far back to look. This is the setting that decides what the run
  costs, so it gets a section of its own below. The default is a **90-day window for chat and
  email** and **all records for calendars, meetings, and project trackers**, which are
  naturally bounded and small. Full history is an opt-in, not the recommendation.
- **Own identity** — who the user is (name, key aliases), so it can seed the `person` entity
  for the user themselves before reconciling everyone else against it. You don't need to fill
  this in by hand: the Seed phase below resolves it from whatever identity the host already
  exposes (Claude Code's local `git config`, an injected account identity) and only asks if
  that's ambiguous or missing.

## Depth, cost, and tiers

Bootstrap is the only routine that reads history in bulk, which makes it the only step of
setup that spends real model usage. Dream and Briefing resume from a marker and read just the
delta, so their per-run cost stays roughly flat however large the brain gets. Bootstrap has no
such floor: what it costs is whatever you point it at.

Two habits keep that under control.

**Count before you sweep.** The Count phase below reads metadata only and reports how much is
in scope per source, then stops. It is cheap, and it replaces guessing with a number. Nobody
can pick a sensible window for a WhatsApp account without knowing whether it holds four
thousand messages or four hundred thousand.

**Then run it in tiers.** Each tier is a separate run that leaves the brain usefully better,
so you can stop as soon as recall feels good rather than committing to everything up front:

| Tier  | Sources                                            | Depth                         |
| ----- | -------------------------------------------------- | ----------------------------- |
| **0** | calendar, contacts, meeting notes, project tracker | everything                    |
| **1** | add mail and chat                                  | last 90 days                  |
| **2** | widen mail and chat                                | as far back as you care about |

Tier 0 comes first because those sources are small, structured, and dense with facts worth
keeping: who you meet, who you work with, what you are shipping. Chat and mail are high volume
for the number of durable facts they yield, so they get a window rather than "everything".

Re-running is safe by design: find-or-create on exact `(type, name)` means a later tier
enriches what is already there instead of duplicating it. That property is what makes tiering
work at all.

If your host lets you choose a model per agent, the Sweep phase is where a cheaper one pays
off. Sweeping is mechanical (read, list candidates) and it is the bulk of the work; Reconcile
is the judgment part, and it should get your best model.

## How it runs

Run it as a **multi-agent workflow**, one agent per source, fanned out — like Briefing's
sweep phase but wider (history, not a delta):

| Phase     | Parallelism                        | Why                                                                                                                                                                                                                                                                    |
| --------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Count     | single                             | Read metadata only and report how much is in scope per source, then stop for the user to set depth. Skip if depth is already decided.                                                                                                                                  |
| Seed      | single                             | Resolve who the user is (auto-detect, or ask once if ambiguous) and create/enrich their entity — everyone else links back to it.                                                                                                                                       |
| Sweep     | **fan-out per source**             | Each source is independent I/O; read history to the configured depth and extract candidates. Skip any source that already has a Bootstrap marker covering that depth.                                                                                                  |
| Reconcile | single (or sharded by entity type) | Fold every candidate person/org/project/event into the graph: find-or-create, add observations, link to the user and to each other. Do this after all sweeps finish — cross-source dedup (the same person in WhatsApp and Slack) needs the full candidate set at once. |

Unlike Briefing, **Reconcile here is a real barrier**: bootstrapping benefits from seeing every
source's candidates together before writing, so the same person mentioned across WhatsApp and
Slack becomes one entity, not two. This is the one place bootstrap intentionally trades latency
for correctness.

That barrier has a price, and you are allowed to refuse it. Holding every candidate until the
end means each one is carried through a sweep agent's output and back into Reconcile's input,
and a run that dies before writing loses the whole sweep. The alternative is **streaming
mode**: reconcile one source at a time, writing as you go, and accept that the same person may
briefly exist twice until a later Dream merges them. Choose the barrier when you want the
cleanest possible first graph, streaming when usage or reliability matters more.

Either way, write a marker per source once its candidates are safely in the graph
(`memory_remember` an `event` named `Bootstrap <source>` recording the depth and date covered).
An interrupted run then resumes at the next source instead of starting over, which is the
difference between one bill and two.

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
- Sources to sweep: <list only what's actually available — connectors AND this computer,
  e.g. "personal WhatsApp, Slack, Gmail, Google Calendar, Granola, plus local files via the
  macOS MCP (Notes, Contacts, Desktop/Documents)">
- Depth: last 90 days for chat/email; all records for calendar/meetings/trackers. Widen only
  if the user asks, or on a later tier run.
- Reconcile mode: <"barrier" for the cleanest first graph, or "streaming" to write per source
  as you go and keep usage lower. Default barrier.>

Do this as a multi-agent workflow. Phase 0 is a stop-and-check; do not skip it unless the
Configuration above already states an explicit depth the user chose themselves.

0. COUNT (single agent, metadata only): for each configured source, report how much is in
   scope at the configured depth: chats and messages, mail threads, calendar events,
   documents, tickets. Read counts and metadata; do NOT read message bodies. Present it as a
   short table, say which sources look large enough to be worth narrowing, then STOP and wait
   for the user to confirm or change the depth. This phase exists so nobody commits to a big
   read without seeing its size first.

1. SEED (single agent): resolve the user's identity, then create or find their `person`
   entity. If Configuration already names them, use that. Otherwise try to resolve a name/
   email without asking, from whatever the host environment already knows — Claude Code's
   local `git config user.name`/`user.email`, or an account identity already present in
   context (e.g. an injected email). Only ask the user directly ("What should I call you?")
   if nothing resolves unambiguously — don't infer identity from connector data (e.g. a
   WhatsApp display name) as a substitute for asking. Once resolved, memory_remember the
   `person` entity with an observation marking it as the brain's owner. Record its id —
   everything below links back to it.

2. SWEEP (fan out one agent per configured source, all in parallel): before reading a source,
   memory_recall for an `event` named `Bootstrap <source>`; if one exists that already covers
   the configured depth, skip that source and say so. Otherwise read history to the depth set
   in Configuration, which is not the same as everything the source exposes, and extract
   candidate entities: people, organizations, projects, places, events, with the concrete facts
   and dates attached to each. Do not write to the brain yet; return a structured list of
   candidates with the source they came from. If the host lets you pick a model per agent, use
   a cheaper one here: this phase is mechanical and it is the bulk of the work.

3. RECONCILE (single pass, after every sweep agent has returned): merge the candidate lists
   across all sources — the same person appearing in two sources is one entity, not two.
   For each merged candidate: memory_recall first to check it doesn't already exist,
   memory_remember to create-or-enrich it with atomic observations (validFrom dates where
   known, lower confidence where inferred), then memory_link it to the user entity and to any
   other candidate entities it clearly relates to (works_at, manages, friend_of, part_of,
   etc., active-voice snake_case). In streaming mode, do this per source as each sweep agent
   returns instead of waiting for all of them, and let a later Dream merge any duplicate a
   cross-source name collision creates. Use your best available model for this phase either
   way: deciding whether two records are the same person is the judgment call in the routine.

   After a source's candidates are in the graph, memory_remember an `event` named
   `Bootstrap <source>` with an observation recording the depth and date range covered. That
   marker is what lets an interrupted run resume, and what lets a later tier widen one source
   without redoing the others.

Never fabricate a fact, relation, or date that isn't actually supported by what a source
says. When a source is ambiguous, skip the observation rather than guessing. When you finish,
report a short summary: entities created, entities enriched, relations added, per-source
markers written, and any source that was configured but unreachable.
```
