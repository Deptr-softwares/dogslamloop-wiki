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
  "description": "One or two sentences. What changed about the site.",
  "changes": ["One visible change per line."]
}
```

**The reader is a player using the wiki. Not the owner, and not you.**

The v0.12 entry was rewritten because it failed this. It read as a summary of
the dev log: it announced page types nobody sees, it listed the merge compiler
and a caching bug, and it said "you" over and over when the only person "you"
could mean was the owner. That is the failure mode to watch for — the work you
found hardest is not the work a reader noticed.

Five rules:

1. **Every line is something a visitor can picture on the site.** If a reader
   cannot point at where it changed, it does not get a line.

2. **Never write "you" for the owner.** "A page you create now works
   immediately" is addressed to one person. Write about the site instead:
   "Character portraits are now 1:1."

3. **Casual means simple and short, not jokey.** No "that's a big one", no
   "nobody loses their head to it". No explaining an internal problem the
   reader has never seen — they have not read the scripts and would not
   recognise them.

4. **Numbers are good. Use them.** "Skill card media is now 1:1, unless the
   uploaded file is 3:2 or wider, which keeps the 16:9 box" beats any
   adjective describing the same thing.

5. **Everything invisible collapses into one line** at the end: "Changed a few
   things under the hood." Not one line per internal fix. And when a change has
   both an invisible cause and a visible result, write the result — the Others
   and Tools columns are the change; the page types behind them are not.

A release with nothing user-visible should say so plainly rather than dressing
up internals — the owner has explicitly asked for this.

Verify it renders on `/systems/updatelog/index.html` before shipping.

## Discord post

Provide a copy-paste block. Same content as the changelog, grouped under
headings. Discord markdown, so the asterisks are load-bearing.

```
**v0.10** **The 'Maintenance' Update**

One or two sentences of context.

**[Category]**
change
change

**[Category]**
change
```

- `**` around the version, the title and each `[Category]` — that is what
  bolds them in Discord.
- **No hyphens and no bullet characters.** Lines that are already short and
  plain read faster without them.
- Categories are a presentation layer only — `updates.json` has no category
  field.

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
