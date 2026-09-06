# Silent release 2 — runtime coverage, and the XSS it led to

**Not v0.18, and not on the roadmap** (owner, 2026-09-06). No version bump, no
changelog entry, no Discord post. `V0.18-DEVLOG.md` sits alongside this file and
stays untouched, exactly as it did through silent release 1.

PRs #171, #172, #173 into `next-update`; #174 is the release into `main`.
2026-09-05 to 2026-09-06.

**Why silent:** nothing here is a feature. Two things a reader could technically
point at — Recent Changes links for `tools/` and `others/` pages that stopped
404ing, and the Template page's Raw JSON section that had been rendering a
heading with nothing under it — are both fixes to things nobody was told were
broken. The rest is a test sweep, four security fixes, a workflow change and
documentation.

---

## Where this came from

Not from a requirements file. It came from a sentence the owner wrote while a
different PR was running its checks:

> *"Most of the times, I have been bringing up bugs that are visible when
> viewed via Live Server or when it is live and reported."*

That is a statement about the suite, not about the bugs, and it turned out to
be measurable:

| | |
|---|---|
| Spec files | 174 |
| Specs listening for `pageerror` | 54 |
| **Distinct pages ever loaded end-to-end** | **12, of ~62** |
| Character pages covered | 1 of 23 (Boomcat) |

The suite was deep on logic and shallow on pages. Fifty pages were loaded by
nothing at all, so the owner was the only thing loading them. That is the whole
explanation for the pattern they had noticed, and it is why the first item was
a sweep rather than a review: a static review of 61 modules reads code, and the
bugs reaching them were runtime.

`smoke.spec.js` was the ancestor and stays as it is — twelve representative
pages asserted carefully. It could not be widened in place because of a
limitation worth recording: **the console reports a failed resource without a
URL**, so its filter cannot be narrower than the status code, and it therefore
cannot tell a dead fallback from a missing stylesheet. Reading the URL off the
`response` event instead is what made specificity possible, and that is the
only real difference between the two files.

---

## The items

### 1. A sweep that loads every page (#171)

`tests/page-sweep.spec.js`. All 65 pages, failing on a `pageerror` or a 404 for
a site asset. ~1.5 minutes.

The page list is derived from `navigation.json` plus the root HTML files, and
nothing in it counts pages, names a character, or asserts anything an owner
edit can change. That was a deliberate constraint rather than style — see the
corrections below for how well it held.

**It found two real pageerrors immediately**, both on `owner.html` when logged
out, both the same shape: `loadPageMeta` and `loadHubText` check their elements
exist, `await` Supabase, and the RBAC gate replaces the page while the query is
in flight. The captured element reference stays usable because it is merely
*detached*, so the write succeeds and nothing looks wrong — it is the fresh
`getElementById` in the helper underneath that returns null and throws. Fixed
with one re-check after each await rather than guards on five helpers.

`owner-page-meta.spec.js` could never have caught this: it mocks a signed-in
owner, so the elements always exist.

### 2. `others/` and `tools/` threaded through (#171)

Requested by the owner as tidying. It was a live bug.

`js/owner.js` states the design directly — *"These were the same thing until
now: page_type decided the directory... They are different questions"* — and
`site_pages.url` has stored the real path ever since. `buildPageUrl` in
`js/site_utils.js` never got the message:

| pageType | returned | actually lives at |
|---|---|---|
| `tool` | `characters/Skill_builder_id_reader/` | `tools/…` |
| `gallery` | `characters/Emotes/` | `others/emotes/` |
| `system` | `systems/<id>/` | *sometimes* `others/<id>/` |

Its callers are Recent Changes and the admin approve/reject path, so those
links and every **stored approval notification** for such a page pointed at a
404. The notification is the worse case: clicked days later, with no context.

`primePageUrlIndex` now builds a `pageId → url` index from `navigation.json`
plus `archived-pages.json` (an approved revision can point at a tombstone). The
folder convention stays as a fallback, so an unprimed caller is no worse off
than before.

Both pre-Supabase local-JSON fallbacks were deleted in the same pass, because
the descriptions one was the other half of this bug — it built
`systems/custom_servers/…` for a page in `others/`. **Neither file they looked
for exists anywhere in the repo**, so they could only ever 404.

### 3. The Template page's Raw JSON section (#171)

Found by removing the sweep's allow-list once those fallbacks were gone.
`characters/Template` renders a **"Behind the Scenes: Raw JSON"** section by
reading those same dead files. Both fetches 404'd, both accordions were skipped
by a `continue`, and `appendChild` ran regardless — so the page had been showing
that heading with nothing underneath it, on the page contributors are pointed
at. It reads `page_data` now.

Its regression test asserts a **contract** — either the section has content or
it is not rendered at all — rather than anything in the template row, so an
ordinary content edit cannot fail it.

### 4. Content can reach the live site without a release (#172)

Owner's request. Content is data, but it needed a code release to go live: the
only route from *"the owner created a character"* to *"readers can see it"* was
a `next-update → main` release PR, which drags every unreleased change along
with it. The page created on 2026-09-04 was unreachable until a release two
days later for exactly that reason.

`workflow_dispatch` gained a `publish_to_main` checkbox, default off. The
nightly cron carries no inputs, so a scheduled run regenerates `next-update`
alone and cannot deploy — which keeps the one property the release PR was
really providing, that nothing reaches readers unless somebody decided it
should.

**The blocker was concrete, not theoretical.** Stubs embed an asset stamp
derived from `js/`, so two branches holding different unreleased JS legitimately
produce different stubs — `main` was `v301ffd47` and `next-update` `v9e9f3511`
across all 62 pages at the time. Copying either way stamps every page wrongly.
Each branch therefore regenerates from Supabase **with its own code**, which
needs no merge between them.

Verified rather than assumed: both rulesets carry a `DeployKey` bypass actor
with `bypass_mode: always`, so no configuration change was needed.

Consequence, recorded in the `silent-release` skill: `main` and `next-update`
now each carry their own `chore: regenerate` commits, so the divergence check
has to exclude them or it reads dirty after every publish.

### 5. Four proven XSS holes (#173)

A deliberate sweep of all 517 `innerHTML` interpolations. 194 carried
contributor-influenced data; restricting to those that land in markup left 56;
tracing each left four that were genuinely exploitable. **Every one is proven by
a test that watched the payload fire**, not by reading the code.

| File | What | Reachable by |
|---|---|---|
| `js/tierlist.js` | tier names, changelog notes, portrait ids. The file had **no escaper at all**. | anyone reading the tier list |
| `js/description.js` | tab labels in the system-page nav | anyone reading a system page |
| `js/history.js` | `target_key` inside an inline `onclick` | **one click** on a history tab |

**The `history.js` one is the worst.** Its tab list comes from the fixed
vocabulary with one exception: a delta revision scoped to a move pushes
`rev.target_key.split('::')[0]` in as a tab id, and `target_key` is
contributor-submitted. It rendered:

```
onclick="window.switchHistoryTab('');window.__xssFired=true;//')"
```

Escaping cannot fix that construction — the browser decodes entities before the
JS is parsed. It is a `data-` attribute with a delegated listener now, which is
what `CLAUDE.md` says to do and is the concrete reason it says it.

**The `description.js` one is the instructive one.** That identical bug was
found and fixed in v0.15 — *in the admin preview*
(`admin-preview-states.spec.js`, "a state label cannot inject markup into the
toggle or the popup"). The renderer readers actually load never got the same
fix. **Fixing a class in one renderer and not its twin is a shape worth
hunting.**

### 6. Three tests that were wedging the pipeline (#172)

See the corrections below; this is where they belong.

### 7. Documentation (#171, #173)

`CLAUDE.md` gained the rule that a red test stops the content pipeline, the
Supabase first-push branching behaviour observed on #165, and how content
publishing works. The `writing-tests` skill gained the three shapes that couple
a test to owner content, and "derive affected specs by surface, not identifier".

`history.js` got the module header it was the only one of 61 missing — written
as what the module *is* and how it reaches the rest of the site, which is the
shape the owner asked comment work to take when they raised a comments cleanup.
That cleanup was **considered and rejected**: 60 of 61 modules already had
headers, only 258 of 7,791 comment lines were incident narrative, and with no
design doc in the repo the comments are the design doc. The reframing that
survived is that the defect is *staleness*, not volume — a comment describing
code that no longer exists actively misleads.

---

## Corrections

The highest-value part of this file, because the diff carries none of it.

**A test was shipped that could wedge the content pipeline, in the same week
the rule against it was written — twice.** `CLAUDE.md` now says a test an owner
edit can turn red is a production outage rather than a failing test. That rule
was added in #171. Within hours, `page-sweep.spec.js` (added in the same PR)
failed because the owner created "Sky Assassin" without its roster icon, and it
took `smoke.spec.js` and `roster-icon.spec.js` down with it. The regeneration
job commits only after the suite passes, so all generated content stopped.

The reasoning that produced each:

- **`page-sweep`** failed on any local asset 404, images included. `medias/`
  holds owner-uploaded content and the site is *built* for it to be missing —
  `markLoadedRosterIcons` removes the `<img>` on error and the card falls back
  to the pre-v0.16 design. It now separates site assets (js, css, fonts, data —
  which an owner cannot cause to go missing) from `medias/`.
- **`smoke`** had its 404 suppression narrowed to 406 on the reasoning that the
  dead JSON fallbacks were deleted, so any remaining 404 must be real. That
  **generalised from the content that existed that afternoon to all content
  ever**, and was wrong within hours.
- **`roster-icon`** asserted that every rendered card requests an icon that
  exists, under a comment claiming that "stays true as characters come and go".
  It does not — it holds only while every character happens to have had its
  icon uploaded. It avoided the obvious trap (counted nothing, named nobody)
  and walked into a subtler one. It now asserts the two designed states: icon
  shown, or cleanly fallen back.

**A test passed while the injection had fully succeeded.** The first version of
the `history.js` XSS test asserted only that nothing had fired after load. It
passed. The button had been rendered carrying the injected handler in its
`onclick`; the payload was simply waiting for the click any reader opening that
tab would give it. It was caught only by asking what would have to break for it
to fail. **A handler that has not run yet is not a handler that is safe.**

**Three of the sweep's findings were false positives, and none was obvious.**
`recent-changes.js` escapes on the line above the flagged one.
`internalstyling.js` receives *pre-escaped* text — `description.js` escapes at
the source ("escape first, then add the generated markup") — so escaping there
again would double-escape and break nested shortcodes. And four SQL
`get_my_role() = 'admin'` sites, all pre-dating the v0.17 owner/admin split and
all looking like the owner had been locked out, were already replaced with
`is_owner()` by `20260827000003_owner_role.sql`. **Grepping
`supabase/migrations/` finds historical text, not deployed state** — migrations
are cumulative and a later one supersedes an earlier file's words.

**A clean rebase is not a correct tree.** Rebasing #173 onto #172 reported
success with no conflicts, and left Sky Assassin's stub carrying a stale asset
stamp. `npm run validate` caught it. Regenerated, never hand-merged.

**`ERR_CONNECTION_REFUSED` was local load, not a bug.** It appeared on two
pages at four workers and on none at one. Asserting transport-level failures
would have bought a permanently flaky spec, and flaky here means regeneration
stops committing at random. The sweep deliberately does not assert them.

---

## Still open

**The owner's.** Sky Assassin's roster icon (coming later — the card falls back,
so nothing is broken) and its colour. The 11 CMS pages with no `page_data` row:
the Gamemodes, Misc and Servers pages plus M1 Trading, almost certainly just
unwritten.

**Found, reported, deliberately not fixed.** `.btn-sys` is fully redefined,
unscoped, in `editor.css:1872` as well as `Buttons.css:19` — equal specificity,
so source order decides, on the five pages that load `editor.css`. The two
currently agree, so nothing is visibly wrong; the hazard is that a change to
`Buttons.css` silently does nothing there. `editor.css:204` already calls this
the *"fourth instance of the equal-specificity/source-order family in this
project"*. The owner deferred it.

**Blocking that fix, and worth its own line.** `visual.spec.js` baselines were
last updated 2026-08-16, with **109 commits touching `style/` or `js/` since**.
They fail on real height changes unrelated to any current work. The file is
CI-ignored so nothing is blocked, but the tool is currently unusable as the
before/after that a `.btn-sys` refactor would need.
