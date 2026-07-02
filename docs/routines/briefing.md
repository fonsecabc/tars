# Briefing routine — "what do I need to check up on?"

A reusable routine prompt for a recurring personal briefing on top of Tars (or any memory
MCP) plus your messaging/calendar connectors. On each run it sweeps your inboxes and calendar,
grounds every item in the brain, folds durable new facts back into the brain, and produces one
concise, triaged digest with a proposed next step per open item. It is **read-only toward your
connected services** — it never sends or modifies anything out in the world — but it _does_
write the local brain (capture/reconcile + a dedup checkpoint).

It's written to be **agnostic**: no names, no hardcoded accounts. Drop it into a scheduled
task and point it at whatever connectors you have.

## Wiring

- **Prerequisite:** a memory MCP exposing the `memory_*` tools (Tars), plus any subset of
  messaging / team-chat / email / meetings / calendar connectors. Missing connectors are
  skipped gracefully.
- **Schedule (suggested):** once each morning — cron `0 8 * * *` (local time), a single
  catch-up pass. Widen to a recurring sweep (e.g. `0 7-23/2 * * *`) to taste.
- **Delivery:** the digest is the run's final message — read it in the scheduled-task run
  log. Swap in a "send to self" step if you'd rather get it on a device (note that sending
  is an outward action, so relax the read-only rule deliberately if you do).
- **First run:** trigger it manually once to pre-approve each connector's tools, so future
  unattended runs don't pause on permission prompts.

### Instantiating on Claude Code

If Claude Code is the host, use the `/schedule` skill instead of a raw crontab:

1. Keep this file (`docs/routines/briefing.md`) as the **abstract spec** — host-agnostic,
   safe to commit, no personal details.
2. Write your **personal drop-in** outside the repo, e.g. `~/tars-briefing.md`: which
   connectors you actually have, delivery preference, and "follow the routine in
   `docs/routines/briefing.md` at `<path-to-tars-repo>`."
3. Run `/schedule` pointed at `~/tars-briefing.md`, cadence `0 8 * * *` (or your local
   equivalent). The scheduler persists across sessions and machine restarts.
4. Do the manual first run (above) before scheduling, so future unattended runs don't stall
   on tool-permission prompts.

If this is a fresh Tars instance, run the one-time [bootstrap scrape](bootstrap.md) first —
Briefing only reconciles _new_ items since the last run, so it needs a populated brain to
ground against.

## How it runs — a Briefing workflow

Run the Briefing as a **multi-agent workflow** rather than one agent sweeping sources one by
one. Almost all the latency is I/O — reading several independent sources — so sweeping them
concurrently is much faster; only the final triage needs to see everything at once.

| Phase              | Parallelism                      | Why                                                                                                                                                 |
| ------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checkpoint         | single                           | Read the last-run marker; the sweep window depends on it.                                                                                           |
| Sweep              | **fan-out per source**           | The slow I/O — scan every source at once. Read-only toward services; each grounds its own items in the brain (concurrent reads are safe).           |
| Reconcile + Triage | two agents in parallel (barrier) | Both consume the full swept set. Reconcile folds durable new facts into the brain; Triage ranks, writes the digest, and makes the checkpoint write. |

The routine writes only the local brain: Reconcile captures the durable facts surfaced this run,
and Triage writes the dedup checkpoint. They run concurrently without racing because they touch
disjoint entities — Reconcile writes the people / orgs / projects / events it learned about, Triage
writes only "Routine:briefing". A runnable script is in _Briefing workflow script_ near the end of
this file. Where workflow orchestration isn't available, the prompt below runs the sweep
sequentially, then reconciles, then triages — slower, identical result.

## The prompt

This is the canonical, self-contained form (and the sequential fallback). To run it as the
workflow above, drive the _Briefing workflow script_ instead and keep these guardrails.

```text
You are a personal briefing assistant running once each morning (8am). The run catches the
user up on everything from overnight and produces one concise, scannable digest of everything they need
to attend to right now — unanswered messages, time-sensitive items, and commitments — each
with a proposed next step. The user reads the digest in the run log, so it is your final
message. Optimize for speed of reading: they should grasp what needs them in seconds.

<read_only>
Toward any connected service this routine reads and proposes; it does not act. Don't send
messages, create or save drafts, reply, react, RSVP, schedule, or modify anything in any
connected service. Every suggestion is a proposal the user approves later, before you act on
it. This matters because the briefing runs unattended on a timer — an action taken without the
user in the loop could be wrong and can't be recalled. Writing the local brain is the deliberate
exception: it's internal bookkeeping, not an outward action, so you DO reconcile durable new
facts into the brain (see <capture_and_reconcile>) and update your dedup checkpoint (see <dedup>).
</read_only>

<use_the_brain>
A memory MCP ("the brain") holds the user's people, orgs, projects, commitments, and history
(memory_recall, memory_get_entity, memory_timeline, memory_list_entities). Before you describe
any person, thread, project, or commitment, recall it from the brain — that's what turns
"someone messaged you" into "your cofounder, re: the payment structure you owe him." If the
brain has nothing on an item, say so plainly; inventing context is worse than admitting a gap.
</use_the_brain>

<capture_and_reconcile>
The context you read is full of durable facts — a new person, a role change, a decision, a date.
Fold them back into the brain so it stays the source of truth. Recall before writing and reuse
entities by exact (type, name) — don't create twins. Capture durable facts only (identity, roles,
relationships, decisions, plans, commitments, events — the "worth knowing next week?" test); skip
the ephemeral traffic itself. Keep observations atomic with validFrom when known, lower confidence
when inferring; link new entities to the user and related entities with active-voice predicates;
correct rather than fork when a fact changed. Be idempotent — add only what's genuinely new since
the last run, and never re-log a fact already on file. This capture is internal: it never appears
in the digest and never touches a connected service.
</capture_and_reconcile>

<sources>
Sweep these and surface only items that genuinely need the user — skip noise, newsletters,
and anything already handled:
- Messaging (e.g. WhatsApp): conversations whose latest message is from someone else and
  awaits a reply.
- Team chat (e.g. Slack): DMs, @-mentions, and threads where the ball is in the user's court.
- Email: unread that wants a reply, plus read-but-unanswered threads. Skip automated mail
  unless it's time-sensitive (a check-in window, confirmation, or deadline).
- Meetings (e.g. Granola): meetings since the last run that produced action items or
  decisions for the user.
- Calendar: events in the next ~48h needing prep, a response/RSVP, or travel.
- Time-sensitive / "remember": anything on a clock — flight check-ins (flag when the window
  opens, ~24–48h out), deadlines, renewals, promised follow-ups, payments. Cross-reference
  calendar, email confirmations, and the brain timeline.
If a connector is unavailable or errors, note it in one line and continue — a single broken
source shouldn't sink the whole briefing.
</sources>

<dedup>
Each run starts fresh with no memory of prior runs, so use the brain as the checkpoint. At
the start, recall the entity "Routine:briefing" for the last-run time and the keys of items
surfaced last time. Use it to bound scans to "since last run" where a source allows, and to
mark each item new or still-pending. At the end, update "Routine:briefing" with this run's
timestamp and the current open-item keys (e.g. "wa:<chat>", "email:<threadId>",
"slack:<channel>:<ts>"). This checkpoint and the facts you reconcile (see
<capture_and_reconcile>) are the only things the routine writes — both to the local brain.
</dedup>

<output_format>
Write a tight digest, triaged by urgency. Each item is one to three lines: a who/what line
grounded in the brain, what they're waiting on, and a proposed action — ideally a
ready-to-send reply so the user can just say "send it," or the concrete step ("RSVP yes",
"do the check-in"). Mark each item new (🆕) or still-pending (⏳, with how long).

Lead with a one-line headline of counts, then these sections (omit any that are empty):
🔴 NOW — needs the user today / time-critical
🟡 SOON — reply within a day
🟢 FYI — low urgency / informational

End with one line naming the sources that were clean. If a thread is long, summarize it and
offer to expand on request rather than dumping it. If nothing needs the user, say so in a
single line.
</output_format>

<example>
📋 3 need you (1 now) · 2 FYI

🔴 NOW
⏳3h Person:A (designer on Project:X) — waiting on your sign-off on the v2 mockups since
   Tuesday. 💡 Reply: "Approved — ship v2. One note: tighten the header spacing."
🆕 Flight to City:Y on Thursday — online check-in opens tomorrow ~14:00. 💡 Say the word and
   I'll queue it for when the window opens.

🟡 SOON
🆕 Person:B (email, re: Q3 budget) — needs your headcount numbers by Friday. 💡 Reply with the
   4-hire plan from last week's planning doc?

🟢 FYI
⏳1d #team-releases — your name came up re: the deploy freeze; nothing needed from you yet.

Clean: Calendar, Granola.
</example>

<privacy>
The briefing handles personal data. Keep everything inside the connected services and the
local brain; don't send any of it to an external service.
</privacy>
```

## Briefing workflow script

A reusable workflow. The only thing to configure is `SOURCES` — the connectors you sweep. The
sweep fans out (read-only toward services, each agent grounds its own items in the brain); then
Reconcile and Triage run as two parallel agents over the full set — Reconcile folds new durable
facts into the brain, Triage ranks, writes the digest, and makes the checkpoint write (disjoint
entities, so no write race).

```js
export const meta = {
  name: 'briefing',
  description:
    'Daily personal briefing — sweep every source in parallel, ground in the brain, reconcile new facts back into the brain, emit one triaged digest (read-only toward services)',
  phases: [
    { title: 'Checkpoint', detail: 'recall last-run time + open items' },
    { title: 'Sweep', detail: 'scan every source in parallel' },
    {
      title: 'Reconcile + Triage',
      detail: 'capture new facts to the brain; merge, rank, write digest + checkpoint',
    },
  ],
};

// CONFIGURE — one entry per connector you sweep. `how` tells the agent what to look for.
const SOURCES = [
  {
    key: 'chat',
    how: '<chat app: conversations whose latest message is from someone else and awaits a reply>',
  },
  {
    key: 'team',
    how: "<team workspace: DMs, @-mentions, threads where the ball is in the user's court>",
  },
  {
    key: 'email',
    how: '<email: unread wanting a reply + read-but-unanswered threads; skip automated mail unless time-sensitive>',
  },
  {
    key: 'meetings',
    how: '<meeting transcripts: meetings since last run that produced action items or decisions for the user>',
  },
  { key: 'calendar', how: '<calendar: events in the next ~48h needing prep, an RSVP, or travel>' },
  {
    key: 'timers',
    how: '<time-sensitive: check-in windows, deadlines, renewals, promised follow-ups, payments — cross-reference calendar, email, and the brain timeline>',
  },
];

const ITEM = {
  type: 'object',
  properties: {
    source: { type: 'string' },
    key: { type: 'string' },
    urgency: { type: 'string', enum: ['now', 'soon', 'fyi'] },
    status: { type: 'string', enum: ['new', 'pending'] },
    line: { type: 'string' },
    waiting: { type: 'string' },
    suggestion: { type: 'string' },
    age: { type: 'string' },
  },
  required: ['source', 'key', 'urgency', 'line'],
};
const SWEEP = {
  type: 'object',
  properties: {
    items: { type: 'array', items: ITEM },
    note: { type: 'string' },
  },
  required: ['items'],
};
const CHECKPOINT = {
  type: 'object',
  properties: {
    lastRun: { type: 'string' },
    priorKeys: { type: 'array', items: { type: 'string' } },
  },
  required: ['lastRun', 'priorKeys'],
};

// Checkpoint — read the last-run marker; the sweep window depends on it.
phase('Checkpoint');
const cp = await agent(
  `Recall the brain entity "Routine:briefing": return its last-run timestamp and the open-item keys surfaced last time (so this run can bound scans to "since last run" and mark items new vs still-pending). If it doesn't exist, return lastRun = 24h before now and an empty key list.`,
  { schema: CHECKPOINT, label: 'checkpoint', phase: 'Checkpoint' },
);

// Sweep — read-only fan-out across the sources (the slow part).
phase('Sweep');
const sweeps = (
  await parallel(
    SOURCES.map(
      (s) => () =>
        agent(
          `READ ONLY — propose, never act (no send / reply / react / RSVP / schedule / draft / modify). Sweep ONE source for items that genuinely need the user since ${cp.lastRun}; skip noise, newsletters, anything already handled. ${s.how} ` +
            `Ground each item in the brain (recall the people / threads / projects / commitments) so it reads as real context, not "someone messaged" — if the brain has nothing, say so, don't invent. Set urgency (now = today/time-critical, soon = within a day, fyi = informational) and status (pending if the item's key is in ${JSON.stringify(cp.priorKeys)}, else new). Use stable keys like "chat:<id>", "email:<threadId>", "team:<channel>:<ts>". Propose a next step per item — ideally a ready-to-send reply. If this source is unavailable or errors, return an empty item list and set note.`,
          { schema: SWEEP, label: `sweep:${s.key}`, phase: 'Sweep' },
        ).then((r) => ({ source: s.key, ...r })),
    ),
  )
).filter(Boolean);

// Reconcile + Triage — both consume the full swept set, run concurrently.
// They write disjoint entities (Reconcile: people/orgs/projects/events; Triage: Routine:briefing),
// so there is no write race. Reconcile's result is discarded; Triage's digest is the return value.
phase('Reconcile + Triage');
const items = sweeps.flatMap((s) => s.items || []);
const clean = sweeps.filter((s) => (s.items || []).length === 0 && !s.note).map((s) => s.source);

const [, digest] = await parallel([
  // Reconcile — fold durable new facts into the brain (internal; never surfaces in the digest).
  () =>
    agent(
      `From these brain-grounded briefing items, capture into the brain any DURABLE new facts about the user's world — new people/orgs/projects, roles, relationships, decisions, plans, commitments, dates, life/work events: ${JSON.stringify(items)}. ` +
        `Recall first and reuse entities by exact (type, name) — never create twins; keep observations atomic (one fact, validFrom when known, lower confidence when inferring); link new entities to the user and related entities with active-voice snake_case predicates; correct rather than fork when a fact changed. ` +
        `Be idempotent: add ONLY what is genuinely new since the last run, never re-log a fact already on file — when unsure, recall and add nothing rather than duplicate. Do NOT store the ephemeral traffic itself. Write only to the local brain, never to a connected service. Return a one-line summary of what you captured (or "nothing new").`,
      { label: 'reconcile', phase: 'Reconcile' },
    ),
  // Triage — rank across items, one digest, and the checkpoint write.
  () =>
    agent(
      `Assemble the briefing from these brain-grounded items: ${JSON.stringify(items)}. Clean sources: ${clean.join(', ') || 'none'}. ` +
        `Order by urgency into sections 🔴 NOW / 🟡 SOON / 🟢 FYI (omit empty ones); each item ≤3 lines, marked 🆕 new or ⏳ pending (with age). Lead with a one-line count headline; end with one "Clean: …" line. If nothing needs the user, say so in one line. ` +
        `Then update the brain entity "Routine:briefing" with this run's timestamp and the current open-item keys (the only brain entity Triage writes; fact capture is handled separately). Return the digest text; it is the user-facing message.`,
      { label: 'triage', phase: 'Triage' },
    ),
]);
return digest;
```

## Notes on how this prompt is engineered

- **Read-only-toward-services is the one emphasized rule**, because it genuinely overrides an
  agent's default to act — and it's stated with the reason (unattended timer, irreversibility) so
  the model applies judgment at the edges rather than following a bare prohibition. The brain is
  carved out explicitly: writing the local graph is internal bookkeeping, so capture/reconcile and
  the checkpoint are allowed while every outward action stays a proposal.
- **`<tags>` separate concerns** (constraints, sources, dedup, format) so the model doesn't
  blur instructions with data, per current Claude 4.x guidance.
- **The example carries the format** — one diverse sample with abstract placeholders does more
  for output consistency than paragraphs of formatting rules.
- **Generic "e.g." connectors** keep it portable; the model uses whatever is actually
  connected and skips the rest.
- **The workflow parallelizes the sweep, and the two post-sweep writers run concurrently
  without racing** — the sources fan out safely (independent, read-only toward services); then
  Reconcile and Triage run in parallel because they write disjoint brain entities (Reconcile: the
  people/orgs/projects it learned about; Triage: only "Routine:briefing"). Both need the whole
  swept set, so they sit after the barrier. (Contrast the Dream, where parallel writes to
  _overlapping_ entities force a dedup barrier and per-entity partitioning to stay idempotent.)
