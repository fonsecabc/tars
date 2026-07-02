# Routine: "Dream" — nightly memory consolidation

A reusable routine for any Tars instance. Each night Tars _sleeps_: it replays the day's
conversations, moves what matters into long-term memory, weaves new facts into the existing
graph, and renormalizes the brain so signal is strengthened and noise fades. The goal is a
brain that is a little more accurate and a little better organized every morning than it was
the night before.

It talks to the brain only through the standard memory tools (`memory_recall`,
`memory_remember`, `memory_link`, `memory_correct`, `memory_forget`, `memory_timeline`), so it
works against any Tars deployment. The _inputs_ it replays (chat/meeting connectors) are yours
to configure.

## How to install it

This is a prompt, not code — run it on a schedule in whatever host drives your Tars (Cowork,
Claude Code, a cron-invoked agent, etc.):

1. Copy the **Routine prompt** at the bottom of this file into a nightly scheduled task.
2. Fill in the **Configuration** block — chiefly which sources to replay.
3. Point the host at your Tars MCP server so the `memory_*` tools are available.
4. Pick a run time during your low-activity hours (early morning works well — it's when REM,
   the integration phase, dominates real sleep).

Each run is **stateless**: it rediscovers its own replay window from the brain itself (the last
`dream` marker), never from memory of a prior run. Runs are **idempotent and additive** —
re-running over the same day converges, it does not duplicate.

### Instantiating on Claude Code

If Claude Code is the host, use the `/schedule` skill rather than hand-writing a cron job:

1. Keep this file (`docs/routines/dream.md`) as the **abstract spec** — host-agnostic, no
   personal details, safe to commit.
2. Write your **personal drop-in** outside the repo, e.g. `~/tars-dream.md`: your actual
   source list (which WhatsApp/Slack/Granola/etc. connectors), your preferred run time, and
   "follow the routine in `docs/routines/dream.md` at `<path-to-tars-repo>`."
3. Run `/schedule` and point it at `~/tars-dream.md` with a nightly cadence during your
   low-activity hours (e.g. 03:30 local). Claude Code's scheduler persists this across
   sessions and machine restarts.
4. Before scheduling, do **one manual run** so the host pre-approves each connector's tools
   — unattended runs otherwise pause on permission prompts.

Don't run Dream before the brain has something to consolidate — do a one-time
[bootstrap scrape](bootstrap.md) first if this is a fresh Tars instance.

## Why it's shaped like sleep

Human memory is consolidated in two complementary sleep states plus an overnight
renormalization. This routine mirrors that architecture on purpose — each stage maps to a real
mechanism, and the _ordering_ matters (consolidate first, integrate second, prune throughout,
exactly as a night of sleep is slow-wave-heavy early and REM-heavy toward morning):

- **NREM / slow-wave sleep → systems consolidation.** The hippocampus replays the day's
  episodes and transfers them to neocortex via sharp-wave ripples coupled to spindles and slow
  oscillations. _Here:_ the day's raw chats are the hippocampal buffer; replaying them and
  writing durable entities/observations is the hippocampal→cortical transfer.
- **REM sleep → integration, abstraction, emotional tagging.** Theta-driven REM links new
  memories to old, forms schemas/generalizations, recombines distant items, and tags
  emotionally salient ones. _Here:_ cross-linking entities, inferring relationships, abstracting
  patterns, and prioritizing what carried weight.
- **Synaptic Homeostasis (SHY) → downscaling/renormalization.** Across the night, synapses that
  ballooned during waking are scaled back; weak/redundant connections are pruned while salient
  ones are locally strengthened, restoring signal-to-noise. _Here:_ merging duplicates,
  reconciling contradictions, and weakening trivia while reinforcing what recurs.

Grounding: Klinzing, Niethard & Born (2019), "Mechanisms of systems memory consolidation during
sleep," _Nature Neuroscience_; Tononi & Cirelli (2014), "Sleep and the price of plasticity" (the
synaptic homeostasis hypothesis); plus reviews on NREM oscillatory coupling and REM integration
listed at the end.

## Configuration

| Key            | What to set                                       | Notes                                                                                                                                                                                 |
| -------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SOURCES`      | The connectors to replay each night               | Any mix of messaging + meetings + your assistant's own chat transcripts — e.g. a chat app, a team workspace, email, calendar, meeting-transcript tools. List the read tools for each. |
| `WINDOW`       | last `dream` marker → now (fallback: last 24–36h) | The day being consolidated. See _Replay window_.                                                                                                                                      |
| `WRITE_POLICY` | `auto-apply` or `propose-then-confirm`            | Auto-apply writes directly (every write is audited and reversible); propose emits a report and waits.                                                                                 |
| `DREAM_MARKER` | `event` entity named `Dream <YYYY-MM-DD>`         | Records what was consolidated; also the next run's window anchor.                                                                                                                     |
| `RUN_TIME`     | a low-activity hour, in your local timezone       | e.g. nightly ~03:30.                                                                                                                                                                  |

**Boundary:** the routine _reads_ from your source connectors and _writes only_ to the Tars
brain. If a source isn't authed, skip it and note it in the dream journal — never abort the
whole dream; it's additive and the missed day will be re-covered next run.

## Replay window (idempotency)

Before replaying, decide _which_ day to consolidate:

1. Find the most recent `dream` marker: `memory_recall("Dream nightly consolidation",
types: ["event"])`, or `memory_timeline(types: ["event"])` and take the latest entity named
   `Dream …`.
2. `WINDOW = [that marker's "covered through" timestamp, now]`. If there is no prior marker, use
   the fallback window (last 24–36h).
3. When pulling from each source, request only items in `WINDOW`.

This is the dedup spine: the brain's own last-dream marker tells each run where to start. Two
dreams over the same window must converge, not duplicate.

## How it runs — a Dream workflow

Run the Dream as a **multi-agent workflow** rather than one agent working sequentially. Most of
the night is I/O-bound (reading the source connectors) and then repeats the same per-entity work
— both fan out well, so the workflow is markedly faster on a real day's traffic.

Replay fans out **per conversation, not per source.** One agent per source has to skim — it
can't hold every chat, channel, and meeting in one context, so it samples and the long tail of
conversations goes unread. So replay is two phases: a cheap **Enumerate** lists every
conversation with activity in the window, then **Deep replay** puts one dedicated reader on each
(full-thread, paged not sampled). Each reader has its own context budget, so nothing is dropped
for being far down the list — on real traffic this surfaces several times more entities than a
per-source pass over the same window.

The parallelism is shaped by one hard constraint: **writes must stay idempotent.** Concurrent
find-or-create on the same name double-creates entities. So replay (read-only) fans out freely;
a **dedup barrier** then merges candidates across conversations; then writes fan out
**partitioned by entity**, so no two agents ever touch the same one.

| Phase             | Parallelism                  | Why                                                                    |
| ----------------- | ---------------------------- | ---------------------------------------------------------------------- |
| Window            | single                       | Read the last marker; everything depends on it.                        |
| Enumerate         | **fan-out per source**       | Cheap listing — every conversation with in-window activity. Read-only. |
| Deep replay       | **fan-out per conversation** | The slow I/O — one full-thread reader per conversation, never sampled. |
| _(dedup barrier)_ | —                            | Merge candidates so one person ≠ two entities.                         |
| Consolidate       | **fan-out per entity**       | Disjoint entities → no write races. recall-before-write each.          |
| Integrate         | **fan-out per entity**       | All entities exist; link / abstract / reconcile each.                  |
| Renormalize       | single (barrier)             | Merging duplicates and pruning need a cross-entity view.               |
| Wake              | single                       | Lay the marker + report (needs aggregate counts).                      |

A runnable script is in _Dream workflow script_ near the end of this file (one `CONFIGURE` block
— the `SOURCES`). It runs via a host that can orchestrate multi-agent workflows. Where that isn't
available, execute the stages below sequentially — slower, identical result. The stages below are
exactly these phases, described in full.

## The night — run procedure

One trip through the sleep cycle. Reason carefully before each write; quality of consolidation
matters more than speed.

### Stage 0 — Falling asleep (enumerate, then deep-read every conversation)

Replay is two steps. First **enumerate** every conversation with activity in `WINDOW` (one
cheap agent per source returning, for each conversation, a stable handle to re-fetch it and a
human label). Then **deep-read each one** with a dedicated agent — full-thread, paged, never
sampled — gathering its raw, time-stamped **episodes** (who-said-what). One reader per
conversation is the point: it keeps the long tail of chats from being skimmed away. Keep each
harvest in working memory; don't write yet.

### Stage 1 — NREM / slow-wave (replay & consolidate)

The bulk of the work. Replay each episode and extract durable **facts** — people,
organizations, projects, places, events, decisions, commitments, preferences — and the
**relationships** between them. For each candidate fact:

1. **Check what's already stored.** `memory_recall` the entity (and scan its recent
   observations) to see whether this fact — or a near-equivalent — already exists. This is the
   "was this saved or not" check. Act only on what's genuinely new, changed, or sharper.
2. **Transfer episodic → semantic.** For new/sharper facts, `memory_remember` against the right
   entity (`type` + `name` to find-or-create, or `id` if known), `source: "extraction"`. Write
   each fact as a short standalone statement with:
   - `validFrom` = when the fact became true (the message/meeting time, not "now"), and
     `validTo` if it has already ended.
   - `confidence` reflecting how directly it was stated (explicit first-person ≈ 0.9–1.0;
     reported/secondhand ≈ 0.6–0.8; inferred ≈ 0.4–0.6).
   - `tags` for salience and kind, e.g. `salient`, `decision`, `commitment`, `relationship`,
     `preference`, `work`. (This is the emotional-tagging hook — it lets later recall and pruning
     prioritize what mattered.)
3. **Create the obvious relations** the episode states directly with `memory_link` (active-voice
   snake_case predicates: `works_with`, `manages`, `lives_in`, `founder_of`, `member_of`, …).
   Both ends must exist first.

Bias toward completeness — store what's worth remembering about everyone the day touched — but
never invent: if a detail is unknown, leave it out rather than guessing.

### Stage 2 — REM (integrate, abstract, associate)

Step back from the raw episodes and work on the _graph_. With the day's new entities plus what
they connect to:

- **Weave new into old.** For each entity touched tonight, recall its neighborhood and add the
  relationships the day implies but didn't state outright — e.g. two people in the same thread
  about the same project likely `collaborate_on` it. Keep confidence modest for inferred edges
  and tag them `inferred`.
- **Abstract / form schemas.** Notice patterns across episodes and record the generalization as
  its own observation — a recurring cadence, a role solidifying, a status shifting. A schema is
  worth more than the ten episodes it compresses.
- **Reconcile contradictions.** When a fact tonight conflicts with a stored one, use
  `memory_correct` on the old observation (get its `observationId` from recall/timeline) so
  history is preserved, not destroyed. Supersede the past — don't delete it.
- **Creative recombination.** Make a _few_ genuinely useful long-range connections the day
  surfaced (a person bridging two projects; a shared interest across contacts). Quality over
  quantity.

### Stage 3 — Synaptic downscaling (prune & renormalize)

Restore signal-to-noise across the entities you touched tonight (only what this dream activated,
not the whole brain):

- **Merge duplicates.** If replay revealed two entities for the same thing (alias drift,
  nickname vs. full name), consolidate: add the alternate as an `alias`, repoint facts, and
  `memory_forget` the empty husk. Same for two observations stating the same fact — keep the
  clearest.
- **Weaken trivia.** Low-salience, ephemeral chatter that got over-recorded can be left
  unreinforced or forgotten. Remember what matters, not every word.
- **Strengthen what recurs.** A fact independently confirmed again today is more reliable —
  reflect that (raise confidence / add a fresh-dated confirming observation / tag `salient`).
  This is the local potentiation that accompanies global downscaling.

### Stage 4 — Waking (dream journal + report)

1. **Lay down the marker.** `memory_remember` a `dream` event entity named `Dream <YYYY-MM-DD>`
   with observations recording: the window covered (state the "covered through" timestamp
   explicitly, so the next run knows where to resume), sources available vs. skipped, and counts
   (entities created/updated, links added, corrections, merges/forgets). Tag it `dream`.
2. **Morning report** (concise — the only user-facing output). Summarize: the few most salient
   new facts, notable new connections, anything corrected, anything pruned, and anything that
   needs a human (an unresolved contradiction, a source that was down). IDs + one-line summaries;
   don't dump the full graph.

## Worked example — consolidating one episode

The whole routine turns on one judgment, made in Stage 1: _given a fact from the day, is it new,
changed, or already known?_ This example shows that judgment on a single episode. Names are
abstract placeholders — real runs use real data.

<example>
Episode (chat with Person:A, 2026-01-15 14:12):
  Person:A — "Just started as Head of Design at Project:X. Moving to Lisbon next month."

Replay (recall before any write):
• recall("Person:A") → exists; has observation "Designer at Project:X" (obsId abc…), and is
already linked member_of Project:X.

Decisions:
• "Head of Design at Project:X" — a CHANGE to a stored fact → memory_correct(abc…,
"Head of Design at Project:X", validFrom 2026-01-15). Supersede, don't add a contradicting
duplicate.
• "Moving to Lisbon next month" — NEW and future-dated → memory_remember(Person:A,
"Relocating to Lisbon", validFrom 2026-02-01, confidence 0.8, tags ["plan"]). Confidence < 1
because it's a stated intention, not yet a fact.
• member_of Project:X — recall already showed this link → skip (no duplicate link).
• Greeting and logistics in the rest of the thread → not durable → leave unrecorded.

This is the SHY principle in miniature: sharpen what's real (the role correction), add genuine
signal (the move), and don't re-record what's already there or what's noise.
</example>

## Guardrails

- **Never invent personal data.** Unknown stays unknown; every fact must trace to a real episode
  in the window.
- **Privacy — local only.** Chats contain personal data. Read from the connectors, write only to
  the local Tars brain, and keep that content off any external service.
- **Idempotent & additive.** Recall-before-write; re-running a window converges, never
  duplicates. A failure on one episode or one source is logged and skipped — the dream continues.
- **Preserve history.** Use `memory_correct` to supersede, not deletion, when facts change.
  Reserve `memory_forget` for true duplicates and noise.
- **Bounded output.** Keep the morning report small; the brain — not the report — is the record.

---

## Routine prompt

Copy this into a nightly scheduled task. It runs the workflow below; if the host can't
orchestrate workflows, it falls back to the sequential stages above.

```
You are Tars, running your nightly "Dream" — memory consolidation modeled on sleep (NREM
systems consolidation → REM integration → overnight synaptic downscaling). Run it as a parallel
multi-agent workflow so the slow parts (reading the sources, then per-entity writes) happen at
once.

1. Author the "Dream workflow script" (below in your routine doc), filling in CONFIGURE: SOURCES
   = the read tools for the connectors you replay. WRITE_POLICY = auto-apply (audited, reversible).
2. Run it via your workflow tool. It orchestrates: Window → Enumerate (fan-out per source) →
   Deep replay (fan-out per conversation) → dedup barrier → Consolidate (fan-out per entity) →
   Integrate (fan-out per entity) → Renormalize (barrier) → Wake (marker + report).
3. Relay the final morning report — concise: the most salient new facts, notable new connections,
   anything corrected or pruned, and anything that needs a human.

If no workflow orchestration is available, fall back to the sequential stages: collect → NREM
consolidate (recall-before-write) → REM integrate → renormalize → lay the `Dream <date>` marker
+ report. Same result, slower.

Standing guardrails (these genuinely override defaults):
- Stateless + idempotent — the window comes from the brain's most recent `Dream <date>` marker
  (fallback 36h), never from memory of a prior run; recall before writing so re-running converges.
- Never invent personal data — unknown stays unknown; every fact traces to a real episode.
- Privacy is local-only — read from connectors, write only to the local Tars brain, keep all chat
  content off any external service.
- Preserve history — correct/supersede rather than delete when facts change.
- Keep the report small; the brain is the record, not the report.
```

## Dream workflow script

A reusable workflow. The only thing to configure is `SOURCES` — the connectors you replay. Each
agent reaches the brain through the standard `memory_*` tools, so the script is deployment-agnostic.

```js
export const meta = {
  name: 'dream',
  description:
    "Nightly memory consolidation — enumerate the day's conversations, deep-read each in parallel, then consolidate, integrate, and prune the brain (mirrors sleep)",
  phases: [
    { title: 'Window', detail: 'find where last night stopped' },
    { title: 'Enumerate', detail: 'list every active conversation per source' },
    { title: 'Deep replay', detail: 'one full-thread reader per conversation' },
    { title: 'Consolidate', detail: 'recall-before-write, one agent per entity' },
    { title: 'Integrate', detail: 'link, abstract, reconcile per entity' },
    { title: 'Renormalize', detail: 'merge duplicates and prune' },
    { title: 'Wake', detail: 'lay the marker + morning report' },
  ],
};

// CONFIGURE — one entry per connector you replay. `how` tells the agent how to ENUMERATE the
// window's conversations: return, for each, a stable `ref` a reader can re-fetch and a human label.
const SOURCES = [
  { key: 'chat', how: '<chat app: list chats with messages in the window; ref = chat id>' },
  {
    key: 'team',
    how: '<team workspace: DMs/channels/threads with in-window activity; ref = channel/thread id>',
  },
  {
    key: 'sessions',
    how: "<your assistant's own chat transcripts: sessions active in the window; ref = session id>",
  },
  {
    key: 'meetings',
    how: '<meeting-transcript tool: meetings in the window; ref = meeting id>',
  },
];
const FALLBACK_HOURS = 36;

const WINDOW = {
  type: 'object',
  additionalProperties: false,
  properties: { from: { type: 'string' }, to: { type: 'string' } },
  required: ['from', 'to'],
};
const TARGETS = {
  type: 'object',
  properties: {
    targets: {
      type: 'array',
      items: {
        type: 'object',
        properties: { ref: { type: 'string' }, label: { type: 'string' } },
        required: ['ref', 'label'],
      },
    },
  },
  required: ['targets'],
};
const FACT = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    validFrom: { type: 'string' },
    confidence: { type: 'number' },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['text'],
};
const HARVEST = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          entity: { type: 'string' },
          entityType: { type: 'string' },
          facts: { type: 'array', items: FACT },
          relations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                predicate: { type: 'string' },
                other: { type: 'string' },
              },
              required: ['predicate', 'other'],
            },
          },
        },
        required: ['entity'],
      },
    },
  },
  required: ['candidates'],
};
const SUMMARY = {
  type: 'object',
  properties: { entityId: { type: 'string' }, summary: { type: 'string' } },
  required: ['summary'],
};

// Window — read the last Dream marker; everything depends on it.
phase('Window');
const win = await agent(
  `Find the most recent Dream marker (memory_recall "Dream nightly consolidation" types:["event"], or memory_timeline types:["event"], newest entity named "Dream …"). ` +
    `Return the window to consolidate: from = that marker's "covered through" timestamp, to = the current time. If there is no marker, from = ${FALLBACK_HOURS}h before now.`,
  { schema: WINDOW, label: 'window', phase: 'Window' },
);

// Enumerate — cheap read-only listing of every conversation with activity in the window.
phase('Enumerate');
const enumed = (
  await parallel(
    SOURCES.map(
      (s) => () =>
        agent(
          `READ ONLY. Enumerate the conversations to deep-read for memory consolidation. ${s.how}. Window: ${win.from} → ${win.to}. ` +
            `Return ONLY conversations with genuine activity in the window — skip dead/empty ones. ref must be a stable handle a later agent can use to re-fetch the full thread; label a human name. If this source isn't authed/available, return an empty targets list.`,
          { schema: TARGETS, label: `enum:${s.key}`, phase: 'Enumerate' },
        ).then((r) => ({ source: s.key, targets: r.targets || [] })),
    ),
  )
).filter(Boolean);
const targets = enumed.flatMap((e) => (e.targets || []).map((t) => ({ ...t, source: e.source })));
log(
  `enumerated ${targets.length} conversations (${enumed.map((e) => `${e.source}:${e.targets.length}`).join(', ')})`,
);

// Deep replay — one full-thread reader per conversation (the slow part), so nothing is sampled away.
phase('Deep replay');
const harvests = (
  await parallel(
    targets.map(
      (t) => () =>
        agent(
          `Deep-replay ONE conversation for memory consolidation — READ ONLY, write nothing. Source: ${t.source}. Conversation: "${t.label}" (ref: ${t.ref}). Window: ${win.from} → ${win.to}. ` +
            `Read the FULL thread in the window (page through it; do not sample). Extract EVERY durable fact and relationship about the user and every person/org/project/place/event mentioned — identities, roles, contact handles, plans, decisions, commitments, preferences, opinions, life/work events, dates, money, travel, health. ` +
            `Set each fact's validFrom to when it became true (the message/meeting time) and a confidence by directness (explicit ≈ 0.9–1.0, reported ≈ 0.6–0.8, inferred ≈ 0.4–0.6). Skip pure greetings/logistics chatter. Never invent — unknown stays unknown. Return the candidate list.`,
          {
            schema: HARVEST,
            label: `read:${t.source}:${t.label}`.slice(0, 60),
            phase: 'Deep replay',
          },
        ).then((r) => ({ source: t.source, ...r })),
    ),
  )
).filter(Boolean);

// Dedup barrier (plain code) — merge candidates across conversations so one person ≠ two entities.
const byEntity = new Map();
for (const h of harvests)
  for (const c of h.candidates || []) {
    const key = (c.entity || '').trim().toLowerCase();
    if (!key) continue;
    if (!byEntity.has(key))
      byEntity.set(key, { entity: c.entity, entityType: c.entityType, facts: [], relations: [] });
    const agg = byEntity.get(key);
    agg.facts.push(...(c.facts || []));
    agg.relations.push(...(c.relations || []));
  }
const work = [...byEntity.values()];
log(`deep-read ${harvests.length} conversations → ${work.length} entities to consolidate`);

// Consolidate — one agent per entity (disjoint → no write races). recall-before-write.
phase('Consolidate');
const consolidated = (
  await parallel(
    work.map(
      (w) => () =>
        agent(
          `Consolidate ONE entity into the brain. Entity: "${w.entity}" (type: ${w.entityType || 'infer it'}). Candidate facts: ${JSON.stringify(w.facts)}. ` +
            `First memory_recall this entity and scan its recent observations. Then memory_remember (source "extraction"), find-or-create by type+name, writing ONLY facts that are new, changed, or sharper than what's stored — supersede a changed fact with memory_correct (get its observationId from recall), skip exact duplicates. Return the entity id and a one-line summary of what you wrote vs skipped.`,
          { schema: SUMMARY, label: `save:${w.entity}`, phase: 'Consolidate' },
        ),
    ),
  )
).filter(Boolean);

// Integrate — all entities now exist; link / abstract / reconcile each neighborhood.
phase('Integrate');
await parallel(
  work.map(
    (w) => () =>
      agent(
        `Integration pass for entity "${w.entity}". Stated relations today: ${JSON.stringify(w.relations)}. ` +
          `Resolve each "other" by recalling it, then memory_link from "${w.entity}" to it with the given predicate — only edges where "${w.entity}" is the subject, and skip links that already exist. ` +
          `Also add the relationships the day implies (modest confidence, tag "inferred"), abstract any recurring pattern into a schema-level observation, and reconcile contradictions with memory_correct. Return a one-line summary.`,
        {
          schema: {
            type: 'object',
            properties: { summary: { type: 'string' } },
            required: ['summary'],
          },
          label: `link:${w.entity}`,
          phase: 'Integrate',
        },
      ),
  ),
);

// Renormalize — duplicates + pruning need a cross-entity view → single barrier.
phase('Renormalize');
const cleanup = await agent(
  `Renormalize ONLY the entities touched tonight: ${work.map((w) => w.entity).join(', ') || '(none)'}. ` +
    `Merge duplicate entities (alias drift, nickname vs full name): add the alias, repoint facts, memory_forget the empty husk. Forget redundant observations, keeping the clearest. Leave low-salience trivia unreinforced. For facts independently reconfirmed today, strengthen them (raise confidence or add a fresh-dated confirming observation, tag "salient"). Return counts + a one-line summary.`,
  {
    schema: {
      type: 'object',
      properties: {
        merges: { type: 'number' },
        forgets: { type: 'number' },
        strengthens: { type: 'number' },
        summary: { type: 'string' },
      },
      required: ['summary'],
    },
    label: 'renormalize',
    phase: 'Renormalize',
  },
);

// Wake — lay the marker (needs aggregate counts) + morning report.
phase('Wake');
return await agent(
  `Lay tonight's Dream marker, then write the morning report. ` +
    `memory_remember an event entity named "Dream <today's date>" with observations recording: window covered = ${win.from} → ${win.to} (state "covered through ${win.to}" explicitly so the next run resumes there), which SOURCES returned data vs were skipped, and counts — entities consolidated: ${consolidated.length}; cleanup: ${JSON.stringify(cleanup)}. Tag it "dream". ` +
    `Then a concise morning report: the most salient new facts, notable new connections, anything corrected or pruned, and anything that needs a human. IDs + one-line summaries; don't dump the graph.`,
  { label: 'wake', phase: 'Wake' },
);
```

## Sources (memory neuroscience grounding)

- Klinzing, Niethard & Born (2019), "Mechanisms of systems memory consolidation during sleep,"
  _Nature Neuroscience_.
- Tononi & Cirelli (2014), "Sleep and the price of plasticity" — the synaptic homeostasis
  hypothesis (SHY).
- "Systems memory consolidation during sleep: oscillations, neuromodulators, and synaptic
  remodeling," _BMB Reports_ (2024) — https://pmc.ncbi.nlm.nih.gov/articles/PMC12576410/
- "Coordinated NREM sleep oscillations among hippocampal subfields modulate synaptic plasticity
  in humans," _Communications Biology_ (2024) — https://www.nature.com/articles/s42003-024-06941-9
- "Molecular Mechanisms of Memory Consolidation That Operate During Sleep," _Frontiers in
  Molecular Neuroscience_ (2021).
