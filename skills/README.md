# Agent skills

Skills Tars ships for the agent that drives it. Unlike [`docs/routines/`](../docs/routines/),
which are prompts you paste into a scheduled task, a skill is loaded on demand by the agent
when the work matches its description.

| Skill                         | What it does                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`handoff`](handoff/SKILL.md) | Write or consume a context handoff — the work order that carries a task across a session reset, a fresh worktree, a subagent return, or a change of model. |

## Installing

Skills live in a directory the agent scans. For Claude Code, copy the one you want into
`~/.claude/skills/` (available in every project) or `<repo>/.claude/skills/` (that repo only):

```bash
cp -r skills/handoff ~/.claude/skills/
```

Other hosts differ; point yours at `skills/<name>/SKILL.md`. Each skill is plain Markdown with
YAML frontmatter — `name` and `description` — and the description is what the agent matches
against, so keep it if you fork one.

## Why `handoff` ships with Tars

A memory server and a handoff solve adjacent halves of the same problem. The brain holds what
stays true — decisions, people, project state — and a handoff holds what is only true right
now: the half-finished migration, the command that proves it, the dead end not to re-run. The
skill leans on that split, writing durable facts into the graph via the `memory_*` tools and
keeping the artifact itself disposable.
