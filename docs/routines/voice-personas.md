# Voice personas — draft messages that sound like you, per platform

A reusable pattern for learning how the user writes on each platform they use (Slack, email,
WhatsApp, LinkedIn, Twitter/X, …) and storing that as a **voice persona** in the brain, so that
whenever Tars drafts a message on that platform it writes in the user's actual voice instead of
generic assistant prose. This generalizes the ad-hoc `taste-slack-voice` / `whatsapp-voice`
Claude Code skills into something the brain itself remembers and keeps current.

It has two halves:

- **Learn** — read a sample of the user's own sent messages on a platform, extract a structured
  voice profile, and store it as a `voice_persona` entity.
- **Draft** — before writing anything on that platform, recall the persona, write in that voice,
  and always show the draft for approval before it goes anywhere.

Like the other [routines](.), it talks to the brain only through the standard `memory_*` tools,
so it works against any Tars deployment; the platform connectors it reads from are yours to
configure (see [`docs/mcps.md`](../mcps.md)).

## Why store this in the brain, not a static skill file

A skill file (e.g. `taste-slack-voice`) is accurate the day it's written and stale the day the
user's writing changes. A persona stored as brain entities gets the same benefits as every other
fact Tars holds: it's `memory_correct`-able when a trait changes, it can hold multiple
`validFrom`-dated observations to see how the voice drifted, it's queryable (`memory_recall
"how do I write on Slack"`), and it's re-derivable on demand ("relearn my LinkedIn voice") rather
than hand-maintained prose. Static skills still have a place — see **Relationship to existing
skills** below — but the source of truth for "how the user writes" belongs in the graph.

## Persona schema

One entity per platform (or per platform+register, if a platform has genuinely distinct
registers that don't share vocabulary — e.g. a company Slack vs. a personal Discord).

- **Type:** `voice_persona`
- **Name:** `Voice:<Platform>`, e.g. `Voice:Slack`, `Voice:Email`, `Voice:WhatsApp`,
  `Voice:LinkedIn`, `Voice:Twitter`. Reuse the exact name on every relearn — `memory_remember`
  find-or-creates by exact `(type, name)`, so a typo'd variant forks a twin persona.
- **Observations:** atomic voice traits, each ≤ ~240 chars, `validFrom`-dated so drift is
  visible over time. Typical traits to capture:
  - **Register & tone:** formal/casual, warm/blunt, first-person habits.
  - **Structure:** typical message length, one-liner vs. multi-paragraph, bullet use.
  - **Mechanics:** punctuation habits (em dashes, ellipses, ALL CAPS for emphasis), emoji
    frequency and which ones, capitalization (e.g. never capitalizes sentence starts in DMs).
  - **Openers/closers:** how messages start and end (greeting, sign-off, no sign-off at all).
  - **Vocabulary:** recurring words/phrases, slang, in-jokes, language-switching habits.
  - **Audience variants:** if one platform covers multiple registers (a casual DM vs. a
    company-wide announcement on the same Slack), tag observations by audience
    (`tags: ["audience:dm"]`, `tags: ["audience:company-wide"]`) instead of splitting entities —
    keeps one persona per platform while still letting a draft pick the right register.
  - **Do-not-do:** patterns the user has explicitly rejected in past drafts (from `memory_correct`
    history or direct feedback) — these are as valuable as what to imitate.
- **Relations:** `memory_link` the persona to the user with predicate `voice_of` (or
  `models_voice_of`), and to a `platform` entity for that service if one exists in the graph.

```
Voice:Slack (voice_persona)
  ├─ voice_of → Person:<user>
  ├─ observation: "Writes short, punchy Slack messages, rarely more than 3 lines" (validFrom …)
  ├─ observation: "No greeting in DMs; opens directly with the point" (tags: audience:dm)
  ├─ observation: "Company-wide posts are upbeat, exclamation-heavy, always credit the team"
  │    (tags: audience:company-wide)
  └─ observation: "Never uses 'per my last message' — flagged as a rejected draft on 2026-05-02"
```

## Learn — building or refreshing a persona

Run this on demand ("learn my Slack voice", "relearn my WhatsApp voice for my family chat") or
periodically (e.g. monthly) as writing style evolves. It is **read-only toward the platform** —
it only ever reads the user's own sent messages, never anyone else's, and it writes nothing but
the brain.

```text
You are building a voice persona for how the user writes on <PLATFORM>, so future drafts on
that platform sound like them instead of a generic assistant.

<scope>
Read only messages the user themselves sent/authored on <PLATFORM> — never build a persona from
messages other people sent them. Pull a representative recent sample (aim for 30-100 messages
across different contexts/chats/channels if the platform has several) rather than the single
most recent thread, so the profile isn't skewed by one conversation's mood.
</scope>

<extract>
From the sample, derive atomic, falsifiable traits: register/tone, typical length and structure,
punctuation and emoji habits, openers/closers, recurring vocabulary or phrases, capitalization
habits, and anything platform-specific (e.g. thread vs. DM tone, formal vs. casual channels). If
the platform has genuinely distinct registers depending on audience, note which audience each
trait belongs to instead of averaging them into mush.
</extract>

<persist>
Recall the brain entity Voice:<PLATFORM> (type voice_persona) first — reuse it if it exists,
create it if not (exact type+name, never a near-miss spelling). Add each derived trait as an
atomic observation (validFrom = today). If a new observation contradicts an existing one (the
voice changed), memory_correct the old one rather than leaving both on file. Link the persona to
the user with predicate voice_of. Do not store the sampled messages themselves — only the
derived traits.
</persist>

<report>
Return a short human-readable summary of the profile you stored (5-10 lines), not the raw
observations — this is for the user to sanity-check, not a dump of the brain.
</report>
```

### Learn workflow (multiple platforms at once)

Learning several platforms is independent, read-heavy work — fan it out. Reuse the pattern from
[the briefing routine](briefing.md#briefing-workflow-script): one agent per platform in
`Learn`, no barrier needed since each writes its own disjoint `Voice:<platform>` entity.

```js
export const meta = {
  name: 'learn-voice-personas',
  description:
    "Sample the user's own sent messages per platform and store/refresh a voice_persona entity per platform in the brain",
  phases: [{ title: 'Learn', detail: 'one agent per platform, read-only toward the platform' }],
};

// CONFIGURE — one entry per platform connector you want a persona for.
const PLATFORMS = [
  { key: 'Slack', how: 'the team-chat connector; sample across DMs and channels the user posts in' },
  { key: 'Email', how: 'the email connector; sample the Sent folder' },
  { key: 'WhatsApp', how: "the user's own WhatsApp account (not Tars's outbox line)" },
  { key: 'LinkedIn', how: 'the LinkedIn connector; sample messages and post drafts/comments' },
  { key: 'Twitter', how: 'the X/Twitter connector or browser session; sample posts and replies' },
];

phase('Learn');
const summaries = (
  await parallel(
    PLATFORMS.map((p) => () =>
      agent(
        `Build/refresh the voice persona for how the user writes on ${p.key}, reading from ${p.how}. ` +
          `Read only the user's own authored messages, never other people's. Extract atomic traits ` +
          `(register, length/structure, punctuation/emoji habits, openers/closers, vocabulary, ` +
          `audience-tagged variants if the platform has distinct registers). Recall the brain entity ` +
          `Voice:${p.key} (type voice_persona) first, reuse or create it by exact (type, name), add new ` +
          `traits as atomic observations with today's validFrom, memory_correct any that changed, and ` +
          `link it to the user with predicate voice_of. Do not store the raw sampled messages. If ${p.key} ` +
          `has no connector available or no sent messages to sample, say so and do nothing else. ` +
          `Return a short human-readable summary of what you stored.`,
        { label: `learn:${p.key}` },
      ).then((summary) => ({ platform: p.key, summary })),
    ),
  )
).filter(Boolean);

return summaries;
```

## Draft — writing in the persona

Whenever a draft is needed for a platform that has a persona on file:

```text
Before drafting a message on <PLATFORM>, recall Voice:<PLATFORM> from the brain (memory_recall
"voice persona <PLATFORM>" or memory_get_entity on its id). Write the draft matching its
register, length, structure, punctuation/emoji habits, and vocabulary — picking the
audience-tagged variant that matches who this is going to, if the persona has more than one. If
no persona exists yet for this platform, say so and offer to run the Learn pass, or fall back to
a plain, undecorated draft rather than guessing at a voice.

Never send, post, or reply directly. Always show the full draft — body, target
thread/chat/recipient — and wait for explicit approval before it goes out. Approval for one
message never carries over to the next.
</text>
```

The preview-before-send rule is load-bearing, not optional: a wrong guess at register is
low-stakes to redraft but embarrassing to have already sent. This mirrors the existing
`email-draft-preview-first` and `whatsapp-voice` conventions — this pattern generalizes them to
every platform rather than replacing them.

## Relationship to existing skills

`taste-slack-voice` and `whatsapp-voice` (Claude Code skills, not part of this repo) are the
hand-written precursors to this pattern — they encode Caio's Slack/WhatsApp voice as static
prose with pre-decided modes. This routine supersedes the *source of truth* for that content:
the traits should live in `Voice:Slack` / `Voice:WhatsApp` brain entities, re-derivable and
correctable, rather than only in a skill file someone has to remember to update by hand. The
skills can stay as thin wrappers that recall the brain persona and layer platform-specific
mechanics (e.g. "always preview in the target chat") on top, rather than carrying the voice
description themselves.

## Notes on how this is engineered

- **Read-only toward every platform, always.** Learn only ever reads the user's own sent
  messages; Draft never sends. The one write path is the brain (persona traits), same carve-out
  used by [the briefing routine](briefing.md#read_only).
- **One entity per platform, audience as a tag, not a new entity.** Keeps `memory_recall "voice
  persona"` cheap and avoids an explosion of near-duplicate personas; a platform with genuinely
  incompatible registers (rare) is the only case that earns a second entity.
- **Traits are atomic and dated**, so drift over months is visible in `memory_timeline` and a
  contradicted trait is `memory_correct`-ed rather than left to rot next to its replacement —
  the same discipline the [system prompt](../tars-system-prompt.md#tool_mechanics) applies to
  every other fact in the graph.
- **Don't store the raw messages** — only the derived traits. The persona is a compact summary
  of style, not a searchable archive of what was said (that's what reconciling the platform as a
  normal source, per the [briefing](briefing.md) and [Dream](dream.md) routines, is for).
