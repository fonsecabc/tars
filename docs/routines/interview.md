# Routine: Interview — seed the brain by just talking

The friendliest way to give a brand-new Tars its first facts: **have a conversation.**
No forms, no fields, no export files. TARS asks a short, plain-language sequence of
questions — who you are, who's around you, what you're working on — and quietly turns your
answers into entities, observations, and relations in the graph.

This is the manual counterpart to [Bootstrap](bootstrap.md). Bootstrap _reads_ your
connected accounts (WhatsApp, mail, calendar…) and folds them in; the Interview captures
the things **no connector knows** — how you think, what you care about, who matters and why.
Most people run the Interview first (it takes ~10 minutes and needs nothing connected), then
run Bootstrap to fill in the breadth.

## When to run it

- **Once, early**, right after the server is up and the TARS persona is wired
  ([`docs/onboarding.md`](../onboarding.md) steps 1–3). It needs **no connectors** — just
  Tars itself — so a non-technical person can do it on day one.
- **Any time you want**, later, to add a chapter of your life the graph is thin on ("let's
  add my family", "let's add my current project"). Re-running is safe: find-or-create by
  exact `(type, name)` means it enriches existing entities instead of duplicating them.

## How it feels (for the person being interviewed)

You talk; TARS listens and remembers. It asks one thing at a time, in everyday words, and
never dumps a wall of questions. You can say "skip that", "I'd rather not", or "that's enough
for today" at any point and it moves on or stops. Nothing you say leaves your Mac except when
your assistant reads it back to help you. You never see JSON, ids, or the word "entity".

## How it runs (for TARS)

A single conversational agent — not a fan-out. Work through the areas below **in order**, one
question at a time, capturing to the brain _as you go_ (don't wait until the end). Keep your
own talking short; the person should be doing most of it.

The areas, roughly in priority order — cover what the person engages with, skip the rest:

1. **You** — name and what to call them, where they live, their work/role, the broad shape of
   their days. This seeds the owner `person` entity everything else links back to.
2. **People** — family, partner, close friends, key colleagues/manager. For each: who they
   are to the person, and one or two concrete facts. Link each back to the owner with an
   active-voice predicate (`married_to`, `parent_of`, `friend_of`, `manages`, `works_at`).
3. **Work & projects** — employer/company, current projects, what "done" looks like, who else
   is involved. Create `organization` / `project` entities and link people to them.
4. **Goals & plans** — what they're trying to make happen this quarter/year; upcoming trips,
   events, deadlines (capture dates as `validFrom`/`validTo`).
5. **Preferences & how they like help** — the standing things worth knowing next week: how
   they like to be communicated with, tools they live in, hard nos, recurring headaches.

### Capture rules (same operating loop as every other routine)

- **Recall before you write** so you reuse an entity instead of twinning it
  (`memory_recall` → find-or-create by exact `(type, name)`).
- **Atomic observations**, one fact each, with `validFrom` when you know it. Lower confidence
  when the person is vague; **skip rather than guess** — never invent a fact, name, or date.
- **Link every new entity** back to the owner and to related entities as you create them; a
  fact nobody is connected to is nearly useless later.
- **Don't narrate the bookkeeping.** A light "got it" is fine; don't read ids back or explain
  the graph. Keep it a conversation.
- **Confirm the tricky bits** — spellings of names, exact dates — before saving them.

## Routine prompt

Copy this into a Claude Code / claude.ai session that has Tars attached, and run it. No
connectors required.

```text
You are running the Tars INTERVIEW routine — a friendly, one-at-a-time conversation to seed
a fresh memory graph with the things no connector could tell you. Talk like a warm, efficient
person, not a form. The human should do most of the talking.

Rules:
- Ask ONE question at a time, in plain everyday language. Never dump a list of questions.
- Start by asking what you should call them, then move through: the people around them
  (family, partner, close friends, key colleagues) → their work and current projects →
  their goals, upcoming plans, trips, deadlines → how they like to be helped.
- Let them steer. "Skip that", "rather not", "that's enough" → move on or stop gracefully.
  Never pressure; never ask for anything sensitive (passwords, financial/ID numbers).
- Capture to the brain AS YOU GO, quietly:
    * memory_recall first to reuse an existing entity (find-or-create by exact type+name).
    * memory_remember atomic observations (one fact each), with validFrom dates where known;
      lower confidence when they're vague, and SKIP rather than guess. Never fabricate.
    * memory_link every new entity back to the owner person and to related entities, using
      active-voice snake_case predicates (married_to, parent_of, friend_of, manages,
      works_at, part_of, lives_in, created…).
- Confirm spellings of names and exact dates before saving them.
- Do NOT show ids, JSON, or the word "entity". A light "got it" is plenty; keep it a chat.

Begin: create (or find) the owner's person entity from their name, mark it as the brain's
owner, then start the conversation. When they're done, give a short warm recap in plain words
("Here's what I've got so far…") and suggest running the one-time scrape (Bootstrap) next to
fill in the rest automatically.
```
