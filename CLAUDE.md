# dogslamloop-wiki

A technical wiki for **Jujutsu Shenanigans**, a competitive Roblox fighting game. Modelled on dustloop.com but for a 3D fighter whose mechanics differ substantially from 2D ones: don't assume dustloop conventions map across.

Frame data, i-frames, matchup tiers and M1 trading are domain terms with real gameplay meaning to the community that maintains them. When touching frame-data rendering, tier logic, matchup content or colour coding, sanity-check against fighting-game conventions (startup/active/recovery, block/hit advantage) rather than treating it as generic data.

## Stack

- Static HTML/CSS/JS. **No bundler, no build step.** Classic `<script src>` tags sharing one `window` global scope.
- **Supabase** (Postgres + PostgREST + Auth + Storage), fetched client-side with the public anon key. That key ships in `js/site_utils.js` and is in every page's source: it is not a secret. **The service-role key must never appear in this repo or in CI.**
- **KLIPY's API key ships in `js/discussions.js`**, visible like the anon key (the owner's choice, 2026-10-02; a test key, 100 lookups an hour). A KLIPY link is looked up once, when the post is made, and the post stores the GIF's own address. Never move the lookup to render time.
- **The Discord relay** (`supabase/functions/discord-relay`) is the one Edge Function, live on production since 2026-10-07, so a merge to `main` that changes it changes the real Discord server. **Its bot token and webhook URLs live in Supabase secrets, set by the owner, and never appear in this repo, in CI or in a chat message.** The rest is in `.claude/rules/discord-relay.md`.
- **GitHub Pages** from `main`, custom domain `dogslamloop.com`.

## Deploy model

- **`next-update` is the integration branch; `main` is production.** Pages serves `main`, so every merge there is a live deploy, with no staging. Item PRs target `next-update`; a release is one PR from `next-update` to `main` carrying the changelog and version bump.
- **CI triggers on `main` and `next-update` only.** A PR targeting anything else runs no tests and reports green because nothing ran.
- **Both branches require `test` and `Supabase Preview` and reject direct pushes**, so everything lands through a PR. `Supabase Preview` reports `SKIPPED` on a PR that touches no SQL. The one bypass is the regeneration job's deploy key (`.claude/rules/regeneration.md`).
- **Content reaches readers through the regeneration job, not a release.** The nightly run regenerates `next-update`; `workflow_dispatch` with `publish_to_main` ticked (default off) also regenerates `main`. The job moves data; the release PR moves code.
- **The test suite gates content, not just code.** The regeneration job commits only after the full suite passes, so one red test stops navigation, colours, portraits, FAQ, collaborators and stubs reaching the site, every day, until it is fixed (the Roulette page 2026-08-09 to 08-12; the Hidden flag 2026-09-05). **A test an owner edit can turn red is a production outage.** Never assert a count of pages, characters, categories or colours. Never compare a frozen artifact (an applied migration, a committed fixture) against anything regenerated from `site_pages`. A failed regeneration run reads as "the site is stale" first.
- **Migrations apply on merge to `main`**, so a release applies the whole accumulated batch at once. Until then a missing table or a `PGRST202 / schema cache` error is expected, not a bug.
- **A PR touching `supabase/` gets a preview database, decided once on the branch's FIRST push.** A migration added in a later push gets no preview and reports `SKIPPED` (PR #165). Put a migration in its branch's first push, or branch fresh for it. A green preview still does not prove a migration correct: the `supabase-migration` skill says why and how to probe.
- **`supabase/seed.sql` runs on branch creation and local `db reset`, never on `db push`.** It gives a preview five accounts with known passwords for probing RLS, grants and RPC guards.

## Commands

```
npm test                  # Playwright suite
npm run validate          # migration lock + navigation + generated-stub check (runs in CI)
npm run lock-migrations   # re-record migration checksums (only when re-locking is intended)
npm run generate          # rewrite page stubs from navigation.json
npm run refresh-previews  # pull portrait URLs from Supabase
npm run refresh-portraits # mirror those portraits into medias/portraits/
npm run refresh-registry  # rewrite navigation.json from site_pages
npm run refresh-content   # rewrite faq.json + collaborators_data.json + site_meta.json
```

`visual.spec.js` is excluded from CI (`testIgnore` in `playwright.config.js`): screenshot baselines are OS-specific. It stays a local-only tool for CSS work.

## Generated files: never hand-edit

Edit the source and regenerate; `regenerate.yml` overwrites hand-edits.

| File | Source |
|---|---|
| `data/navigation.json` | `site_pages` table |
| `data/page-previews.json` | `page_data.desc_data.profile.image` |
| `data/portraits.json` + `medias/portraits/*` | mirrored from the URLs in `page-previews.json` |
| `data/faq.json` | `site_faq` table |
| `data/site_meta.json` | `site_meta` table. **The version string lives here**, so a release bump is an owner-tools edit plus `npm run refresh-content` |
| `systems/collaborators/collaborators_data.json` | `site_collaborators` table |
| `data/search-index.json` + `data/search-fulltext.json` | `page_data`, via `scripts/fetch-search-index.js`, built by calling `collectSectionTargets` (`js/character_tabs.js`) so the anchors match the ones `assignSectionAnchors` mints in the DOM. **Deliberately absent from `npm run validate`**: they are fetched from Supabase, so a `--check` would turn an owner content edit into a red required check |
| `js/site_meta.js`, **only** between `GENERATED REGION: CHARACTER_COLORS` and `END GENERATED REGION` | `site_pages.color`, keyed by `name`. The rest of the file (`CHARACTER_ALIASES`, `applyCharacterTheme`) is hand-authored. `fetch-content.js` refuses to write if the markers are missing |
| `characters/*/index.html`, `systems/*/index.html` | `navigation.json` + `page-previews.json` |

Generated stubs carry `<!-- GENERATED by scripts/generate-pages.js -->`, and the generator refuses to overwrite a file without it. **Hand-authored, never generated** (`NEVER_TOUCH` in `scripts/generate-pages.js`): `characters/Template`, `systems/collaborators`, `systems/tierlist`, `systems/updatelog`, `systems/color-codes`, and both hub pages (`characters/index.html`, `systems/index.html`).

Page rendering lives in `js/page_router.js` (DOM skeleton) and `js/page_boot.js` (per-type boot). The two boot branches differ on purpose (character pages fetch concurrently with a 500ms TOC delay; system pages await in order with 150ms): don't flatten them.

## `tool` pages: editable or not

Decided by where the tool lives (owner, 2026-08-15). A page that **wraps an external tool** is content and is editable (the Skill Builder ID Reader). A page whose **logic lives in the page** has no edit button and no History (Free Submit Tier List, Create Tier List). Restricting an editable page to one person is configuration: `site_pages.edit_role` is `open | elevated | locked`. `elevated` gates at submit, with a `page_permissions` row deciding who passes; `locked` hides the button (the `editRole === 'locked'` check in `js/pagebuilder.js`).

## Roles

**One role per user**, enforced by `UNIQUE(user_id)` on `user_roles` (multi-role once broke `get_my_role()` with "more than one row returned by a subquery").

| Rank | Role | Can |
|---|---|---|
| 5 | `owner` | Everything, and **the owner tools are theirs alone**: personnel, capabilities, page registry, FAQ, collaborators, site meta and settings, the blog, tier-list assignment |
| 4 | `admin` | Everything on `admin.html`, including **media deletion**, plus **force approve/reject and self-approve** (bypassing the vote). **No owner-tool access** |
| 3 | `reviewer` | The queue: approve once supported, reject once opposed, open tickets, request changes, intercept. Moderation, and direct writes to live page data |
| 2 | `trusted_editor` | Submit to pages restricted to `trusted_editor` |
| (none) | *(signed in, no role)* | Submit to unrestricted pages |
| 1 | `viewer` | Soft ban: signed in, can read, **cannot submit** |
| 0 | *(anonymous)* | Read only |

- **`owner` and `admin` were one role until v0.17.** Older migration comments and devlogs that say "admin" usually mean the owner.
- **Which page a tool lives on decides who owns it** (owner, 2026-08-27): `owner.html` is the owner's, `admin.html` the review team's. Media deletion is an admin power because it sits in the media queue on `admin.html`.
- **Never test a role by name.** The ladder is stated once, in `role_rank()` (SQL) and `window.ROLE_RANK` (JS), with `is_staff()` / `is_owner()` and `roleMeets()` / `rolesMeet()` on top. A literal like `= 'admin'` or `roles.includes('admin')` caused v0.16 bug 6 and made the v0.17 rename touch 30 sites. When sweeping, **grep for equality as well as `ARRAY[...]`** (v0.17 pass 1 missed fifteen policies that failed open).
- `viewer` is a ban, so it is tested by name: `IS DISTINCT FROM 'viewer'`.
- `get_my_role()` returns NULL for a signed-in user with no role: compare with `IS DISTINCT FROM`, never `<>`. `role_rank(NULL)` is 0.
- **A function granted to `anon` may only call functions `anon` can execute**, unless it is `SECURITY DEFINER` (this broke the tier list for logged-out readers once).

## Writing code here

Code an assistant wrote is a draft until something has checked it. Assistant code fails security checks in nearly half of tasks (Veracode, 2025), people using an assistant write less secure code while trusting it more (Perry et al., CCS 2023), and assistants copy where they should reuse (GitClear, 2025). Each of those has happened in this repo.

**Before writing**
- Read the code being changed and the code that calls it. Search for an existing helper by what it does, not only by its name, and reuse it.
- The current devlog is the spec. If it does not settle a data shape or a behaviour, ask; never invent one.
- Never use a function, column, table, flag, API or package you have not seen exist, in this repo or in the library's official docs. A plausible-looking name that does not exist is the commonest assistant error. A new dependency (a CDN `<script>`, an npm package) is the owner's call.

**While writing**
- The smallest change that solves the stated problem. No abstraction, option or layer for a case that does not exist yet, and no refactor in passing.
- Every value from a user, contributor, Discord, the URL or the database is hostile. Escape at **every** `innerHTML` interpolation, or use `textContent`. Never put a user-influenced value in an inline `onclick`: use `data-` attributes and a delegated listener.
- Authorization lives in Postgres: RLS, table grants and the RPC's own caller check. A page's RBAC gate only decides what to show, because anyone can call the REST endpoint directly.
- Fail visibly. No empty `catch`, no error swallowed into a half-built page: show the reader an error state and keep the message. A deliberate silent failure says so in a comment (`window.loadHotfixPosts` is one).
- Walk the edges: empty, NULL, one, many, signed out, roleless, banned, slow network, a second click. NULL made the worst hole here (`is_owner()`, closed 2026-09-28).
- State a rule once and derive the rest (`role_rank()`, `NAV_FLAGS` in `scripts/fetch-registry.js`). Small per-file duplication is still preferred over new cross-file coupling (`owner.js` reimplements `kickUser` rather than importing `admin-core.js`), but two copies of one rule that must agree will drift: the rules in `.claude/rules/` name the known pairs.
- Comments say why, not what.

**Before saying it is done**
- Prove it with a check that can fail: a test that drives the real control and was seen failing with the fix reverted (the `writing-tests` skill). Show the command and what it printed. "Should work" is not a result.
- Read the whole diff as a reviewer would: every line understood, nothing unrelated, no debug code left, no em-dash.
- Say what was verified and against what (mocks, a preview database, production), and what was not.
- A fix that has failed twice means the cause is not understood yet. Stop patching and find it.

## Git and PRs

- **A branch carries a version only when the roadmap (in memory) has that version.** Anything else is `fix/`, `chore/` or `hotfix/`, with no version in the branch name or commit subject. Never invent a number.
- Batch 3 to 4 finished items per PR, and keep one PR open at a time. Once it is open, branch for the next batch (from `next-update`, or from the open PR's branch only when the work builds on it), commit, and don't push. When the owner says it merged: confirm `mergedAt`, delete the branch, rebase the next batch onto `next-update`, re-run its specs, push, open the next PR.
- **A merged PR's branch is closed to new work.** Before committing to a branch that has a PR, `gh pr view <N> --json state`. Before deleting a branch, confirm `mergedAt` is non-null; deleting an unmerged PR's branch closes the PR. `git branch -d` printing `not yet merged` means the branch holds commits the target lacks: recover them (`git cherry-pick <sha>`) before carrying on.
- Before saying a fix is in a PR: `git status --short` shows none of it unstaged, and `git diff <base>...<head> --stat` lists it.
- Quote a PR URL only from the output of `gh pr create`, never from the push hint.
- Stage explicit paths. Never `git add -A` when the tree holds the owner's work.
- Commit before any revert or mutation probe, so the restore comes from a commit. Never `git checkout -- <file>` or blanket-restore a dirty tree.
- Conflicts on generated files (stubs, `supabase/migrations.lock.json`): regenerate (`npm run generate`, `npm run lock-migrations`), never hand-merge. On a hand-written conflict, read both sides: two branches appending to one file usually both keep their block.
- Read CI after every push. A local pass does not make a CI failure flaky.
- On Windows, write the commit message to a file and use `git commit -F`.
- Every PR body carries the change notes (below), what was found broken along the way, decisions a reviewer would otherwise have to reverse-engineer, and what needs the owner after merge.

## Devlogs and the Update Log

**The owner writes the devlogs and the Update Log** (2026-10-18). Do not write in either. Give them change notes instead, in the reply when a PR opens and again in the PR body. Per change, facts rather than drafted lines:

- **For the Update Log:** what a reader sees now and saw before, with exact names, numbers and the page it is on; and which part it fits (Features, Fine-tuning, Bug fixes, or under the hood).
- **For the devlog:** what changed in code and data (files, tables, migrations); each decision, its reason and what was turned down; what broke along the way and how it was found; what was verified and what was not; what is still open, and whose it is.

On a draft the owner hands over: grammar and spelling only, keep their wording, list every edit, and flag (don't fix) a line that does not match what changed. Their rules for entries are in the `writing-site-text` skill.

**The current version's devlog is its SPEC.** Design decisions recorded there come before building: read the whole section first (v0.15's Combos tab was built to an invented shape while the real one sat in the same file). `devlogs/` holds past versions; the current one is at the root (`V<x.y>-DEVLOG.md`).

## Conventions

- **NEVER use an em-dash (`—`).** The owner banned it outright, 2026-09-21: *"I strictly ban the usage of the Em-dash"*. Every file and every message: site pages, commit messages, PR bodies, code comments, replies. A colon, full stop, comma or brackets always cover it. En-dashes only in numeric ranges (`#190–#199`). Older text still has them; don't sweep it in unrelated work.
- **In a policy, licence or reference document, state the rule and stop.** No clause explaining why (owner, 2026-09-21: *"you don't need to include reasoning next to a statement... No, just no."*). A privacy policy still says what data is **for**: that is content, not justification.
- **Text readers see is written in the owner's voice**, read off their own pages: the `writing-site-text` skill. "Never write 'you'" is a changelog rule, not a site rule.
- **Shared CSS classes** (`.btn-sys`, `.btn-manga` and the like) are used in contexts that don't reference each other. Check every consumer, not just the page at hand.
- **The `hidden` attribute loses to any `display` a stylesheet sets**, because the browser's `[hidden]` rule sits below every author rule. Restate it (`.thing[hidden] { display: none; }`) for every class that sets `display`, and test with `toBeHidden`, not the attribute. Eight classes carry it already (four in `admin.css`, the rest in `editor.css`, `Layout.css` and `discussions.css`), and v1.0 needed two more.
- **Media the wiki shows lives in Supabase Storage, never on Discord's CDN.** Discord attachment links expire (all four on Sky Assassin were dead by 2026-09-28), and tests never fetch real media, so a dead link is invisible to them.

## Rules that load with their files

`.claude/rules/` holds rules that load when a matching file is read: `combo-card.md` (the two Combo Card editors), `tier-rosters.md` (the three `loadRoster` copies), `discord-relay.md` (`supabase/functions/`) and `regeneration.md` (workflows, scripts and generated stubs).
