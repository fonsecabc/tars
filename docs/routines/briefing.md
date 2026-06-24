# Briefing routine — "what do I need to check up on?"

A reusable, **read-only** routine prompt for a recurring personal briefing on top of Tars
(or any memory MCP) plus your messaging/calendar connectors. On each run it sweeps your
inboxes and calendar, grounds every item in the brain, and produces one concise, triaged
digest with a proposed next step per open item — but it never acts on its own.

It's written to be **agnostic**: no names, no hardcoded accounts. Drop it into a scheduled
task and point it at whatever connectors you have.

## Wiring

- **Prerequisite:** a memory MCP exposing the `memory_*` tools (Tars), plus any subset of
  messaging / team-chat / email / meetings / calendar connectors. Missing connectors are
  skipped gracefully.
- **Schedule (suggested):** every 2 hours during waking hours — cron `0 7-23/2 * * *`
  (local time). Tighten or widen to taste.
- **Delivery:** the digest is the run's final message — read it in the scheduled-task run
  log. Swap in a "send to self" step if you'd rather get it on a device (note that sending
  is an outward action, so relax the read-only rule deliberately if you do).
- **First run:** trigger it manually once to pre-approve each connector's tools, so future
  unattended runs don't pause on permission prompts.

## How it runs — a Briefing workflow

Run the Briefing as a **multi-agent workflow** rather than one agent sweeping sources one by
one. Almost all the latency is I/O — reading several independent sources — so sweeping them
concurrently is much faster; only the final triage needs to see everything at once.

| Phase      | Parallelism            | Why                                                                                                                       |
| ---------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Checkpoint | single                 | Read the last-run marker; the sweep window depends on it.                                                                 |
| Sweep      | **fan-out per source** | The slow I/O — scan every source at once. Read-only; each grounds its own items in the brain (concurrent reads are safe). |
| Triage     | single (barrier)       | Ranking across items, one digest, and the single checkpoint write all need the whole set.                                 |

Because the routine is read-only, the _only_ write is the dedup checkpoint, made once in Triage
— so there are no write races to design around. A runnable script is in _Briefing workflow
script_ near the end of this file. Where workflow orchestration isn't available, the prompt below
runs the sweep sequentially — slower, identical result.

## The prompt

This is the canonical, self-contained form (and the sequential fallback). To run it as the
workflow above, drive the _Briefing workflow script_ instead and keep these guardrails.

```text
You are a personal briefing assistant running on a recurring schedule (every ~2 hours,
waking hours). Each run produces one concise, scannable digest of everything the user needs
to attend to right now — unanswered messages, time-sensitive items, and commitments — each
with a proposed next step. The user reads the digest in the run log, so it is your final
message. Optimize for speed of reading: they should grasp what needs them in seconds.

<read_only>
This routine reads and proposes; it does not act. Don't send messages, create or save
drafts, reply, react, RSVP, schedule, or modify anything in any connected service. Every
suggestion is a proposal the user approves later, before you act on it. This matters because
the briefing runs unattended on a timer — an action taken without the user in the loop could
be wrong and can't be recalled. The one exception is your own dedup checkpoint in the brain
(see <dedup>), which is internal state rather than an outward action.
</read_only>

<use_the_brain>
A memory MCP ("the brain") holds the user's people, orgs, projects, commitments, and history
(memory_recall, memory_get_entity, memory_timeline, memory_list_entities). Before you describe
any person, thread, project, or commitment, recall it from the brain — that's what turns
"someone messaged you" into "your cofounder, re: the payment structure you owe him." If the
brain has nothing on an item, say so plainly; inventing context is worse than admitting a gap.
</use_the_brain>

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
"slack:<channel>:<ts>"). This checkpoint is the only thing the routine writes.
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
sweep fans out (read-only, each agent grounds its own items in the brain); Triage is a single
barrier that ranks, writes the digest, and makes the one checkpoint write.

```js
export const meta = {
  name: 'briefing',
  description:
    'Recurring personal briefing — sweep every source in parallel, ground in the brain, emit one triaged digest (read-only)',
  phases: [
    { title: 'Checkpoint', detail: 'recall last-run time + open items' },
    { title: 'Sweep', detail: 'scan every source in parallel' },
    { title: 'Triage', detail: 'merge, rank, write digest + checkpoint' },
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

// Triage — rank across items, one digest, and the single checkpoint write.
phase('Triage');
const items = sweeps.flatMap((s) => s.items || []);
const clean = sweeps.filter((s) => (s.items || []).length === 0 && !s.note).map((s) => s.source);
return await agent(
  `Assemble the briefing from these brain-grounded items: ${JSON.stringify(items)}. Clean sources: ${clean.join(', ') || 'none'}. ` +
    `Order by urgency into sections 🔴 NOW / 🟡 SOON / 🟢 FYI (omit empty ones); each item ≤3 lines, marked 🆕 new or ⏳ pending (with age). Lead with a one-line count headline; end with one "Clean: …" line. If nothing needs the user, say so in one line. ` +
    `Then — the routine's ONLY write — update the brain entity "Routine:briefing" with this run's timestamp and the current open-item keys. Return the digest text; it is the user-facing message.`,
  { label: 'triage', phase: 'Triage' },
);
```

## Notes on how this prompt is engineered

- **Read-only is the one emphasized rule**, because it genuinely overrides an agent's default
  to act — and it's stated with the reason (unattended timer, irreversibility) so the model
  applies judgment at the edges rather than following a bare prohibition.
- **`<tags>` separate concerns** (constraints, sources, dedup, format) so the model doesn't
  blur instructions with data, per current Claude 4.x guidance.
- **The example carries the format** — one diverse sample with abstract placeholders does more
  for output consistency than paragraphs of formatting rules.
- **Generic "e.g." connectors** keep it portable; the model uses whatever is actually
  connected and skips the rest.
- **The workflow parallelizes the sweep, not the writes** — the sources are independent and
  read-only, so they fan out safely; the single checkpoint write stays in the Triage barrier,
  which also needs the whole item set to rank and dedup. (Contrast the Dream, where parallel
  _writes_ force a dedup barrier and per-entity partitioning to stay idempotent.)
