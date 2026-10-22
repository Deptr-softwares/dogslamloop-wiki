---
name: ship-a-release
description: Release next-update to production - the version bump, the owner's Update Log entry, the release PR from next-update to main, the Discord post, and what to verify and clean up after the owner merges. Invoke by name when asked to ship or release.
disable-model-invocation: true
---

# Shipping a release

Side effects: commits, a PR, a live deploy. Run it when asked, not on inference. Branch naming, PR rules and change notes are in `CLAUDE.md` and apply here unchanged. For quiet releases and hotfixes, use `silent-release` instead.

## Before the release PR

1. **The version bump goes in the LAST item PR, not after it.** `data/site_meta.json` is generated from the `site_meta` row, so the bump is the owner's edit in owner tools (Site Meta -> VERSION) followed by `npm run refresh-content`. Direct pushes to `next-update` are rejected, so a bump found missing at release time needs a PR of its own (v0.17 lost a merge cycle to this). Ask the owner to set it before the last item PR, and let `refresh-content` ride in that PR.
2. **Commit the owner's devlog in that same last item PR.** `V<x.y>-DEVLOG.md` stays untracked until now; stage it exactly as they wrote it, with no edits.
3. **The owner writes the entry, name included.** Read the whole devlog, pull out every change a reader can see, and give them that list sorted into Features, Fine-tuning and Bug fixes, with the invisible work as one line. Put their entry into `data/updates.json` as written, in the shape in the `writing-site-text` skill's [update-log.md](../writing-site-text/update-log.md). Fix only plain slips (v0.20: "every videos" to "every video") and list them.
4. **Check the header and the entry agree:**
   ```bash
   node -e "console.log(require('./data/site_meta.json').version)"
   node -e "console.log(require('./data/updates.json').changelogs[0].version)"
   ```
5. **Check no hotfix is stranded on `main`**: the back-merge check in `silent-release`.

## The release PR

- One PR from `next-update` to `main`, carrying the entry and the bump with the code, so the site never announces a version it is not running.
- It touches `supabase/`, so it gets a preview that runs every accumulated migration in sequence. **Read that check before the owner merges.** It is the only one that catches two individually valid migrations conflicting.
- Expect conflicts on generated stubs and `supabase/migrations.lock.json`: regenerate, never hand-merge.
- Verify the entry renders on `/systems/updatelog/index.html`.

## The Discord post

When the owner asks, render their entry from `data/updates.json` after they have seen it, in the layout in [update-log.md](../writing-site-text/update-log.md). Their lines, unchanged.

## After the owner merges the release

1. `gh pr view <N> --json state,mergedAt,mergeCommit`. `mergedAt` must be non-null. With several PRs open, confirm which one "I merged it" means.
2. `git checkout main && git pull origin main`, then `git merge-base --is-ancestor <commit> origin/main` to confirm it landed.
3. **Probe everything migration-backed on production** (the `supabase-migration` skill, `probing.md`). This is the first moment production matches the code, for every migration since the last release. A green PR proves only the client half against mocks: v0.13's migration failed with `42P13`, rolled back, and left a green PR and an empty database.
4. Delete the branch, locally and on the remote.
5. **Ask before rotating the devlog** (`git mv V<x.y>-DEVLOG.md devlogs/`). The file is the owner's, and so is starting the next one.
6. Update `project_dogslamloop_v1_roadmap` in memory: shipped, PR number, merge commit, anything deferred.
