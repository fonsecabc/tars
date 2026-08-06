# Agent skills

Skills Tars ships for the agent that drives it. Unlike [`docs/routines/`](../docs/routines/),
which are prompts you paste into a scheduled task, a skill is loaded on demand by the agent
when the work matches its description.

| Skill                                         | What it does                                                                                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`handoff`](handoff/SKILL.md)                 | Write or consume a context handoff: the work order that carries a task across a session reset, a fresh worktree, a subagent return, or a change of model. |
| [`instagram-watch`](instagram-watch/SKILL.md) | Watch an Instagram post or reel and report what is in it: transcript, on-screen text, setting, shot structure, caption, comment pattern. Runs locally.    |

## Installing

Skills live in a directory the agent scans. For Claude Code, copy the one you want into
`~/.claude/skills/` (available in every project) or `<repo>/.claude/skills/` (that repo only):

```bash
cp -r skills/handoff ~/.claude/skills/
```

Other hosts differ; point yours at `skills/<name>/SKILL.md`. Each skill is plain Markdown with
YAML frontmatter — `name` and `description` — and the description is what the agent matches
against, so keep it if you fork one.

A skill may bundle a helper script next to its `SKILL.md` when the work needs one, as
`instagram-watch` does. Copy the whole directory rather than the Markdown alone, and check that
skill's requirements: bundled scripts call local tools the skill does not install for you.

## Why `handoff` ships with Tars

A memory server and a handoff solve adjacent halves of the same problem. The brain holds what
stays true — decisions, people, project state — and a handoff holds what is only true right
now: the half-finished migration, the command that proves it, the dead end not to re-run. The
skill leans on that split, writing durable facts into the graph via the `memory_*` tools and
keeping the artifact itself disposable.

## Why `instagram-watch` ships with Tars

Tars promises that your data stays on your machine, and an ingest path is where that promise
usually breaks: the easy way to read a video is to hand it to somebody else's API. This skill
does the whole job locally, so a post you watch leaves no trace with a third party, and whatever
you keep from it lands in your own graph. It also refuses to pretend: the report states how many
frames it actually looked at, so the agent reading it can tell watching from guessing.
