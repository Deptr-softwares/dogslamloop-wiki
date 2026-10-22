---
name: silent-release
description: Ship to production without a version number - a silent release of invisible work, an urgent hotfix straight to main when production is broken, or a hotfix note in the Update Log - plus the back-merge that keeps next-update from losing the fix, and when editing an already-pushed migration is correct. Invoke by name when asked to ship quietly, hotfix, or push a fix out without a version bump.
disable-model-invocation: true
---

# Shipping without a version

Side effects: commits, PRs, a live deploy. Run it when asked, not on inference. The `ship-a-release` steps after a merge (`mergedAt`, probing, cleanup) apply here too.

**A version number is never invented to make work feel finished.** Versions come from the roadmap; this skill is what to do instead.

## Which of the three

| | When | Branch | Reader sees |
|---|---|---|---|
| **Silent release** | Real but invisible work: security, internals, schema | `next-update` → `main` | Nothing; the version is unchanged |
| **Hotfix** | Production is broken now and cannot wait for the release | `hotfix/<thing>` → **`main` directly** | Nothing, unless a note is written |
| **Hotfix note** | A visible fix worth telling readers about, with no bump | none: it is content | An entry in the Update Log |

They compose: #97 was a hotfix with no note, and a note can go with a silent release. **The test for silent is "can a reader point at it", not "is it small".** Urgency decides `hotfix/` versus `next-update`; visibility decides whether anything is announced.

## 1. Silent release

Precedent: PR #146, 2026-08-27, which touched neither `data/updates.json` nor `data/site_meta.json`. That absence is the whole mechanism; there is no flag.

- No Update Log entry, no version bump, no Discord post.
- **The devlog still gets its entry**, written by the owner from your change notes. Silent means unannounced, not unrecorded.
- The devlog is not rotated and the version does not close: a silent release ships mid-version work.
- The release PR still gets a preview running the accumulated migrations. Read it, and probe migration-backed work after the merge: a silent release applies migrations exactly as loudly as a versioned one.
- Say in the PR body that it is silent and why, so the missing changelog reads as a decision.

## 2. Hotfix straight to main

Reserve it for production being broken (precedent: PR #97, 2026-08-14, when five v0.14 migrations had failed on production). Branch `hotfix/<thing>`, with no version in the branch or commit subject. CI runs on a PR into `main` and both checks are required: a hotfix is not a reason to merge red.

### The back-merge, which is the part that gets forgotten

After the merge, `next-update` does not have the fix. Open a PR, since direct pushes are rejected:

```bash
git fetch origin
git checkout -b chore/backmerge-<thing> origin/main
gh pr create --base next-update --title "Back-merge the <thing> hotfix"
```

Whether `main` carries work that `next-update` lacks (run after every hotfix and before every release PR):

```bash
git log --oneline --no-merges origin/next-update..origin/main | grep -v 'chore: regenerate'   # empty = clean
```

Without `--no-merges` it always lists the release merges; without the `grep -v` it lists each branch's own regeneration commits. A plain `git diff` between the branches answers a different question. To confirm one specific fix arrived: `git merge-base --is-ancestor <hotfix-commit> origin/next-update`.

### A migration hotfix inverts the immutability rule

| Migration state | What to do |
|---|---|
| **Failed and rolled back**: never applied | Edit the file in place, `npm run lock-migrations`, and say why in the commit |
| **Applied successfully** | Immutable: write a new one |

PR #97 did both. Two failed migrations were edited in place; `list_personnel()` had applied (a PL/pgSQL body resolves columns at run time, not creation time), so it got a new `20260815000000_fix_personnel_joined_at.sql`. Probe production after merging, without exception: a migration hotfix exists because a green preview and production disagreed.

## 3. Hotfix note in the Update Log

The owner posts it, because `site_posts` writes need `is_owner()`, and writes the text. Your part is saying exactly what was fixed and where the note goes: **post-editor.html**, TYPE set to the "Hotfix note" option, status `published`.

It renders above the versioned entries on `/systems/updatelog/index.html` via `window.loadHotfixPosts` (`js/posts.js`). It renders nothing when there are none and fails silently, because the changelog below it is the page's real content. A note is one fix, so it has no three-part split; the voice rules are in the `writing-site-text` skill.
