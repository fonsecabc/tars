---
name: handoff
description: >-
  Write or consume a context handoff — the artifact that carries work across a
  boundary where context does not survive: a new session, a context reset or
  /clear, a fresh worktree, a subagent returning to its coordinator, a different
  model, or a human picking up where an agent stopped. Use it when the user says
  "hand this off", "write a handoff", "I'm starting a new session", "prep this
  for the next agent", "context is about to run out", "resume from where we left
  off", or when you are about to end a long session with work unfinished. Also
  use it when authoring the *receiving* side — a boot prompt, a subagent return
  contract, or a session-start orientation step. Engineered for Claude 5 models
  (Opus 5, Fable 5), which read pointers better than prose and over-react to
  forceful boilerplate.
---

# Handoff

A handoff is a **work order for the next actor**, not a summary of the last one.
Summaries look backward and optimize for completeness; handoffs look forward and
optimize for the receiver's next action. Every line earns its place by changing
what the receiver does — otherwise it is context tax on a fresh window.

Three shapes, same discipline:

| Shape               | Boundary                                                  | Weight                                                   |
| ------------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| **Context reset**   | same work, new window (`/clear`, compaction, new session) | heaviest — the receiver has no other memory              |
| **Subagent return** | worker → coordinator                                      | lightest — conclusion-first, ~1–2k tokens                |
| **Relay**           | different agent, model, repo, or human                    | medium + environment/setup, since defaults aren't shared |

## The one rule that matters

**Carry what cannot be re-derived. Point at everything else.**

Anything the receiver can read from git, the filesystem, the test suite, a PR,
or a ticket is a _pointer_ — a path, a `file.ts:42`, a commit SHA, a PR URL, a
test name. Re-writing it in prose costs tokens, goes stale, and strips the
evidence the model reasons from. Compressed summaries measurably degrade
downstream reasoning versus letting the model reach the original material.

What genuinely cannot be re-derived, and so _is_ the payload:

- **Why** a decision went the way it did (the code shows what, never why).
- **Dead ends** — what was tried and rejected, with the reason. This is the most
  expensive thing to lose and the thing most handoffs omit.
- **Constraints the user stated in conversation** and nowhere else.
- **Environment quirks** discovered the hard way (this port is dead, that job
  needs a QR re-scan, this migration must run before that one).
- **Current intent** — the thing being attempted right now, mid-flight.

## Writing one

Load `references/template.md` for the artifact and the per-field reasoning.
The short version — eight sections, and you delete the ones that are empty
rather than filling them with "N/A":

Objective · State · Verify-before-you-build · Decisions (with why) · Rejected ·
Open questions & blockers · Next action · Pointers

Two conventions do most of the work:

- **Mark provenance inline.** `(verified: pnpm test, 14:20)` vs `(assumed)`.
  The receiver will trust this document; an unmarked guess reads as fact and
  gets built on. A stale line stated confidently is worse than no line.
- **Give a verification command, not a status claim.** Agents grade their own
  work generously — separating the doer from the judge is the known fix, and a
  handoff is exactly that separation. Hand over the command and its expected
  output, and let the receiver re-derive the verdict.

## Reading one

A received handoff is **a claim from a prior session, not ground truth**. Boot
in this order — orient, verify, then act:

1. Read the handoff and the pointers it names (git log, the diff, the failing
   test).
2. Run the verify step. Reconcile anything that contradicts the document; live
   state wins, and say so out loud when it does.
3. Only then start new work.

Skipping step 2 is how a session spends an hour building on a state the previous
one broke. If the handoff has no verify step, invent one before you trust it.

## Prompt engineering for Claude 5 receivers

Claude 5 models are steerable and read intent well; the handoff patterns that
worked on weaker models now actively hurt.

- **Write to a capable colleague.** Drop `CRITICAL:` / `YOU MUST` / `NEVER`
  padding — on modern models it causes rigid over-triggering, and it crowds out
  the one instruction that genuinely overrides a default.
- **State intent, not a script.** "Get the migration promoted; ordering is an FK
  chain so 0088→0089→0091 must go in sequence" beats a numbered ten-step plan.
  Claude 5's own plan is usually better than the one you'd hand it, and a rigid
  script caps it. Prescribe steps only where the order is a real constraint —
  and then say why it is.
- **Pointers over re-description.** Claude 5 handles high-fidelity references
  well: link the real test, the real diff, the real rubric instead of prose
  about them.
- **No example walls.** Worked examples narrow the exploration space here. One
  example only if it carries something no principle states.
- **Say it once.** Repeating an instruction in three sections doesn't reinforce
  it; it just makes the document longer and the signal flatter.
- **Size to the boundary.** Subagent return ~1–2k tokens; a session reset
  300–800 words; a multi-day project handoff rarely past 1500. Past that you are
  re-exporting the session, and the noise costs more than the coverage buys.
- **Don't inherit anxiety.** Old handoffs often warn "context is nearly full,
  wrap up fast." Opus 4.5+ largely dropped that premature-wrap behavior; writing
  it into a handoff re-introduces it. Say what's left, not how rushed you feel.

## Where the artifact lives

Default to the **session scratchpad**, not the repo. A handoff is disposable
scaffolding with a lifetime of one boundary crossing.

That respects Tars's "brain over Markdown" rule rather than breaking it: the
handoff is a transient work order, while anything durable — a decision and its
rationale, a project's state, a fact about a person or system — goes into the
brain via the `memory_*` tools as you write the handoff. If a fact would still
matter next month, it belongs in the graph; the handoff only needs to point at
it.

Write into the repo (`.claude/handoffs/`, a PR body, a ticket comment) only when
the receiver is a human or an agent on another machine that can't reach the
scratchpad — and say where you put it.

## References

- `references/template.md` — the artifact, field by field, with the reasoning
  for each field and what to cut.
- `references/patterns.md` — subagent return contracts, boot prompts for the
  receiving side, multi-session relays, parallel worktrees, and the failure
  modes worth checking a draft against.
