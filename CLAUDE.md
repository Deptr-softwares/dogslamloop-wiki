# dogslamloop-wiki

A technical wiki for **Jujutsu Shenanigans**, a competitive Roblox fighting game. Modelled on dustloop.com but for a 3D fighter whose mechanics differ substantially from 2D ones — don't assume dustloop conventions map across.

Frame data, i-frames, matchup tiers and M1 trading are domain terms with real gameplay meaning to the community that maintains them. When touching frame-data rendering, tier logic, matchup content or colour coding, sanity-check against fighting-game conventions (startup/active/recovery, block/hit advantage) rather than treating it as generic data.

## Stack

- Static HTML/CSS/JS. **No bundler, no build step.** Classic `<script src>` tags sharing one `window` global scope.
- **Supabase** (Postgres + PostgREST + Auth + Storage), fetched client-side with the public anon key. That key ships in `js/site_utils.js` and is in every page's source — it is not a secret. The service-role key must never appear in this repo or in CI.
- **GitHub Pages** from `main`, custom domain `dogslamloop.com`.

## Deploy model

- **`next-update` is the integration branch; `main` is production.** Pages serves `main`, so every merge there is a live deploy. Item PRs target `next-update`; a release is one PR from `next-update` to `main` carrying the changelog and version bump. Readers see one change per release rather than one per item.
- **CI triggers on `main` and `next-update` only.** A PR targeting anything else runs no tests, and reports green because nothing ran.
- **Push to `main` deploys immediately.** No staging environment.
- **Both branches carry a ruleset requiring `test` and `Supabase Preview`** (`main: require CI` since 2026-08-08, `next-update: require CI` since 2026-08-14; `Supabase Preview` added to both on 2026-08-15 after a release merged over a red one). **Direct pushes to either are rejected** — a push carries no check run, so it can never satisfy the rule. Everything lands through a PR. `Supabase Preview` reports `SKIPPED` rather than nothing on a PR that touches no SQL, which is why requiring it does not deadlock CSS-only work.
- **Except the regeneration job**, which must push its generated artifacts. It checks out over SSH with a deploy key (`secrets.REGEN_DEPLOY_KEY`), and that deploy key is in the ruleset's bypass list. The default `GITHUB_TOKEN` identity cannot be used for this: `github-actions[bot]` is not a user, team or installed app, so no bypass list can name it. The job runs the full suite before committing, so the bypass skips a check the job performs on itself.
- **Migrations apply on merge to `main`, so at release time the whole accumulated batch applies at once.** Between writing a migration and the release, anything database-backed looks broken — a missing table or `PGRST202 / schema cache` error is the expected state, not a bug.
- **Supabase branching verifies migrations before they reach production.** Automatic branching is on, scoped by *Supabase changes only*, so a PR touching `supabase/` gets a preview database and the migrations run against it; a PR touching only CSS or JS gets none. The release PR touches `supabase/` too, so it runs the entire accumulated set together — the only check that catches two independently-valid migrations conflicting in sequence. Branching compute sits outside the org spend cap, and a preview branch lives as long as its PR stays open.
- **A green preview does not mean the migration is correct.** It records each migration by version and never re-runs it, so *editing a migration you already pushed is verified by nothing* — `supabase/migrations.lock.json` exists to catch that. And a preview has production's schema plus **only the rows the migrations insert** — never any *content*, so a code path guarded by owner- or contributor-authored data is never executed there. Both of these shipped broken migrations in v0.14. The `supabase-migration` skill has the detail.
- **`supabase/seed.sql` runs on branch creation and on local `db reset`, never on `db push`.** It gives a preview branch two accounts with known passwords (one admin, one deliberately roleless) so RLS, grants and RPC guards can be probed for real. It runs *after* migrations, so it cannot help a migration that reads data at migration time.

## Commands

```
npm test                  # Playwright suite
npm run validate          # migration lock + navigation + generated-stub check (runs in CI)
npm run lock-migrations   # re-record migration checksums (only when re-locking is intended)
npm run generate          # rewrite page stubs from navigation.json
npm run refresh-previews  # pull portrait URLs from Supabase
npm run refresh-portraits # mirror those portraits into medias/portraits/
npm run refresh-registry  # rewrite navigation.json from site_pages
npm run refresh-content   # rewrite faq.json + collaborators_data.json
```

`visual.spec.js` is excluded from CI (`testIgnore` in `playwright.config.js`): screenshot baselines are OS-specific, so committed Windows baselines can never match a Linux runner. It stays a local-only tool for CSS work.

## Generated files — never hand-edit

Edit the source and regenerate; hand-edits are overwritten by the `regenerate.yml` workflow.

| File | Source |
|---|---|
| `data/navigation.json` | `site_pages` table |
| `data/page-previews.json` | `page_data.desc_data.profile.image` |
| `data/portraits.json` + `medias/portraits/*` | mirrored from the URLs in `page-previews.json` |
| `data/faq.json` | `site_faq` table |
| `systems/collaborators/collaborators_data.json` | `site_collaborators` table |
| `characters/*/index.html`, `systems/*/index.html` | `navigation.json` + `page-previews.json` |

Generated page stubs carry a `<!-- GENERATED by scripts/generate-pages.js -->` marker. The generator refuses to overwrite any file lacking it.

**Hand-authored, never generated** (protected by `NEVER_TOUCH` in `scripts/generate-pages.js`): `characters/Template`, `systems/collaborators`, `systems/tierlist`, `systems/updatelog`, `systems/color-codes`, and both hub pages (`characters/index.html`, `systems/index.html`).

Page rendering itself lives in `js/page_router.js` (DOM skeleton) and `js/page_boot.js` (per-type boot sequence). The two boot branches differ genuinely — character pages fire fetches concurrently with a 500ms TOC delay, system pages await in order with 150ms — don't flatten them.

## `tool` pages: editable or not

A `tool` page is one or the other, and which one follows from where the tool actually lives (owner, 2026-08-15):

- **Editable** — the page *wraps an external tool*. It is description, link and context, so it is content, and content gets edited. The Skill Builder ID Reader is this.
- **Not editable** — the *logic lives in the page*. Free Submit Tier List, Create Tier List. There is nothing to submit, so no edit button and no History.

Restricting an editable tool page to one person is configuration, not code: `site_pages.edit_role = 'elevated'` shows the button and gates at submit, and a `page_permissions` row with `required_role = 'admin'` decides who passes. `edit_role` is `open | elevated | locked`; `locked` hides the button entirely (see `js/pagebuilder.js:237`).

## Roles

**One role per user**, enforced by `UNIQUE(user_id)` on `user_roles`. Multi-role used to be possible and broke `get_my_role()` with "more than one row returned by a subquery", which broke that user's access everywhere.

| Rank | Role | Can |
|---|---|---|
| 5 | `owner` | Everything, and **the owner tools are theirs alone** — personnel, capabilities, page registry, FAQ, collaborators, site meta and settings, the blog, tier-list assignment |
| 4 | `admin` | Everything on `admin.html`, including **media deletion**. What is theirs and not a reviewer's: **force approve/reject and self-approve** — bypassing the support/oppose vote. **No owner-tool access** |
| 3 | `reviewer` | The queue: approve once supported, reject once opposed, open tickets, request changes, intercept. Moderation, and direct writes to live page data |
| 2 | `trusted_editor` | Submit to pages restricted to `trusted_editor` |
| — | *(signed in, no role)* | Submit to unrestricted pages |
| 1 | `viewer` | Soft ban — signed in, can read, **cannot submit** |
| 0 | *(anonymous)* | Read only |

**`owner` and `admin` were one role until v0.17**, when a second staff member joined. Anything written before then that says "admin" probably means the owner — including older migration comments and devlogs.

**Which page a tool lives on decides who owns it**, not how much damage it can do (owner, 2026-08-27). `owner.html` is the owner's; `admin.html` is the review team's. Media deletion is irreversible and still an admin power, because it is in the media queue on `admin.html`.

**Never test a role by name.** The ladder is stated once, in `role_rank()` (SQL) and `window.ROLE_RANK` (JS), with `is_staff()` / `is_owner()` and `roleMeets()` / `rolesMeet()` on top. A literal like `= 'admin'` or `roles.includes('admin')` is how v0.16 bug 6 happened, and it is what made the v0.17 rename a 30-site change instead of a one-line one. When sweeping for these, **grep for equality as well as `ARRAY[...]`** — v0.17 pass 1 checked only the second and missed fifteen policies that failed open.

`viewer` is the exception and is genuinely a name, not a rank: it is a ban, so it is tested with `IS DISTINCT FROM 'viewer'` rather than by position on the ladder.

`get_my_role()` returns NULL for a signed-in user with no role — compare with `IS DISTINCT FROM`, never `<>`, and note `role_rank(NULL)` is 0 so rank comparisons are safe.

**A function granted to `anon` must only call functions `anon` can also execute**, unless it is `SECURITY DEFINER`. Granting the entry point is not enough — that broke the tier list for logged-out readers once already.

## Conventions

- Escape at **every** `innerHTML` interpolation. Contributor-submitted names, chat, QA notes and error messages are all attacker-reachable. Never build user-influenced values into an inline `onclick` — use `data-` attributes with a delegated listener.
- Shared CSS classes are used across contexts that don't reference each other. A change to `.btn-sys`, `.btn-manga` or similar needs checking against every consumer, not just the page under investigation.
- Small per-file duplication is preferred over new cross-file coupling (see `owner.js` reimplementing `kickUser`/`adminConfirm` rather than importing from `admin-core.js`).

## History

**The current version's devlog is its SPEC, not a diary.** Design decisions are
recorded there before they are built, with the data shapes and delta scopes
worked out. Read the whole section before building from it — v0.15's Combos tab
was built to an invented shape while the real one sat in the same file, and two
questions were then asked that it had already answered.

`devlogs/` holds a per-version engineering record. The current in-progress version has its devlog at the repo root.
