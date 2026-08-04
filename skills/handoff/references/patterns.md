# Handoff patterns and failure modes

## Choosing the mechanism

Four ways to cross a context boundary. Pick the lightest that holds.

- **Compaction** — summarize in place, same agent continues on a shortened
  history. Cheapest, preserves conversational continuity, but no clean slate.
  Right for one long thread with lots of back-and-forth.
- **Context reset + handoff** — clear the window entirely, boot a fresh agent
  from the artifact. Costs a well-written handoff; buys a clean slate and drops
  accumulated confusion. Right at a natural milestone.
- **Structured note-taking** — persist state to a file as you go and pull it
  back when needed. Right for iterative work with clear checkpoints, and it
  makes the eventual handoff nearly free.
- **Subagents** — each works in its own clean window and returns a distilled
  result. Right when subtasks are separable and their detail shouldn't pollute
  the coordinator.

These compose. A long build usually runs note-taking throughout, subagents for
side quests, and a reset + handoff at each milestone.

On model generation: Sonnet 4.5 showed pronounced _context anxiety_ — wrapping
up prematurely as the window filled — which made resets mandatory. Opus 4.5 and
the Claude 5 family largely dropped that behavior, so resets are now a
deliberate choice for a clean slate rather than a workaround. Don't schedule
them reflexively, and don't write the anxiety into the artifact.

## Subagent return contracts

A subagent's final message _is_ the handoff. Specify it in the spawn prompt, in
the task description, not as an afterthought:

- **Conclusion first.** The coordinator often reads only the first lines.
- **Findings, not transcript.** No search-path narration, no "I looked at X then
  Y". What's true, and where it lives.
- **Every claim anchored** — `file.ts:42`, so the coordinator can verify without
  redoing the search.
- **Negative results stated explicitly.** "No caller of `foo()` outside tests"
  is a finding. Silence reads as "didn't look".
- **Say what wasn't covered.** A subagent that hit a wall and returns a
  confident partial answer is worse than one that names the gap.

Where the shape must be exact, use a schema instead of prose instructions — a
typed return beats asking nicely for one, and it survives a distracted worker.

## Boot prompt for the receiving side

A handoff is only half the contract. When you control the receiving prompt:

```
Read <handoff path>. It is a claim from a prior session, not ground truth —
verify before building on it.

1. Read the handoff and open the pointers it names.
2. Run its verify step. If it fails, fix that first; if live state contradicts
   the document, live state wins — say so, and correct the record.
3. Then start on its Next action.
```

Three properties make that work: it names the trust level, it forces
verification before construction, and it says what to do on conflict. Handoffs
rot; the receiving side has to assume rot rather than discover it.

For persistent state (a brain, a memory store, a ticket system), add:
reconcile what you find against the store and correct stale entries — otherwise
the same wrong fact gets handed forward indefinitely.

## Multi-session relays

Work spanning many sessions needs a durable spine, not a chain of handoffs.
Chained handoffs are lossy compression applied repeatedly; by session four the
original constraints are gone.

Keep one **living state file** the sessions update in place — a checklist of
work items with a status field, or the brain — and let each handoff be a thin
pointer to it plus what changed. Anthropic's long-running-agent harness used a
feature list with a `passes` boolean per item, guarded by an instruction that
entries may only have their status changed, never be removed or edited: an agent
that can delete its own acceptance criteria will eventually delete the failing
ones. Guard whatever plays that role the same way.

## Parallel worktrees

Agents working the same repo in parallel need in their handoff:

- Which worktree/branch they're on, and what's uncommitted in it.
- What they touched that others might also touch (a shared migration number, a
  lockfile, a generated type).
- Merge order, if it binds — and why.

Commit before handing off where you can. "Uncommitted changes in worktree X"
is a handoff that decays into a lost afternoon.

## Failure modes

Check a draft against these before sending it.

**Stale stated as current.** Fixed by inline provenance and a timestamp. A
handoff that says "tests pass" without saying when is unusable within a day.

**Conclusions without evidence.** "The bug is in the retry logic" with no
pointer — the receiver either trusts it blindly or redoes the whole diagnosis.

**Aspirational next steps.** "Refactor the auth layer" when the actual next
action is "the test at auth.test.ts:88 fails on the third retry — fix that".
Write the real next action, however small.

**Self-graded completion.** "Everything works" is the claim an agent is least
able to make about its own output. Replace with a command and its expected
result.

**Raw dumps.** Pasted logs, full file contents, whole tool outputs. Keep the
conclusion and the command that regenerates it.

**Dead ends omitted.** The receiver re-runs your failed approach at full cost.

**Forceful padding.** `CRITICAL: YOU MUST NOT` throughout. On Claude 5 this
produces rigid, over-triggered behavior and flattens the one instruction that
genuinely needed the emphasis.

**Re-export instead of handoff.** 4000 words restating the session. The receiver
skims it, and the skimmed version is worse than a tight 500 words.

**Answering questions nobody asked.** Scope, context, and background the
receiver's task never touches. If a line doesn't change what they do, cut it.
