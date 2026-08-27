---
name: checkpoint
description: Use before the user compacts or ends a session, at a version or phase boundary, or when they ask to checkpoint, save state, or hand off. Writes what a compact actually loses - why decisions went the way they did, what was verified against real state versus assumed, what is in flight, and the next concrete action - into the devlog and memory in a fixed shape.
---

# Checkpointing a session

A compact keeps **facts** and loses **why**. The summary will carry what was
built; it will not reliably carry that an approach was tried and rejected, that
a claim was assumed rather than checked, or that a PR is green but unmerged.

This works when the devlog and memory are already current at the moment of the
compact. That is the whole job here.

## Read the real state first. Do not checkpoint from recollection.

```bash
git status --short --branch
git log --oneline -5
gh pr list --state open --json number,title,headRefName,baseRefName
gh pr view <N> --json statusCheckRollup,mergedAt,mergeCommit
```

*"I think that merged"* is the exact belief that once deleted an unmerged PR's
branch and auto-closed it. If the checkpoint says a PR is merged, that came
from `mergedAt`, not from memory.

## What actually gets lost — capture these five

1. **Decisions and their reasons**, including what was rejected and why. "We
   chose X" is worth a fraction of "we chose X because Y made Z impossible."
2. **Verified versus assumed.** Mark which claims were checked against live
   data, the database, or the code, and which are still hypotheses. An
   unmarked hypothesis becomes a fact after one compact.
3. **In flight.** Open PRs with their numbers and check status, the current
   branch, anything uncommitted, anything waiting on the owner.
4. **Corrections.** What was believed earlier in the session and turned out
   wrong. These are the highest-value lines in any checkpoint, because the
   summary tends to carry the original belief rather than the correction.
5. **The next concrete action.** Not "continue v0.15" — the actual next step.

## Where each piece goes

| What | Where |
|---|---|
| The engineering record of the current version | `V0.N-DEVLOG.md` at the repo root |
| In-flight state, open decisions, next action | memory: `project_dogslamloop_session_state` |
| A version shipping, or scope moving between versions | memory: `project_dogslamloop_v1_roadmap` |
| A rule that should hold in *every* future session | `AGENTS.md`, or the relevant skill — **not** memory |
| Feedback on how to work | memory: a `feedback_*` file, with the why |

**The repo holds, memory points.** If the full scope is in `V0.15-DEVLOG.md`,
memory gets a pointer plus only what the devlog does not say — the decisions
behind the list, not the list. Duplicating it guarantees the two drift and then
contradict each other.

Anything a future session must not get wrong belongs in `AGENTS.md` or a skill,
because those load without being recalled. Memory is retrieved on relevance and
may not surface.

## The shape

Rewrite `project_dogslamloop_session_state` rather than appending — it is a
checkpoint, not a log. Keep it under roughly 60 lines.

```markdown
**<version> status.** One sentence: shipped / in progress / scoped.

## In flight
PR #N — <branch>, <check status>, waiting on <who>. What it does in a line.
Anything uncommitted, and why it is not committed.

## Decided this session
One line each, with the reason. Include what was rejected.

## Corrections
What was believed, what is actually true, and how it was established.

## Still open
Each with an owner. Mark clearly if it is the owner's call, not mine.

## Next
The concrete next action.
```

Update the devlog in the version's own voice — a short player-facing line
first, then the technical detail. That file is the source material for the
changelog later, so writing it as a diff summary makes the release harder.

## Rules

- **Absolute dates.** "Yesterday" is meaningless to the session that reads it.
- **Mark confidence.** "Verified against production", "confirmed in the code at
  `file:line`", "hypothesis, untested" — all three are useful; an unmarked
  claim is not.
- **Keep corrections in.** Do not tidy away a wrong turn; it is the thing most
  likely to be repeated.
- **Name the owner of every open item.** Half of them are the owner's to do,
  and a checkpoint that blurs that produces a session waiting on itself.
- **If a new memory file is created, add its one-line pointer to `MEMORY.md`.**
  A memory not in the index is a memory that will not be recalled.

## What not to write

- **A transcript summary.** The harness already does that, better.
- **The diff.** `git log` holds it and holds it exactly.
- **Anything the repo already records** — code structure, what a file does,
  what shipped in an older version. Those are in the code and the devlogs.
- **Speculation about future versions.** Scope belongs in the roadmap once the
  owner has set it, not in a checkpoint.

## Finally

Say in one line what was written and where, so the owner can see the handoff
exists rather than trusting that it does.
