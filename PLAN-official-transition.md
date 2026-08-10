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

### Decided: reviewers navigate revisions by top tabs, not the document explorer

**Owner's request.** Today the reviewer navigates a revision through the document explorer in the left workspace, which is inefficient. It should use a top navigation bar of tabs, mirroring how live character and system pages already work.

**This also fixes a confirmed bug, and is required by the decision above.**

`js/admin-actions.js:17` guards its "Smart Routing" behind `if (rev.is_delta)`. A merged ticket is `is_delta: false`, so **no `&tab=` is ever appended**, and `js/editor-core.js:33` falls back to `'overview'`. So intercepting *any* non-delta ticket dumps the reviewer on Overview regardless of what was actually edited — which is why intercepting a skill revision is currently impossible.

The two decisions interlock: once a merge is a **multi-scope** delta, single-target smart routing is not merely broken but meaningless — there is no one tab to jump to. Top-tab navigation is what replaces it. Build them together.

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

## 4. Proposed sequencing

Ordered by **what unblocks the 30-person team**, because that is now the binding constraint. Content written before the structural work gets rewritten after it.

### v0.12 — Foundations for the team

Mostly invisible to players, and the most urgent work in this document.

1. **Character modes** (full characters) and the **Ultimate tab** (base-only). Blocks all character content. `route.tabs` already exists as a per-page override (`js/page_router.js:57`) and move IDs are already namespaced (`boomcat-first-m1`), so `desc_data.moveStrategies` needs no change. Model additively: optional `frame_data.modes`, absent means the existing top-level *is* the base mode, so all 22 existing characters keep working untouched.
2. **Qualitative frame data.** A throughput multiplier for the team, and it removes the dependency on devs supplying numbers — which may never arrive.
3. **New page types and directories.** `gallery` and `tool` added to the CHECK; `others/` and `tools/` added to the generator; the hardcoded category dropdown in `owner.html` replaced with something that accepts new categories.
4. **Data-layer Phase 0, revised.** With 30 contributors, waiting up to 24 hours to see a new page is intolerable. Auto-trigger regeneration on save via `repository_dispatch` — minutes, not a day. **Note the reversal:** `V0.12-DEVLOG.md` currently says `navigation.json` should become a live database read. That is wrong now — with a 1.4M-member Discord, per-visitor database reads for the sidebar put quota and bandwidth on the critical path of a site GitHub Pages serves free from a CDN.
5. **Site-wide progress view** in owner tools. "Pages That Need Work" covers characters only; with 30 people working through ~35 pages you need one view of done / in progress / untouched. This is the daily control surface.

### v0.13 — Everything else in the game

The visible expansion.

1. **Media moderation and upload limits** — pulled forward from the old v0.13, because the Emotes gallery depends on it. User-submitted media at Discord scale without size limits or review is the single most obvious way to get hurt.
2. **The Emotes gallery page type** — search, sort, media submission.
3. **The other ten `others/` pages** scaffolded; content is the team's.
4. **The "Others" and "Tools" columns** and the Main Dashboard layout rework.
5. **Skill Builder ID Reader** linked in.

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
