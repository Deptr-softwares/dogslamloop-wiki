---
name: silent-release
description: Ship to production without a version number - a silent release of invisible work, an urgent hotfix straight to main when production is broken, or a hotfix note in the Update Log. Invoke by name when asked to ship quietly, hotfix, or push a fix out without a version bump. Covers the back-merge that keeps next-update from losing the fix, and when editing an already-pushed migration is correct.
disable-model-invocation: true
---

# Shipping without a version

Side effects — commits, PRs, a live deploy. Run it when asked, not on inference.

`ship-a-release` covers the versioned path and is not repeated here. **Its
`mergedAt`, PR-URL and branch-deletion rules apply to everything below** —
read them there rather than assuming this file relaxes them.

The one rule this skill exists to protect: **a version number is never invented
to make work feel finished.** Versions come from the roadmap. Everything here
is what you do instead.

## Which of the three

| | When | Branch | Reader sees |
|---|---|---|---|
| **Silent release** | Work that is real but invisible. Security, internals, schema. | `next-update` → `main` | Nothing. Version unchanged. |
| **Hotfix** | Production is broken *now* and cannot wait for the release. | `hotfix/<thing>` → **`main` directly** | Nothing, unless a note is written. |
| **Hotfix note** | A visible fix worth telling readers about, with no version bump. | none — it is content | An entry in the Update Log. |

They compose. A hotfix branch usually ships with no note (#97 fixed migration
internals nobody could see). A note can accompany a silent release with no
hotfix branch at all.

**The test for silent is not "small", it is "can a reader point at it".** If
they can, it wants a changelog line, and a changelog line wants a version — so
it waits for the release or it gets a hotfix note. Urgency decides `hotfix/`
versus `next-update`; visibility decides whether anything is announced. Those
are two separate questions and answering one does not answer the other.

---

## 1. Silent release

Precedent: **PR #146, `next-update` → `main`, 2026-08-27**, *"Silent release:
the owner/admin split, and four security fixes"*. 100 files changed, touching
**neither `data/updates.json` nor `data/site_meta.json`**. That absence is the
entire mechanism — there is no silent-release flag anywhere.

Identical to a normal release except:

- **No entry in `data/updates.json`.**
- **No version bump.** `data/site_meta.json` is generated from the `site_meta`
  row; leaving it alone means the site keeps rendering the version it already
  showed. That is correct, not a stale artifact.
- **No Discord post.** There is nothing to tell anyone.

Everything else still happens:

- **The devlog still gets its entry.** Silent means unannounced, not
  unrecorded. Write it in the version's own voice as usual.
- **The devlog is NOT rotated and the version does NOT close.** A silent
  release ships mid-version work; the current `V0.N-DEVLOG.md` stays at the
  root and that version is still open afterwards. The 2026-08-27 silent
  release applied five migrations — the entire owner/admin role split, which
  is v0.17 work — and v0.17 itself shipped a week later with five more.
- **The release PR still touches `supabase/`, so it still gets a preview
  branch running the accumulated migrations in sequence.** Read that check.
  It is the only thing that catches two independently-valid migrations
  conflicting, and being unannounced does not make it optional.
- **Live-probe anything migration-backed after the merge.** Migrations apply
  on merge to `main`. A silent release applies them exactly as loudly as a
  versioned one.

Say plainly in the PR body that it is a silent release and why nothing is
announced, so the absence of a changelog reads as a decision rather than an
oversight.

---

## 2. Hotfix straight to `main`

Precedent: **PR #97, `hotfix/migration-42703` → `main`, 2026-08-14** — five of
v0.14's migrations had failed on production and three features were inert.

**Reserve this for production being broken.** Going around `next-update` means
the fix deploys without the integration branch ever having held it, which is
the whole point and also the whole cost.

Branch `hotfix/<thing>`. **No version in the branch name and no version in the
commit subject.**

CI does run: `playwright.yml` triggers on `pull_request: branches: [main,
next-update]`, and that filter names the *base*, so a PR into `main` runs the
full suite. Both branches also require `Supabase Preview`. **A hotfix is not a
reason to merge red.**

### The back-merge, which is the part that gets forgotten

After merging into `main`, **`next-update` does not have the fix.** Work
continues there against still-broken code, and the next release PR merges a
branch that never contained it.

In 2026-08-14 this was never done deliberately. `1f607ee` reached
`next-update` only because PR #98 (`chore/rotate-devlog`) happened to be cut
from `main` afterwards and carried it along. That was luck.

Open a real PR — direct pushes to `next-update` are rejected, so this needs
one:

```bash
git fetch origin
git checkout -b chore/backmerge-<thing> origin/main
gh pr create --base next-update --title "Back-merge the <thing> hotfix"
```

**Two obvious checks both give the wrong answer here.** `git log
origin/next-update..origin/main` *always* lists the release merge commits —
four of them right now (#156, #146, #137, #123) — so it never reads clean. And
a plain `git diff origin/main origin/next-update` is non-empty almost always,
because `next-update` is legitimately ahead of `main` between releases; it
answers a different question in both directions at once.

The question is directional and narrow: **does `main` carry work that
`next-update` does not?** Exclude the merge commits and it is exact:

```bash
git log --oneline --no-merges origin/next-update..origin/main   # empty = clean
```

Anything listed is a hotfix stranded on `main`. Replayed at the moment #97
landed (`git log --oneline --no-merges 61b73ee..1f607ee`) it names both hotfix
commits, which is how you know the check reads a real signal rather than always
being empty.

Run it after every hotfix, and again before opening a release PR. To confirm
one specific fix arrived, the project's usual verification is exact and
cheaper:

```bash
git merge-base --is-ancestor <hotfix-commit> origin/next-update
```

### A migration hotfix inverts the immutability rule

The `supabase-migration` skill says a migration is immutable once pushed and
you change it by writing a new one. **A migration that failed and rolled back
never applied, so there is nothing immutable about it** — it is the one case
where editing the file in place is right.

PR #97 did both, deliberately, and the split is the rule:

| Migration state | What to do |
|---|---|
| **Failed and rolled back** — never applied | Edit the file in place. |
| **Applied successfully** | Immutable. Write a new one. |

`20260813000005` and `20260814000001` had failed, so they were edited.
`list_personnel()` had applied cleanly — its bad column reference sat inside a
PL/pgSQL body, which resolves columns at run time rather than creation time —
so it got a **new** migration, `20260815000000_fix_personnel_joined_at.sql`,
instead. `tests/migration-columns.spec.js` was written in the same PR and
carries an allowlist for exactly the already-applied files that could not be
edited.

Editing a pushed migration means `supabase/migrations.lock.json` no longer
describes it and `npm run validate` fails. That is the lock file doing its
job — it was created in `23f26ee` *as a response to this incident*. Re-lock and
say why in the commit:

```bash
npm run lock-migrations
```

**Probe production after merging, without exception.** This is the case where
the preview check has already been proven least trustworthy: the only reason a
migration hotfix exists is that a green preview and production disagreed.

---

## 3. Hotfix note in the Update Log

**This is the owner's action, not yours.** The `site_posts` write policy is
`is_owner()` (`20260827000003_owner_role.sql:702`) — admin is not enough. Your
part is to draft the text and tell them where it goes.

Where: **post-editor.html**, TYPE → *"Hotfix note — appears in the Update
Log"* (`post-editor.html:87`), status `published`.

It renders above the versioned entries on `/systems/updatelog/index.html`,
styled to match them, via `window.loadHotfixPosts` (`js/posts.js:158`). Two
behaviours worth knowing before promising anything: it renders **nothing at
all** when there are none, and it **fails silently** rather than showing an
error, because the real changelog below it is the page's actual content.

The body is the same block array the wiki uses everywhere, so a note can carry
images and callouts — that is why `description.js` and `internalstyling.js` are
loaded on that page.

**The changelog's voice rules apply unchanged** — see `ship-a-release`. The
reader is a player, never the owner; no "you"; something they can picture on
the site. A note is one fix, so it does not take the three-part Features /
Fine-tuning / Bug fixes split. Title it as the fix.

---

## Never, in any of the three

- **Never take a roadmap version number for this work.** That is the failure
  this whole skill routes around. `hotfix/` and `chore/` branches carry no
  version, and their commit subjects carry no version.
- **Never bump `data/site_meta.json` by hand.** It is generated from the
  `site_meta` row and `regenerate.yml` reverts hand-edits. If a version really
  does need to move, that is a release, and it is the owner in the owner tools
  followed by `npm run refresh-content`.
- **Never leave a fix stranded on `main`.** `git log --oneline --no-merges
  origin/next-update..origin/main` must be empty before a hotfix counts as
  finished.
- **Never skip the live probe on a migration.** Silent and urgent both apply on
  merge to `main`, exactly like a release.
