---
name: ship-a-release
description: Ship work on this project - branch naming, devlog, changelog, Discord post, PR, and post-merge cleanup. Invoke by name when asked to ship, release, or open a PR.
disable-model-invocation: true
---

# Shipping

This has side effects (commits, PRs, branch deletion). Run it when asked, not on inference.

## Where work lands

**`next-update` is the integration branch. `main` is production.**

GitHub Pages serves `main`, so every merge there is a live deploy that readers
see. Item PRs therefore target `next-update`, and users see one change per
release instead of one per item.

| | target | who sees it |
|---|---|---|
| An item, a fix, a chore | `next-update` | nobody yet |
| A release | `main` | everyone, immediately |

**A release is one PR from `next-update` to `main`**, carrying the changelog
entry and the version bump with it. That PR is the deploy.

Two things follow, and both matter:

- **CI must list the target branch.** `playwright.yml` triggers on `main` and
  `next-update`. A PR targeting a branch not named there runs no tests, and
  GitHub shows it green because nothing ran.
- **Migrations apply on merge to `main`, so a release applies the whole
  accumulated batch at once.** Each was verified alone on its own Supabase
  preview branch; the release PR touches `supabase/` too, so it gets a preview
  branch that runs the entire set together against a fresh copy of production.
  **Read that check before merging a release** — it is the only thing that
  catches two independently-valid migrations conflicting in sequence.

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

Written as part of the release PR, not shipped separately afterwards — the
entry, the version bump and the code all land in the same merge, so the site
never announces a version it is not running.

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

**Get the version bump into the LAST pre-release PR, not after it.**

`data/site_meta.json` holds the version string the site chrome renders, and it
is GENERATED from the `site_meta` row - `regenerate.yml` runs
`fetch-content.js --write`, so a hand-edit is reverted. The bump is therefore
the owner's action in the owner tools (Site Meta -> VERSION), followed by
`npm run refresh-content` here.

That has an ordering consequence which cost an extra merge cycle on v0.17:
**direct pushes to `next-update` are rejected**, so a bump discovered at release
time needs its own PR before the release PR can carry it. Ask for the version to
be set *before* the last item PR, and let `refresh-content` ride along in it.

Check both before opening the release PR - a changelog announcing a version the
header does not show is the thing this ordering exists to prevent:

```bash
node -e "console.log(require('./data/site_meta.json').version)"
node -e "console.log(require('./data/updates.json').changelogs[0].version)"
```

**Ask the owner what to call the update before writing the entry.** The name
is theirs, not a summary to be derived from the diff — v0.12 was drafted as
"The 'Ultimate Mode' update" and the owner renamed it to "The 'General'
update", because they know what the release means to the community and the
changelog does not. One question, before the entry, not after.

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

### Three parts, in this order

**Every release is divided into Features, Fine-tuning, and Bug fixes**
(owner, 2026-09-03). Not free-form categories chosen per release — these three,
in that order, so a reader learns where to look once instead of re-reading the
shape of every update.

| Part | What goes in it |
|---|---|
| **Features** | Something that did not exist before. The reason for the release. |
| **Fine-tuning** | Something that existed and is now better — smaller, clearer, faster, better placed. |
| **Bug fixes** | Something that was broken and now works. |

Two rules that follow from the split rather than from taste:

- **A part with nothing in it is omitted, not left empty.** A release with no
  new features is a fine-tuning release and should read as one.
- **The split does not license internal detail.** Every line still has to be
  something a visitor can picture on the site, and "Bug fixes" is the part most
  likely to tempt an entry about a migration nobody saw. A fix to something
  readers never knew was broken is still one line at the end with the rest of
  the invisible work.

**In `updates.json` a heading is an object, a change is a string:**

```json
"changes": [
  { "heading": "Features" },
  "One visible change per line.",
  { "heading": "Bug fixes" },
  "Another line."
]
```

Additive on purpose. Every entry written before v0.17 is a flat array of
strings and renders exactly as it did — `buildUpdateChangesHTML`
(`js/home_widgets.js`) opens an unheaded list for the first line and starts a
new one at each heading. Same shape as the ticket-chat `type` field: the older
form is the fallback, not a migration.

An object rather than a bare string that happens to read `"Features"`, because a
heading and a change line would otherwise be indistinguishable, and one day
somebody writes a line that reads "Bug fixes".

## Discord post

Provide a copy-paste block. Same content as the changelog, under the same three
headings. Discord markdown, so the asterisks are load-bearing.

```
**v0.10** **The 'Maintenance' Update**

One or two sentences of context.

**[Features]**
change
change

**[Fine-tuning]**
change

**[Bug fixes]**
change
```

- `**` around the version, the title and each heading — that is what bolds them
  in Discord.
- **No hyphens and no bullet characters.** Lines that are already short and
  plain read faster without them.
- Same three parts as the changelog, same order, and a part with nothing in it
  is left out of both.

## PR

Body should cover: what shipped, anything found along the way that was broken rather than merely missing, decisions a reviewer would otherwise have to reverse-engineer, and an explicit section for what needs the owner **after** merge (live probes, things only they can verify).

## Never state a PR URL you have not created

`git push` prints a *"create a pull request"* hint. That is not a PR. On
2026-08-16 a PR number was quoted to the owner from that hint alone, the owner
tracked it for several exchanges as real, and it did not exist —
`gh pr view 103` returned *"Could not resolve to a PullRequest"*.

**The URL in a message must come from the output of `gh pr create`**, never
from the push hint and never from inference. If you did not see `gh pr create`
succeed in this session, check before you cite it:

```bash
gh pr list --state open --json number,title,headRefName
```

Same discipline as `mergedAt` below: repo state is read, not remembered.

## A fix you described is not a fix you committed

On 2026-08-16 the owner reported a bug, it was found, fixed, tested and
falsified — and then reported to them as done while the change sat unstaged.
They merged the PR. The fix was not in it, and the bug they had reported was
still live on `next-update`.

Nothing in the conversation was untrue. The gap was between "the work is
finished" and "the work is in the commit", and only `git status` knows which.

**Before telling the owner a fix is ready, confirm it is actually in the
branch:**

```bash
git status --short          # nothing of the fix should be unstaged
git log --oneline -1        # and the commit should exist
```

The same check belongs before any claim that a PR contains something. `git
diff <base>...<head> --stat` answers it exactly, and costs one command.

## A merged PR's branch is closed to new work

**Once a PR is merged, commits pushed to its branch are orphaned.** The PR does
not pick them up, the merge commit does not contain them, and deleting the
branch afterwards drops them on the floor.

This has happened twice, both times the same way: work continued on a branch,
the owner merged the PR mid-stream, later commits were pushed to the same
branch, and the branch was then deleted as "merged".

Two rules:

- **Before committing to a branch that already has a PR, check the PR is still
  open.** `gh pr view <N> --json state,mergedAt`. If it is merged, branch fresh
  from the updated integration branch instead.
- **`git branch -d` prints `not yet merged to HEAD` when the branch holds
  commits the target does not.** That warning is the whole signal. It still
  deletes the branch. Do not skim past it — read it, and recover the commits
  (`git cherry-pick <sha>`; the objects survive locally until gc) before
  carrying on.

Recovery is possible but only until the objects are collected, and only on the
machine that made them. Prevention is one command.

## Keep working while a PR runs its checks

CI takes ~13 minutes and the owner merges by hand, so a PR is open for a long
time. **Do not wait on it.** Start the next batch as soon as the PR is opened
(owner, 2026-09-03).

The whole workflow is four steps:

1. **Open the PR.** That branch is now frozen — a push restarts its CI, which is
   the exact cost this avoids.
2. **Branch immediately for the next batch.** From `next-update` when the new
   work is independent, which it usually is. From the open PR's branch only when
   the new work genuinely builds on it — F5 needed `can_review_page` from the
   branch in flight, so it stacked.
3. **Build, test and commit as normal.** Do not push, and do not open a second
   PR: two open PRs is the owner reviewing two things at once, which is what
   they asked to avoid.
4. **When the owner says the PR merged**, verify `mergedAt`, delete the merged
   branch, `git rebase next-update`, re-run the derived specs, push, open the
   next PR.

**A stacked branch will conflict, and the conflict is normal.** Generated files
are the usual cause — `supabase/migrations.lock.json` and the stamped script
tags — because both branches regenerate them. **Regenerate, never hand-merge:**
`npm run lock-migrations`, `npm run generate`. A hand-merged lock file is a lock
file that no longer describes the migrations.

For a hand-written conflict, read both sides before choosing. Two branches
appending a CSS block to the same file both want to keep their block; taking
one side silently drops a feature that was already reviewed and merged.

**Re-run the derived specs after every rebase, not just before the push.** The
rebase pulls in work the tests have never run against.

**The one thing that must not slip:** check the PR is still open before
committing to its branch. Working ahead means there is always an open PR
somewhere, so `git branch --show-current` and `gh pr view <N> --json state`
before a commit is cheap insurance against the orphaning above.

## After the owner merges an item into `next-update`

Nothing is live yet, so there are no probes to run and no version to bump.
Delete the item branch once `mergedAt` is confirmed non-null, and carry on.

Migrations merged here have **not** reached production. Anything database-backed
stays broken on the live site until the release, which is expected rather than a
regression to chase.

## After the owner merges a release into `main`

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

**Live-probe anything migration-backed** — migrations apply on merge to `main`,
so this is the first moment production matches the code, and it covers every
migration accumulated since the last release rather than one.

A green PR proves the client half works against mocks; it says nothing about
whether the SQL ran. v0.13's capability migration failed with `42P13`, rolled
back, and left a green PR and an empty database. See the `supabase-migration`
skill for the probe procedure.

Rotate the devlog: `git mv V0.N-DEVLOG.md devlogs/` and start the next one.

Update `project_dogslamloop_v1_roadmap` in memory: mark the version shipped with its PR number and merge commit, and note anything deferred.
