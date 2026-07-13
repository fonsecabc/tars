# Routine: Context import — bring in what another AI already knows about you

If you already talk to ChatGPT, Gemini, Claude, or another assistant, it has picked up a lot
about you — how you write, who's in your life, what you're working on, which apps you live in.
Instead of seeding Tars from scratch, **ask that AI to hand over a profile of you**, then paste
it into TARS. TARS folds the facts into the brain, tunes its **humor and voice** to match how
you actually talk, and tells you which **connectors** are worth setting up.

This is the fast on-ramp; the [Interview](interview.md) is the from-scratch one. Do whichever
fits — or both (import first, then let the interview fill the gaps).

> **Heads up (your call):** the first prompt below sends your context _to that other AI's
> provider_ — but you're the one asking it, about yourself, so that's your decision to make.
> Nothing here sends anything from Tars outward; TARS only ever _reads_ what you paste back in.

## Step 1 — run this in your other AI

Copy everything in the box into ChatGPT / Gemini / Claude / whatever you use. If it has memory
of you it'll draw on it; if it doesn't, it'll ask you a handful of questions first.

```
You are helping me set up a personal AI assistant called TARS that will be my long-term memory
and will write in my voice. Produce a single, portable "profile of me" I can hand to TARS so it
starts already knowing who I am, how I talk, and what tools I use — instead of from zero.

Draw on EVERYTHING you know about me: your saved memory, our past conversations, and reasonable
inference from how I write to you. Rules:
- Only include what's actually grounded in what you know or can see. Do NOT invent facts, names,
  numbers, or dates. Mark anything you're guessing with "[inferred]".
- If you have little or no prior context on me, first ask me 6-8 short questions covering the
  sections below, then produce the profile.
- Use first names + relationship rather than full contact details. Skip anything sensitive
  (passwords, financial or ID numbers).

Produce TWO things.

PART 1 — Profile (readable, so I can check and correct it). Cover:
  1. Who I am — name / what to call me, where I live, work & role, languages, shape of my days.
  2. People — family, partner, close friends, key colleagues: name, relationship, 1-2 facts each.
  3. Work & projects — employers, current projects, goals, what "done" looks like.
  4. Goals & plans — what I'm working toward; upcoming trips, events, deadlines (with dates).
  5. How I talk & write (be specific — this sets the assistant's voice):
     - Tone and formality, and how they shift by audience (work vs friends vs family).
     - Humor: how much, and what kind (dry, sarcastic, punny, earnest, none).
     - Sentence length, punctuation and emoji habits, ALL-CAPS, profanity.
     - Signature words/phrases I actually use; things I avoid.
     - Languages and any code-switching.
     - 3-5 short example lines in MY voice (a text to a friend, a work chat message, a quick
       email) so the assistant can imitate me.
  6. Preferences & how I like help — communication style, tools I live in, hard nos, headaches.
  7. Tools & accounts I use — every app/service you know I use (email, calendar, chat, notes,
     docs, project tracker, meetings, social), so the assistant knows which connectors to set up.

PART 2 — A compact, structured version I can paste straight into TARS. Output it as ONE fenced
code block labelled "tars-profile", using these fields (omit any you have nothing for; append
" [inferred]" to any value you're guessing):

  identity: name, call_me, location, languages, role
  people:  one line each — name | relationship | facts
  projects: one line each — name | org | status | notes
  goals:   one line each — goal | by (date)
  voice:
    humor: a number 0-100 (how often and how sharp my jokes are)
    humor_style: dry / sarcastic / punny / earnest / none
    formality: low / medium / high
    verbosity: terse / balanced / verbose
    emoji: none / rare / frequent
    quirks: signature phrases and punctuation habits
    avoid: words or registers I never use
    languages: the languages I write in
    samples: 3-5 lines, each — context | text (a real-sounding line in my voice)
  preferences: one line each
  connectors_suggested: one line each — tool | what I use it for

Give me PART 1 first so I can correct anything, then PART 2.
```

## Step 2 — hand the result to TARS

Check Part 1, fix anything wrong, then paste the `tars-profile` block into a TARS session with
this instruction:

```
Here is a profile of me exported from another AI. Ingest it into my brain and tune yourself to me.

- Recall first; find-or-create entities by exact (type, name); write atomic observations with
  validFrom where known; link every person/org/project back to me. Never fabricate — treat any
  "[inferred]" value as low confidence and confirm the important ones before relying on them.
- From the voice section: set your humor dial to the given number, and keep my formality,
  verbosity, emoji habit, quirks, and sample lines as my voice profile for ghostwriting.
- From connectors_suggested: tell me which MCP connectors are worth setting up and why — but do
  NOT connect anything without my go-ahead.

When done, give me a short plain-language recap and flag anything you want me to confirm or fix.
```

TARS will confirm the shaky bits, set its voice to yours, and point you at the connectors to
wire up next (see [`docs/mcps.md`](../mcps.md)). From there, run the one-time
[Bootstrap](bootstrap.md) scrape to fill in the breadth automatically.
