---
name: ship-a-release
description: Ship work on this project - branch naming, devlog, changelog, Discord post, PR, and post-merge cleanup. Invoke by name when asked to ship, release, or open a PR.
disable-model-invocation: true
---

# Shipping

This has side effects (commits, PRs, branch deletion). Run it when asked, not on inference.

## Naming the branch

**Version numbers come from the roadmap only.** Check `project_dogslamloop_v1_roadmap` in memory before naming anything. A version belongs to a release that is already planned there.

| Work | Branch | Commit subject |
|---|---|---|
| Planned roadmap release | `v0.11-discoverability` | `v0.11: ...` |
| Unplanned fix or cleanup | `fix/sidebar-overflow`, `chore/role-cleanup` | `Fix sidebar overflow` |
| Security fix | `hotfix/<thing>` | no version |

Taking a roadmap number for unplanned work forces a renumbering of everything after it. This project has already renumbered three times; a fourth was narrowly avoided.

## During the work

Append to the current version's devlog at the repo root (`V0.N-DEVLOG.md`) as phases land: a short player-facing line first, then the technical detail. This is the source material for the changelog later.

Full suite green after every phase. `npm test` and `npm run validate`.

## Changelog

`data/updates.json`, newest entry first:

```json
{
  "version": "Beta v0.10",
  "date": "08/08/2026",
  "type": "site",
  "title": "The 'Maintenance' update",
  "description": "One or two sentences, plain language, what a player would notice.",
  "changes": ["Casual, non-technical lines. What changed from the reader's side."]
}
```

Tone: casual, concrete, no jargon. Say what someone would *notice*. A release with nothing user-visible should say so plainly rather than dressing up internals — the owner has explicitly asked for this.

Verify it renders on `/systems/updatelog/index.html` before shipping.

## Discord post

Provide a copy-paste block. Same content as the changelog, reorganised under bracketed headings:

```
v0.10
The 'Maintenance' Update

One or two sentences of context.

[Category]
- change
- change

[Behind the Scenes]
- change
```

Categories are a presentation layer only — `updates.json` has no category field.

## PR

Body should cover: what shipped, anything found along the way that was broken rather than merely missing, decisions a reviewer would otherwise have to reverse-engineer, and an explicit section for what needs the owner **after** merge (live probes, things only they can verify).

## After the owner says they merged

**Verify before deleting anything:**

```bash
gh pr view <N> --json state,mergedAt,mergeCommit
```

`mergedAt` must be non-null. `state: OPEN` with `mergeCommit: null` means it is **not merged**, whatever anyone believes — and deleting the branch of an unmerged PR auto-closes it. When several PRs are open, confirm which number "I merged it" refers to rather than inferring.

Then:

```bash
git checkout main && git pull origin main
git merge-base --is-ancestor <commit> origin/main   # confirm it really landed
git branch -d <branch> && git push origin --delete <branch>
```

**Live-probe anything migration-backed** — migrations apply on merge, so this is the first moment the database matches the code. See the `supabase-migration` skill for the probe procedure.

Rotate the devlog: `git mv V0.N-DEVLOG.md devlogs/` and start the next one.

Update `project_dogslamloop_v1_roadmap` in memory: mark the version shipped with its PR number and merge commit, and note anything deferred.
