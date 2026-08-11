# Plan: the official transition

**Status:** proposed 2026-08-09, awaiting the owner's confirmation. Nothing started.

This plan covers **features only**. Content is a separate track — the owner has assembled a 30-person team already working on it.

---

## 1. The scope, written back

Restating what was asked before planning against it, so a misread costs a paragraph rather than a rebuild.

**Main Dashboard gains two columns.**

- **"Others"**, placed under "Guides and Such", with "Game Info" moved right. Links to `others/<thing>/index.html`: Roulette, Emotes, Duels, Awakening System, Parkour System, Skill Builder, Custom Servers, Creator Clash, Game Settings, Private Servers, Lost Medias. All system-type except **Emotes**, which is a **gallery type** — its own treatment like the tier list, with search and sort by emote name, and where contributing means submitting media.
- **"Tools"**, placed under "Recent Changes", with "Game Info" moved right. Links to `tools/<tool>/`. Three tools: a **free-submit tier list** (accepts every submission and averages them into a real community ranking — so the Side Dashboard's "Community Tier List" gets renamed, e.g. "Certified Tier List"), the **Skill Builder ID Reader** (already built by the owner; just link it), and **Forums** (site-wide, with threads per character page).

**Character pages split by kit.**

- **Full characters (`isBaseOnly: false`)**: a dynamic toggle handling **2-4 states**. Each state carries its own Overview & Strategy, M1s, Skills, Specials, Matchups and Counterplay. **Gallery is universal** across states. This holds the base kit and the ultimate-mode kits — some characters have **two** ultimate modes.
- **Base-only characters (`isBaseOnly: true`)**: one extra tab after Counterplay, **"Ultimate"**, rendered by `framedata.js` and `description.js` under the id `ultimateAtk`. No modes — their ultimate is a single big attack, sometimes with variants.

**A moderator role**, parallel to reviewer rather than above it. No submission approval, no trusted-editor benefits; its power is moderating the forums.

**Qualitative frame data.** A way to fill frame-data sections with labels instead of numbers — *non-existent, very short, short, mid, high, very high, RIP* — so pros who know how an endlag feels can contribute without counting frames.

**Plus** everything in the existing v1.0 roadmap, and a bug list to follow.

---

## 1b. Confirmed decisions (owner, 2026-08-09)

- **New page types are fine to add** the way `tierlist` was — the collisions in section 2 are things not built yet, not obstacles.
- **Forums are out; per-character discussion threads are in.** Smaller build, moderation scoped to pages already watched.
- **Qualitative frame data renders as a solid colour block with no slits.** The owner's design, and better than storing a separate marker: the frame bar's tick divisions *are* the visual language for measured, so their absence says estimated without needing a legend. It also deliberately withholds the per-frame visualisation, which would be meaningless for an estimate.

## 2. Three collisions with the current code

Each is small, but each blocks work that depends on it.

**`page_type` is a CHECK constraint.** `20260808000003_site_pages.sql:53` allows exactly `character | system | tierlist | hub | external`. **`gallery` and `tool` do not exist** and a row using them is rejected outright.

**The generator refuses any path outside two directories.** `scripts/generate-pages.js:306` and `:338` both test `^(characters|systems)\/[^/]+\/index\.html$`. **`others/roulette/index.html` will not generate.** Both `others/` and `tools/` need adding, and tool pages likely belong in `NEVER_TOUCH` (they are apps, not authored content — same treatment as `systems/tierlist`).

**One role per user is enforced in the database.** `20260801000000_role_model_fix.sql:57` adds `UNIQUE (user_id)`, deliberately: multi-role previously broke `get_my_role()` with *"more than one row returned by a subquery"*, which broke that user's access everywhere.

> **So nobody can be both a reviewer and a moderator.** With a 30-person team that is a real constraint, not a technicality — the people you trust to review content are exactly the people you would trust to moderate.
>
> **Recommendation: do not add a second role row.** Add a capability column instead (`user_roles.can_moderate boolean`), leaving `UNIQUE(user_id)` and `get_my_role()` untouched. Same outcome, none of the incident risk. Roles stay a hierarchy; moderation becomes a flag on top of one.

---

## 3. Two things worth pushing back on

Neither is a refusal — both are the owner's call. Recording the reasoning so the decision is deliberate.

### Forums are the highest-risk item on the list

They are the largest build here, and the largest **ongoing** liability. Specifically:

- **They compete with a 1.4M-member Discord that already works.** The community is there. A forum's failure mode is not breaking, it is sitting empty — which looks worse under an official banner than not having one.
- **Moderation is a standing commitment**, not a feature you ship. It needs the moderator role, moderation UI, reporting, rate limiting, and someone actually watching.
- It is the one item that could consume a whole version by itself.

**Suggested smaller first step: per-character discussion threads**, attached to pages that already exist and already draw traffic. That is most of the value, a fraction of the build, and moderation scoped to pages you already watch. If threads get used, a general forum is the natural next step and you will have the moderation tooling already. If they do not, you learned that cheaply.

### Qualitative frame data needs to be visibly different from measured data

**Resolved by the owner: a solid colour block with no slits.** The concern was that if "feels short" renders like "12f", the wiki quietly stops being trustworthy — hard to walk back once official. The owner's answer is better than the marker-plus-styling approach originally suggested: the frame bar's tick divisions already *are* the visual language for "measured", so removing them says "estimated" with no legend required, and it withholds a per-frame visualisation that would be meaningless for an estimate anyway.

Still required: make replacing an estimate with a real number trivial, so estimates are a **first-class state** rather than debt nobody can find later.

---

## 3b. Bugs found by the reviewer team (2026-08-09)

Found once real reviewers started working with the new content team. Triaged by what they cost, not by how hard they look.

### P0 — silently destroys work

**Merging submissions produces a full overwrite.** `js/admin-merge-compiler.js:228-229` inserts the compiled ticket with `is_delta: false, target_scope: null`, which the queue then labels `[LEGACY OVERWRITE]` (`js/admin-queue.js:123`).

A delta ticket applies a **scoped patch** to whatever live data exists at approval time. A merged ticket instead carries a **full snapshot** of `desc_data` and `frame_data`, taken when the merge was compiled (the compiler builds it by applying each delta onto live data at `:48-49`). So any submission approved between compiling and approving is **silently replaced — no conflict, no warning.**

With nine trusted friends this was rare. With 30 contributors submitting in parallel it is routine. This is structural, not incidental.

**The four reported symptoms turned out to be two unrelated bugs.** Reproducing before fixing was worth it — a single "fix the merge" would have left half of it live.

**Genuinely the merge compiler:**

1. *Risks deleting others' work.* Confirmed: `is_delta: false` makes the ticket a full snapshot.
4. *QA notes discarded.* Confirmed at `js/admin-merge-compiler.js:233-237` — the payload **replaces** `qa_metadata` with a synthetic `{changelog: "System Merge: Unified edits from N contributors.", confidence: "high", evidence: masterTicket.qa_metadata?.evidence}`. Every contributor's own changelog is thrown away and only the *master* ticket's evidence survives, so `history.html` reads barren. **Independent of bug 1**, and its own data loss — QA notes are the audit trail for who verified what. Note also that `confidence` is hardcoded `"high"` even when every source ticket was low.

**Not the merge compiler at all — the editor's handling of Profile and Playstyle:**

2. *New content not loading in the preview.*
3. *An uneditable "Editing Null" section copying the previous section's contents.*

Root cause for 3 is `js/editor-sync.js:252`, `` const sectionTitle = `Editing ${tabId}` `` — a null `tabId` renders the literal string "Editing null", and four lines above, a missing `tab-null` element is **created and appended to the preview pane**, producing a phantom section. It renders `currentStrategyBlocks`, which still holds the previous tab's blocks — hence "copies the last section contents".

`masterDesc` is a deep clone of live data (`js/admin-merge-compiler.js:151`), so the merged payload is structurally complete. These two symptoms were simply *noticed* while editing a merged ticket.

**This is the same underlying cause as the reported "Profile and Playstyle lack Media Library and undo/redo".** Those two tabs hold structured fields rather than block arrays, and are second-class across the whole editor: no media library, no undo/redo, and a sync path invoked without a `tabId`. **One cause, three reported symptoms** — fix the tab handling once rather than patching each surface separately.

### P1 — causes wrong decisions

**Approve, Request Changes and Reject all reuse the reject modal**, so approving shows *"Explain why this revision was declined…"* in red. A reviewer working through a queue will eventually act on the wording rather than the button. Cheap to fix, and the cost of not fixing it scales with team size.

**`InSkill Stun` is missing from the editor's frame-type options.** Frame data is the site's core value; a missing type means contributors either omit it or record something wrong.

### P2 — friction and small losses

- **Character Profile and Playstyle tabs lack the Media Library and undo/redo** that every other editor tab has.
- **The cancel button does nothing when intercepting a revision.** Same area as the P0; likely worth fixing together.
- **Alt text on skill-card profiles (`framedata.js`) does not persist** despite entering it and syncing. Also an accessibility regression, which matters more now that v0.11 established a baseline.

### Decided: merged tickets become multi-scope deltas

**Owner's call.** Rather than one snapshot, a merge emits a delta carrying a **list** of scopes, so it injects each contributor's change without touching anything else. That removes the overwrite risk at the root instead of guarding against it.

Consequences to design for:

- `applyDeltaToData` (`js/site_utils.js`) currently takes a single `scope`/`key`/`payload`. It gains a list form. It is shared by `admin.js`, `editor.js` and `history.js` for live preview, revision merging and history replay respectively — **all three must handle both shapes**, since existing single-scope tickets stay in the queue and in `page_history` forever.
- `pending_revisions.target_scope`/`target_key` are scalar columns used for the queue's `[PATCH: …]` badge (`js/admin-queue.js:112-123`). A multi-scope ticket needs either a list column or a sentinel plus the list inside `delta_payload`.
- The queue badge and the size hint both read those columns, so both need a multi-scope branch.

#### SHIPPED, 2026-08-10 — and it needed no migration

**The list form already existed and was already in production.** `js/site_utils.js:108-116` holds a "Smart Batch Unpacker": `target_scope: 'multi'` with `delta_payload` as an array of `{scope, key, payload}`, applied recursively. `js/editor-core.js:672-681` already emits it whenever a contributor makes more than one independent edit in a session, and `admin-diff.js`, `admin-preview.js`, `history.js` and `recent-changes.js` all branch on `'multi'` already.

**Only the merge compiler was bypassing it.** So the schema question above — list column versus sentinel-plus-payload — was moot: no new column, no migration, no change of meaning for existing tickets. The earlier lean toward a nullable `target_list` jsonb came from not having read `applyDeltaToData` closely enough.

What actually changed:

- The compiler emits one delta per accepted conflict (`js/admin-merge-compiler.js`), keeping `masterDesc`/`masterFrame` as the legacy fallback exactly as `editor-core.js`'s `buildPayload` does.
- Array scopes are mapped singular (`extras` → `extra`), and a chosen version of `undefined` — meaning that ticket deleted the item — is normalised to `null`, since `undefined` drops out of JSON entirely and would apply as a no-op, quietly resurrecting the deleted item.
- QA notes fixed in the same payload object: every contributor's changelog and evidence carries through attributed, and confidence takes the **lowest** of its sources instead of a hardcoded `"high"`.
- The queue badge counts targets instead of printing `MULTI: batch`.

Covered by `tests/admin-merge-delta.spec.js`. The discriminating test moves live data on *after* the merge is compiled and then applies the ticket through the same branch `admin-actions.js` uses — a snapshot loses the intervening work, a delta keeps it. Verified failing against the pre-fix code with exactly that symptom.

### Decided: reviewers navigate revisions by top tabs, not the document explorer

**Owner's request.** Today the reviewer navigates a revision through the document explorer in the left workspace, which is inefficient. It should use a top navigation bar of tabs, mirroring how live character and system pages already work.

**This also fixes a confirmed bug, and is required by the decision above.**

`js/admin-actions.js:17` guards its "Smart Routing" behind `if (rev.is_delta)`. A merged ticket is `is_delta: false`, so **no `&tab=` is ever appended**, and `js/editor-core.js:33` falls back to `'overview'`. So intercepting *any* non-delta ticket dumps the reviewer on Overview regardless of what was actually edited — which is why intercepting a skill revision is currently impossible.

The two decisions interlock: once a merge is a **multi-scope** delta, single-target smart routing is not merely broken but meaningless — there is no one tab to jump to. Top-tab navigation is what replaces it. Build them together.

#### SHIPPED, 2026-08-10 — and the editor needed it more than the reviewer did

**Owner clarified mid-build:** *"I just want how the navigation buttons work in the page itself to be the same in the editor as well."* So this covers **both** `admin.html` and `edit.html`, not the review pane alone.

That turned out to be the more important half. **`edit.html` had no major-tab navigation whatsoever** — `currentEditorTabId` was read from `?tab=` once at boot (`js/editor-core.js`) and never moved again; the `daw-tab-btn` rows are *sub*-navigation within a major tab. So the routing bug and the missing control compounded: intercept dropped the reviewer on Overview, and once there the only way out was hand-editing the URL. That, not the routing alone, is why intercepting a skill revision was impossible.

Both pages now carry the same `.btn-manga.btn-manga-slanted` strip the live pages use. Specifics worth remembering:

- **Intercept follows the tab the reviewer is reading** rather than deriving one, which is the only honest answer once a ticket spans several scopes. Single-move tickets keep their `&move=` deep link.
- **Changed-tab markers are back on the buttons.** They were removed once before because the buttons lived in the sidebar and were invisible on mobile while reading the preview (see the comment on `.changed-tabs-popup` in `style/admin.css`). Being above the content is what makes them work. `window.changedTabs` already resolved every scope of a `'multi'` payload to its tab, so nothing new had to be computed.
- **A latent data-corruption bug had to be fixed to make editor tab switching safe.** All three sub-tab loaders (`loadOverviewSectionIntoEditor`, `loadMatchupIntoEditor`, `loadCounterplayIntoEditor`) flush the *previous* selection's blocks into `desc_data` on entry. Crossing a major-tab boundary with stale sub-state meant arriving at Overview with `currentOverviewSection` still `'strategy'` and writing the **matchup's** blocks into `descData.strategy`. `switchEditorTab` clears all three after syncing. Confirmed load-bearing by removing the guard and watching `MATCHUP CONTENT` land in General Strategy.
- `switchEditorTab` calls `triggerManualSync()` first — `currentStrategyBlocks` is a buffer that only writes back on sync — and rewrites `?tab=` via `replaceState` so a reload lands where the strip says.
- **System and tierlist pages do not get the strip:** they bail out of `initFullTabEditor` into their own builders, which manage their own tabs.

Covered by `tests/revision-tab-nav.spec.js` (7 specs, both surfaces). One note for future test work: the admin layout spec asserts against the **served HTML** via `request.get`, not the live DOM — `admin.html`'s RBAC gate replaces `document.body` asynchronously, and reading static structure from a loaded page is a race that passes in isolation and fails under parallel load.

### P1 — found while investigating, not reported

**Author badges are interpolated unescaped.** `js/description.js:364` builds `<span class="author-badge">${a}</span>` where `a` comes from `block.author.split(',')`. Author strings ride along inside submitted block data, so this is contributor-reachable and violates the project's own "escape at every `innerHTML` interpolation" rule. It renders on every character and system page. Fix with the reviewer-workflow batch.

## 3c. Editor and workflow improvements (owner, 2026-08-09)

Not bugs — requests raised alongside the bug list.

**Highlight a block that was just moved.** After a reorder, the moved block should be visibly marked so the editor can see where it landed. Currently a move gives no feedback beyond the list re-rendering, which in a long section means hunting for it.

**Trusted Editors and Reviewers bypass the 3-minute submission cooldown.**

> **This has to change in two places, and the client-side one is not the real limit.**
>
> - `js/editor-core.js:459` holds a client-side cooldown in `localStorage` under `wiki_last_submit_time`. UX only, and trivially bypassed by clearing storage.
> - `check_revision_rate_limit()` (`20260727000000_remote_schema.sql:98`) is a **trigger on `pending_revisions`** that `RAISE`s an exception on any insert within 3 minutes of that author's last one. This is the actual boundary.
>
> The trigger has no role awareness — it filters on `author_id` alone. **Changing only the client would let a trusted editor past the friendly message straight into a raw Postgres exception**, which is a worse experience than the cooldown. Both must move together, and the trigger needs to consult `get_my_role()`.
>
> Worth deciding at the same time: exempt entirely, or a shorter window? Entirely-exempt removes the only server-side brake on a compromised trusted account. A 20-30 second floor keeps a brake while removing the friction.

**Move per-section contributor lists to the bottom of the tab.** Five author badges inside the Overview section is visual noise; they should compile into one place.

> Precise current state: badges are **already aggregated per section**, not per block. `generateHTMLForBlocks` collects `block.author` into a `sectionAuthors` Set and renders one `.aggregated-contributors-footer` at the end of each section (`js/description.js:352-376`).
>
> So the ask is to raise the aggregation **one more level — section to tab.** That means the collection has to outlive a single `generateHTMLForBlocks` call, since it is currently function-local. Either return the author set to the caller and let the tab renderer emit one footer, or hoist collection into a module-level accumulator that the tab boot resets. The first is cleaner; the second is fewer call-site changes. Also affects `populateTextSection` and `renderPostBody`, which call the same function — a blog post should probably keep its footer where it is.

### Where these go in the sequence

**Before the v0.12 feature work**, as an unversioned `fix/reviewer-workflow` batch. Two reasons: the review pipeline is the throughput path for all 30 contributors, and the P0 is actively destroying work every time a merge lands. Features can wait a few days; contributor goodwill cannot.

Per the project's own rule, a batch of bug fixes ships as `fix/…` with no version number.

---

## 3d. What shipped, 2026-08-10

The whole batch, in five commits on `fix/reviewer-workflow`. 451 specs pass; `npm run validate` clean.

**Every reported bug is fixed, but only two of the six were the thing they looked like.** Reproducing before fixing was worth it twice over:

- The "Editing null" section was **not** a Profile/Playstyle bug. `updateLivePreview` read `urlParams.get('tab')` raw while `editor-core.js` boots with `urlParams.get('tab') || 'overview'`, so opening the editor without a `?tab=` gave the two different answers. It reads `currentEditorTabId` now, the same thing `triggerManualSync` already used.
- "Alt text does not persist" was **three** defects. It persisted fine in the data; `<video>` simply has no `alt` attribute, so alt entered against a video-media move rendered nowhere (it carries `aria-label` now). Chasing that surfaced the mp4 problem the owner reported separately — video detection ran `endsWith` on the whole URL and knew only mp4/webm, so `clip.mp4?t=123` and `.mov` fell to the `<img>` branch. **And that branch was broken anyway**: it emitted `data-lazy-src`, but `initLazyMedia` only ever promotes `video[data-lazy-src]` and `iframe[data-lazy-src]`, never `img` — so every static skill-card image had been rendering with no source at all.

**Four injection points were found and fixed while in the area**, none of them reported. Author badges (`description.js`, on every character and system page); the Profile and Playstyle forms, which interpolate submitted values into `value=""` and which a reviewer renders *someone else's* text through when intercepting; the skill card's metadata; and `move.id` built into an inline `onclick`, where a quote in an id closed the handler. The escaping is deliberately narrow — block *content* stays rich HTML, because contributors write formatted prose and flattening it would break every page.

**Two decisions changed on contact with the code:**

- The **multi-scope delta needed no migration** — the format already existed and was already in production. See the SHIPPED note under §3b.
- The **navigation work widened to `edit.html`** on the owner's clarification, and that turned out to be where the real blocker was. See the SHIPPED note under §3b.

**Cooldown perk, decided by the owner:** remove it entirely for `trusted_editor`/`reviewer`/`admin`, **but as a toggle in owner tools rather than a constant** — a perk switch that can be pulled without a migration if a staff account is compromised. New `site_settings` singleton (separate from `site_meta`, which is content and gets regenerated into a committed public artifact). The trigger's role test is a positive `IN`, so the NULL `get_my_role()` returns for a roleless user fails safe on its own.

**One thing to know about the contributor-list change:** it is a DOM pass over the finished tab, not a value threaded through callers, because four different code paths build those sections and some are asynchronous. It also catches the accordion footers a caller-level version would miss. Sorted alphabetically rather than left in document order — a nested footer renders *before* its enclosing section's, so document order never matched authoring order and never could.

**Still unverified, and cannot be verified before merge:** the migration. Migrations apply on merge, and Playwright cannot reach RLS, grants or triggers. Probe after merging — anon read of `site_settings` should succeed, a non-admin write should fail, an admin write should succeed, and a `trusted_editor` should be able to submit twice inside three minutes.

---

## 4. Proposed sequencing

Ordered by **what unblocks the 30-person team**, because that is now the binding constraint. Content written before the structural work gets rewritten after it.

### v0.12 — Foundations for the team

Mostly invisible to players, and the most urgent work in this document.

> **STATUS 2026-08-10: roughly half shipped, as [PR #41](https://github.com/Deptr-softwares/dogslamloop-wiki/pull/41) (merged).**
>
> **Done:**
> - Item 3 in full — category creation unblocked, `others/`/`tools/` folders, `gallery` and `tool` page types with their own renderers, and a gallery editor (upload + name into a bin, one delta per item so contributors cannot collide).
> - **The two Main Dashboard columns, pulled forward from v0.13.** Others under Guides & Such, Tools under Recent Changes, Game Info to the right. They fill from `navigation.json` by category, so no new data source.
>
> **Shipped since:** item 1 (character modes and the Ultimate tab, [PR #43](https://github.com/Deptr-softwares/dogslamloop-wiki/pull/43)); items 2, 4 and 6 plus the tool-page editor ([PR #44](https://github.com/Deptr-softwares/dogslamloop-wiki/pull/44)). Item 4 landed as the `404.html` live-page fallback rather than regeneration-on-save — see below. No migrations in either.
>
> **Moved to v0.13, owner's call 2026-08-11:** item 5, the site-wide progress view. It is the only v0.12 item not built, and it belongs next to the content push it exists to track.
>
> **Still content, not code:** the eleven `others/` pages and two tools.
>
> **One thing v0.12 produced that was not on the list:** a deploy cache skew took the editor down live. GitHub Pages serves `js/` with `max-age=3600`, so a new module can load against an hour-old `js/site_utils.js`. That file now carries a content-hash query and the modules degrade rather than throw.
>
> **Two corrections this batch produced, both recorded above:** the 1.4M figure is Discord *membership*, not traffic, and should not be used to argue against database reads; and the regeneration step is gated by GitHub Pages needing a real file at every URL, not by `navigation.json` — which is why moving that file to the cloud would not have fixed the feedback loop.

1. **Character modes** (full characters) and the **Ultimate tab** (base-only). Blocks all character content. `route.tabs` already exists as a per-page override (`js/page_router.js:57`) and move IDs are already namespaced (`boomcat-first-m1`), so `desc_data.moveStrategies` needs no change. Model additively: optional `frame_data.modes`, absent means the existing top-level *is* the base mode, so all 22 existing characters keep working untouched.
2. **Qualitative frame data.** A throughput multiplier for the team, and it removes the dependency on devs supplying numbers — which may never arrive.
3. **New page types and directories.** `gallery` and `tool` added to the CHECK; `others/` and `tools/` added to the generator; the hardcoded category dropdown in `owner.html` replaced with something that accepts new categories.

   **Shipped in two parts, 2026-08-10.** The category dropdown and the directories landed first, and turned out smaller than written here: `page_type` was *deciding* the directory, so splitting those two questions unblocked `others/` and `tools/` with **no migration and no renderer change** — `js/page_boot.js` has only a character branch and an everything-else branch, so a page in `others/` already renders as a system page. The real hazard was `getRootPath()`, which hardcoded the same two directory names and returned `'./'` for anything else; a page under a new directory would have resolved `navigation.json`, portraits and every stylesheet against the wrong root.

   **Correction, owner 2026-08-10 — `gallery` was deferred on a wrong assumption.** It was held back on the belief that it was a *larger* renderer arriving with v0.13's Emotes work, so content authored earlier would be rewritten. It is the opposite: **`gallery` is a simplified system page**, built to hold a large volume of gif/video, plus an **internal search bar**. That inverts the argument — it needs to exist *before* the Emotes page is written, not after. `tool` likewise marks the owner's own tools in `tools/`, which the directory alone does not express.

   **Decision: both types, with generator support, in v0.12.** Not hand-authored. The `tierlist` precedent is a hand-written page in `NEVER_TOUCH` (`generate-pages.js` bails on any type that is not `character` or `system`), which does not scale to a gallery per gamemode or a page per tool.

   The two Main Dashboard columns stay in **v0.13**, where they sit immediately after the eleven `others/` pages are scaffolded — built earlier they would be ~14 links to pages that do not exist.

   **Correction, 2026-08-10.** An earlier note here claimed a page created with category "Others" "appears in the global sidebar the moment it exists". **That is wrong.** The sidebar reads `data/navigation.json`, a committed artifact regenerated from `site_pages` by `scripts/fetch-registry.js` — so a new page appears only after a regeneration run, exactly as `owner.html` says when it creates one. What *is* true is the narrower claim: a **new category** needs no code change, because `buildGlobalSidebarMenu` groups by whatever keys exist in the file.

   **Blocker found the same way, worth knowing before merging.** `generate-pages.js` calls `process.exit(1)` on a path it does not recognise. `others/` and `tools/` only became recognised on this branch, so **a page already created under `others/` will fail the regeneration workflow on `main` until this branch lands** — not merely fail to appear. Merge first, then regenerate.

   This is also the concrete case for **v0.12 item 4**: today the choice is the manual `workflow_dispatch` button or waiting for the 04:00 cron, and the owner hit that lag within minutes of creating their first Others page.
4. **Data-layer Phase 0, revised.** With 30 contributors, waiting up to 24 hours to see a new page is intolerable. Auto-trigger regeneration on save via `repository_dispatch` — minutes, not a day. **Note the reversal:** `V0.12-DEVLOG.md` currently says `navigation.json` should become a live database read. That is wrong now — with a 1.4M-member Discord, per-visitor database reads for the sidebar put quota and bandwidth on the critical path of a site GitHub Pages serves free from a CDN.
5. ~~**Site-wide progress view** in owner tools~~ — **moved to v0.13** (owner, 2026-08-11). Unbuilt, and the only v0.12 item that is. It belongs beside the content push it exists to measure rather than ahead of it.

6. **Media aspect ratios: square the skill cards and the character portraits** (owner, 2026-08-10).

   Small, but **it belongs in v0.12 rather than later** for the same reason everything else here does: the team is about to upload skill media for ~20 characters. Nothing needs re-uploading if the ratio changes afterwards — cropping happens at render time — but contributors *compose* clips to look right in the box they can see, and changing the box shape afterwards means asking them to recompose. Cheaper to settle first.

   Current state, checked rather than assumed:

   - **Skill cards** (`js/framedata.js` → `.skill-media-wrapper`, `style/FrameData.css:34`) are `aspect-ratio: 16 / 9` with `object-fit: cover` on the media. So they already crop; the ask is to change the box to **1:1**.
   - **Character portraits** (`js/description.js` → `.profile-portrait`, `style/Layout.css:406`) have **no `aspect-ratio` and no `object-fit` at all** — just `width: 100%`. They render at the file's natural shape, so a tall portrait makes a tall card and a wide one makes a short one. This is why the owner expects "some custom cropping": there is currently no crop to adjust, and adding `1:1` + `object-fit: cover` will start cropping images that have never been cropped before. **Expect existing portraits to need re-framing, and check them against the live site before shipping.**

   **The open design question is the fallback.** *"Fallback to 16:9 if the cropping takes a bit too much of the profile"* cannot be expressed in CSS alone — it is a per-media judgement. Three ways, in rough order of preference:

   1. **Automatic, from natural dimensions.** On load, compare the media's intrinsic ratio to 1:1; past some threshold (wider than ~4:3, or taller than ~3:4), fall back to 16:9 rather than discarding half the frame. No authoring burden, works for the media already uploaded — but a contributor cannot override it, and the page shape changes after the media loads unless the ratio is known up front.
   2. **A per-move override** (`media.ratio: 'square' | 'wide'`) authored in the editor next to the existing alt-text field. Predictable and controllable; costs a field and a migration-free `desc_data`/`frame_data` addition.
   3. **Both** — automatic default, explicit override when it guesses wrong. Most work, and probably the right end state.

   Worth deciding before implementing, since option 2 adds an editor field that the content team would rather learn once.

### v0.13 — Everything else in the game

The visible expansion.

1. **Media moderation and upload limits.** **Re-scoped by the owner 2026-08-11, and smaller than written.** Two of the original fears do not hold: anonymous uploads are blocked by RLS (probed live), the bucket already enforces a MIME allowlist, and a 15 MB cap is in place. Measured state: 198 files, 346 MB.

   What the owner actually wants is deliberately light — **unchecked media stays fully usable and visible**, a queue in admin lists what nobody has looked at, reviewers and the owner work through it, and a flagged item becomes unrenderable. **Deletion stays the owner's**, optionally extended via a capability column (item 9) rather than a new role. Everything in the bucket today is already owner-approved and must be seeded as checked, not presented as a backlog.

   Two findings worth carrying into the build, detailed in `V0.13-DEVLOG.md`: `runMediaGC` in `js/owner.js` can delete the entire bucket if any of its three queries errors, so it must not be automated before that is guarded; and "unrenderable" is client-side only, so a blocked file still sits at its public storage URL — decide whether blocking also moves the object.
2. ~~**The Emotes gallery page type**~~ — **shipped in v0.12.** The renderer, the search, and media submission all exist. What remains here is the Emotes *page* and its content.
3. **The other ten `others/` pages** scaffolded; content is the team's.
4. ~~**The "Others" and "Tools" columns**~~ — **shipped in v0.12**, pulled forward. The Main Dashboard layout rework beyond those two columns is still open.
5. **Site-wide progress view** in owner tools — **moved here from v0.12** (owner, 2026-08-11). "Pages That Need Work" covers characters only; with 30 people working through ~35 pages you need one view of done / in progress / untouched. This is the daily control surface, and it is more useful once the `others/` pages exist to appear in it.
6. **Skill Builder ID Reader** linked in. The tool-page editor it needed shipped in v0.12, so this is now just the config plus a link.
7. **Certified Tier List** — the free-submit community ranking. Registers against the tool host that shipped in v0.12; the anti-brigading rules from v0.14 item 3 apply to it and should be designed with it, not after.

8. **Submitting more than one tab at once.** Contributors edit three tabs, press Submit once, and only the tab they were standing on becomes a ticket — the rest stays as a local draft they never asked for. Observed repeatedly by the owner once the tab strip made moving between tabs easy. v0.12 shipped a "One tab per submission" notice at the top of the workspace as a stopgap; **this item retires it.**

   **Most of the machinery already exists.** `js/editor-core.js` already collapses several deltas into one `multi` ticket whenever a single tab produces more than one, and the reviewer side already renders a `multi` ticket with per-scope diffs and changed-tab markers. What is missing is only that the payload scan runs against `window.currentEditorTabId` instead of every tab: the per-tab branches (moves / overview / matchups / counterplay) need lifting into a function called once per tab, and the pre-submit collision check needs the same treatment.

   Two things to settle while building it: the QA modal collects one changelog for what becomes one ticket, which is probably right but should be a deliberate choice; and a contributor who edited two *character states* produces deltas across both, which batch correctly but leave the reviewer's preview opening on only one of them.

9. **Capability columns for per-user perks.** Confirmed by the owner 2026-08-11 as the general mechanism, not just the moderator case: **one role per user stays**, and anything extra is a boolean on `user_roles` (`can_moderate`, `can_delete_media`, and so on). `UNIQUE(user_id)` and `get_my_role()` are untouched, which is the whole point — multi-role previously broke `get_my_role()` with *"more than one row returned by a subquery"* and took out that user's access everywhere. Roles stay a hierarchy; perks bolt on.

**Added by the owner 2026-08-11:**


10. **Make clearing orphaned media safe.** `runMediaGC` deletes the whole bucket if any of its three reference queries errors — see the devlog. Guard it before anything else touches media.
11. **Multi-file upload in the media library.** One file at a time today, which is what produced seven raw clips uploaded one by one in fifty minutes.
12. **Two new matchup tiers:** Slight Disadvantage and Slight Advantage, between the existing Disadvantage/Advantage and Equal.
13. **Two renamed matchup tiers:** Unloseable → Dominating, Unwinnable → Hopeless. Less absolutist. **This is a data change, not a wording change** — 32 live entries use the old words, and `page_history` must not be rewritten. Detail in the devlog.
14. **Character and frame-type colours in the editor's colour presets.** `window.CHARACTER_COLORS` and `window.FRAME_COLORS` already exist; the preset row is seven hardcoded swatches that know about neither.

### v0.14 — Community

1. **Per-character discussion threads** (or full forums, if that is the call).
2. **Moderator capability** and moderation UI.
3. **Free-submit community tier list.** Needs anti-brigading from day one — one submission per account, rate limiting, and a visible sample size. With 1.4M people it will be brigaded, and an averaged ranking with no vote count is meaningless.
4. **Abuse-resistance UI**, rate limiting, contributor leaderboard.

### v0.15 — The original v0.12

Site-wide search, new block types, `CONTRIBUTING.md`, the multicolor shortcode, tier-list edit-in-place, side-by-side character comparison.

Search moves last deliberately: **it is a discovery tool for content that does not exist yet.** It becomes genuinely valuable once the team has filled the site, and nearly useless before.

### v1.0 — Release candidate

Draft cloud-sync, analytics, final cross-browser QA, a security re-audit before the Discord link goes live, and the standing check that "all character pages finished" is no longer an exclusion — under the endorsement it becomes a requirement, at 1-2 unfinished maximum.

---

## 5. What this changes about the roadmap

The existing roadmap had v0.12 (content/discovery), v0.13 (scale-readiness), v1.0. This proposal **redefines v0.12 and v0.13 and adds v0.14 and v0.15**.

That is a deliberate roadmap update rather than the thing the project's own rule forbids — which is inventing a version number for unplanned work. An external factor genuinely changed; the plan should change with it. But it is the owner's roadmap, and this section exists so the change is explicit rather than absorbed silently.

**Open questions:**

- Is "Skill Builder" as an `others/` system page (explaining the in-game feature) genuinely separate from the "Skill Builder ID Reader" tool? Assumed yes.
- Moderator: parallel to reviewer, confirmed. Should a moderator also be able to submit edits like an ordinary signed-in user? Assumed yes.
- The bug list, still to come.
