# The handoff artifact

Copy the skeleton, fill what applies, **delete what doesn't**. Empty sections
marked "N/A" teach the receiver that this document is ceremonial and can be
skimmed — which is exactly the wrong lesson.

````markdown
# Handoff: <task in five words> — <YYYY-MM-DD HH:MM TZ>

For: <next session | subagent coordinator | human name | fresh worktree>

## Objective

<One or two sentences: what the receiver is trying to achieve, and why it
matters. The "why" is what lets them make the calls this document doesn't
anticipate.>

## State

<Where the work actually stands right now. Mark each claim:
(verified: <how>) or (assumed).>

## Verify before you build

```bash
<the exact command>
```

Expected: <what passing looks like>. If this fails, fix it before adding
anything — the state below was true at <time>, not necessarily now.

## Decisions

- <decision> — because <reason>. <pointer, if it's in code>

## Rejected

- <approach> — failed because <reason>. Don't re-run this.

## Open questions & blockers

- <question> — blocked on <who/what>; unblocks <what work>

## Next action

<The single concrete thing to do next. Not a roadmap.>

## Pointers

- <path/to/file.ts:42> — <what's there>
- <commit SHA / PR URL / ticket> — <why it matters>
````

---

## Why each field is there

### Objective

The receiver will hit a decision this document doesn't cover — that is
guaranteed, not a risk. The stated _why_ is what they extrapolate from. An
objective that only names the task ("finish the migration") gives them nothing;
one that names the goal ("get prod onto 0103 so the search page stops 500ing on
an empty result set") gives them a tiebreaker.

### State

The section that goes stale fastest and gets trusted hardest. Two rules:

- **Provenance inline.** `(verified: pnpm check, green, 14:20)` vs `(assumed —
I never opened it)`. Confidence is information; flattening it into declarative
  prose is a lie the receiver can't detect.
- **Present tense, no narrative.** "Migrations 0100–0102 are on staging only" —
  not "I then applied the migrations and after some debugging…". The story of
  how you got here is the one thing the receiver never needs.

### Verify before you build

The load-bearing section. Agents evaluate their own output generously, so a
handoff's "everything works" is a weak signal by construction; separating the
actor from the judge is the fix, and the boundary is already there for free.
Hand over the command and the expected result and let the fresh session be the
judge.

If nothing is runnable, name the cheapest possible check — a URL to load, a
query to run, a file to open. "Trust me" is not a verification step.

### Decisions

Code records _what_, never _why_. This is the single highest-value block for a
receiver deciding whether to keep or overturn an approach. Keep it to decisions
with live consequences — a choice that's now invisible and irreversible isn't
worth a line.

Format: decision, reason, pointer. The pointer matters; a decision the receiver
can't locate in the code is trivia.

### Rejected

Most commonly omitted, most expensive to lose. Without it the next session
cheerfully re-runs your dead end at full cost, and can even land in a loop
across three sessions. One line each: what was tried, why it failed.

Include near-misses ("the fix works but breaks the FK ordering") — those are the
ones a fresh session is most likely to rediscover and mistake for a solution.

### Open questions & blockers

For each: what's unknown, who or what resolves it, and what it's holding up. A
blocker without an owner reads as ambient doom; the receiver needs to know
whether to route around it, escalate it, or wait.

Distinguish _blocked on a human_ (route around, keep working) from _blocked on
information_ (go get it).

### Next action

One thing. A ten-item roadmap gets skimmed, and the receiver picks the item they
find most interesting rather than the one you'd have picked. If the sequence is
genuinely constrained, say so and say why the order binds — otherwise let the
receiver plan; on Claude 5 their plan is usually better than a prescribed one.

### Pointers

The receiver's index into primary sources. Anchor them precisely — `file.ts:42`,
a commit SHA, a PR URL, an exact test name. `src/` is not a pointer.

Prefer pointers to quotes: the model reasons better from the original material
than from your compression of it, and a pointer can't go stale silently the way
a quoted snippet can.

---

## Sizing

| Boundary                   | Target                        |
| -------------------------- | ----------------------------- |
| Subagent → coordinator     | 1–2k tokens, conclusion first |
| Context reset, single task | 300–800 words                 |
| Multi-day project relay    | ≤1500 words                   |

Past those, you're re-exporting the session. The cost isn't only tokens — every
low-value line dilutes the high-value ones, and the receiver's attention is the
scarce resource, not their context window.

## Cutting pass

Before handing off, delete:

- Anything readable from `git log`/`git diff` — replace with the SHA.
- Narrative of how the work unfolded.
- Raw tool output. Keep the conclusion plus the command to regenerate it.
- Restatements of the repo's conventions or structure — CLAUDE.md and the code
  already say it, and your copy will drift from theirs.
- Anything you'd have written for a reader who doesn't exist ("hopefully this
  helps the next session…").
- Instructions the receiver would follow anyway as a competent engineer. Keep
  only real constraints, and keep the _why_ attached.
