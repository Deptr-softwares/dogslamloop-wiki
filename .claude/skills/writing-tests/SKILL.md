---
name: writing-tests
description: Use when writing, fixing, or reviewing Playwright tests for this project, or when a test fails and you are deciding whether the code or the test is wrong. Covers interaction coverage, revert-confirm-restore, OS-dependent assertions, and what the suite fundamentally cannot reach.
paths: tests/**
---

# Writing tests here

## Test the interaction, not the render

A page that loads is not a page that works. **Drive a real control** — click the primary action, type in the primary field — and assert both:

- no `pageerror` fired, and
- a visible consequence occurred.

`post-editor.html` shipped into a PR with a green 241-spec suite and three bugs that made it unusable, because its test only asserted the page rendered. Every block operation threw a `ReferenceError`; the Add Block button was unreachable below a non-scrolling container.

```js
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.click('#primary-action');
expect(errors).toEqual([]);
await expect(page.locator('#result')).toBeVisible();
```

## Assert the rendered consequence, not the thing that should cause it

A class, an attribute or a data field being correct is **not** evidence that
the page looks right. Read back what the browser actually computed.

v0.15's notation colouring shipped nine passing tests while the feature was
visibly broken: every one asserted `classList` contained `is-2`, which it
always did. `.combo-node` sets `color` in a stylesheet that loads later at
equal specificity, so the class applied its `font-weight` and not its colour.
The owner diagnosed it in four words — *"thickened but not orange"* — because
they were looking at the page and the tests were looking at the DOM.

```js
// Proves the class was added. Proves nothing about the page.
expect(chip.className).toContain('is-2');

// Proves the reader sees it.
const painted = await chip.evaluate(el => getComputedStyle(el).color);
expect(painted).not.toBe(plainTextColour);
```

Compare against a **resolved** value, not a literal: read the CSS custom
property and let the browser resolve it, so the test follows the palette
instead of pinning a hex.

This is the same failure as asserting a mock was configured rather than that
the request went through. The question is always "what would the user notice",
and a class name is never the answer.

## A passing assertion may be passing for the wrong reason

The failure this project keeps producing is not a wrong assertion — it is a
right one that stops being about anything. Two shapes cause nearly all of it.

**An absence assertion survives the change that should break it.** v0.15's diff
view renamed schema keys to words for the reviewer, and two assertions in
`admin-structured-diff.spec.js` checked that a raw key was *not* present. They
kept passing, because the key was now spelled differently — testing nothing at
all. Assert the positive: `toContain('On Block')`, not `not.toContain('onBlock')`.
Where an absence really is the claim, assert what is there instead — for XSS,
that the tag survives **escaped**, not that a substring is missing.

**`toBeVisible()` is not "the user can click it".** Twice in one session a
button was visible and unreachable: confirmation modals rendered under the modal
that opened them, and the reorder controls sat under an absolutely-positioned
`✖`. Both were found by a click *timing out*, never by an assertion. What
decides a click is which element is on top at that point:

```js
const onTop = await page.evaluate(() => {
  const b = document.getElementById('editor-modal-confirm');
  const r = b.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return b.contains(hit) || hit === b;
});
```

A third variant: a fixture that makes its own assertion vacuous. A changed-tabs
test set `currentPendingDescData` equal to live, so "these tabs changed" was
trivially empty. **When a test passes first time, ask what would have to break
for it to fail** — and if the answer is "nothing reachable", it is not a test.

## A consistency check only finds drift in the direction it looks

"Everything I offer resolves" and "everything real is offered" are different
claims. v0.15's section-link picker satisfied the first completely while
offering **no moves at all** — internally consistent and blind to a third of
the site. The second direction found that, plus two more omissions, at once.

Whenever two derivations of the same thing must agree — a picker against a
renderer, an apply function against a diff view — compare them **both ways**.

## Revert-confirm-restore, for every bug fix

Before claiming a fix works: temporarily revert it, confirm the new spec
**fails**, restore, confirm it passes. A regression test that never failed
against the old code proves nothing.

**COMMIT THE FIX FIRST.** Then the undo is `git restore <file>`, which is exact
and safe. This is not a style preference — it is the only version of this
procedure that cannot lose work.

`git checkout -- <file>` restores from HEAD, so on an uncommitted file it
discards **every** change to it, not just the probe. That has now happened
three times here. The third was during v0.15's Techs tab: a one-line
falsification edit was undone that way and took the whole uncommitted
implementation of that file with it. It survived only because that particular
probe happened to start with a manual backup.

Taking backups is not the fix; committing first is. An extra commit on a
feature branch costs nothing and turns a destructive command into a harmless
one.

## Assert structure, not pixels

Exact geometry is OS-dependent — Linux renders these fonts wider than Windows, so a `getBoundingClientRect()` comparison passes locally and fails in CI for reasons unrelated to the bug.

Assert the structural consequence instead:

```js
// Brittle: fails in CI on font metrics alone
expect(btn.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);

// Robust: the actual claim being made
expect(buttonGroupTop).toBeGreaterThanOrEqual(titleBottom);  // it stacked
```

Same reason `visual.spec.js` is `testIgnore`d in CI (`playwright.config.js`) — its baselines are per-platform and can never match a Linux runner. It stays a local before/after tool for CSS work.

## A failing test is a hypothesis, not a verdict

Before changing code to satisfy a red test, confirm the test is asking the right question. Three times in this project a test accused correct code:

| Symptom | Actual cause |
|---|---|
| "insert never fired" | Selector `button.btn-sys-green` matched a row's RESTORE button before the CREATE button |
| "escaping is broken" | Route pattern lacked a trailing `*`; `fetchJson` appends a cache-buster, so the mock never matched and real data loaded |
| "submit handler dead" | Mock session had no `email`; `getDisplayName` and `editor-core`'s fallback both call `session.user.email.split('@')`, so boot threw before the handler attached |

When a test fails, reproduce the behaviour manually or add a debug spec that prints actual state before concluding the code is wrong.

## "Cannot reproduce" is a claim about your probes, not about the bug

v0.16 bug 1 — typing dragged the workspace upward — survived **twelve** probes
that all reported clean. Different pages, block types, viewport widths, the
pre-change renderer served over the live page, the virtualizer on and off. It was
closed as not reproducible, and a screen recording reopened it the same day.

Every one of the twelve had typed into a block with content **below** it. There
the scroll range has slack, so the collapse that causes the bug costs nothing and
nothing moves. The bug was fully present two hundred pixels down the same page.

**The variable that mattered was never in the list**: where in the scroll range
the contributor was standing. Twelve probes sharing one unexamined assumption are
one piece of evidence, not twelve — and a rising count feels like rising
confidence while proving nothing.

So before writing "cannot reproduce", **write down what every probe held
constant**. Scroll position, focus, viewport, whether the element is first or
last, empty or full, at a boundary or in the middle. Then vary one of those,
rather than adding a thirteenth scenario that varies what you already varied.

Ask the reporter for a recording early. Reading the real screen cost minutes and
answered it immediately; the frames can be decoded in-browser with a `<video>`
and a canvas when no usable `ffmpeg` is around (Playwright's bundled one has no
H.264 decoder).

### `element.focus()` is not a click

The single probe in that set that *did* reproduce something was lying.
`element.focus()` scrolls its element into view; a mouse click does not, because
the element is already under the pointer. It produced a clean, repeatable 426px
jump for something no contributor can trigger, and it was the most convincing
evidence in the whole investigation.

**Drive focus the way a person does** — `page.mouse.click(x, y)` or
`locator.click()` — and reserve `.focus()` for asserting what already has focus.
A synthetic event that moves the viewport has invented the symptom you are
hunting.

## A live page is not an empty page

Specs here load real pages against real Supabase data, and the owner edits that
data. Three v0.15 tests assumed the group or table they had just created was
index 0, read the owner's own Boomcat content instead, and compared it against
their own input.

Record the handle the code gives you rather than counting from the front:

```js
// Reads whatever the owner happens to have written first.
const group = window.currentEditorDescData.comboGroups[0];

// Reads the one this test opened.
const idx = parseInt(String(window.currentCombosSection).replace('group-', ''), 10);
const group = window.currentEditorDescData.comboGroups[idx];
```

Same rule as never pinning a count to owner content, in the shape that is
easier to miss: not a hardcoded number, but an assumption that a real page
starts empty.

## Derive the blast radius, do not guess it

Running "the touched specs plus the neighbours" is the right instinct for a
local change. **It is the wrong instinct for a change of DEFAULT behaviour**,
because the neighbours of a default are every spec that ever relied on it, and
that list does not look like the list of files you edited.

v0.16 made editor blocks start collapsed. Seven hand-picked specs passed, CI
came back with **ten failures in five files nobody would have called
neighbours** — the colour picker, the preset swatches, in-page links, a dedupe
spec, the tier editor. All of them typed into a field that is now inside a
collapsed block.

Pick the set with a command instead:

```bash
npx playwright test $(grep -rln "block-list\|block-card\|editor-textarea" tests/*.spec.js | tr '\n' ' ')
```

Grep for the **markup and globals the change touches**, not for the feature's
name — those five files never mention collapsing, folders, or the workspace.
Fourteen files matched; running them found every failure before pushing.

## Never run two full suites at once

`playwright.config.js` starts one dev server on a fixed port and the workers
share it. A second concurrent run does not just take longer — it reports a
**different test count** and a scatter of failures that all pass in isolation.
v0.15 burned several rounds on runs reporting 519, 951, 975 and 984 of the same
980 tests.

If a run reports failures, re-run **those specs alone** before believing them.
A failure that passes in isolation is load, not a bug — but a *consistent*
failure in isolation is real, and that is the only way to tell the two apart.

This is routine rather than exceptional: v0.15's final Techs run reported 7
failures and 5 of them — dashboards, editor-modes ×2, media-gc-guard, posts —
passed untouched in isolation.

**And never change the working tree while a suite is running.** Same hazard,
worse symptom. Switching branches mid-run during v0.15 produced "15 failed" and
"exit code 0" from the same run, and both numbers were meaningless — the workers
were reading files swapped underneath them. A suite whose tree moved is not a
failed suite, it is not a suite at all, and its output has to be thrown away
rather than diagnosed. Commit, run, then leave it alone.

## What this suite cannot reach

**RLS policies, GRANTs and RPC guards are invisible here.** Every auth spec mocks the Supabase client and never touches real Postgres. Asserting a permission change without probing production is asserting nothing — see the `supabase-migration` skill.

Also unreachable: GitHub Pages 404 routing (the local `python -m http.server` doesn't replicate the fallback), Discord/OG unfurling (assert the tags exist in the **served HTML**, not the DOM — a DOM check passes for JS-injected tags, which unfurlers never see), and GitHub Actions behaviour.

## Conventions

- Specs live flat in `tests/*.spec.js`, one per feature or bug.
- Lead with a comment explaining what bug or contract the file exists to protect. Future readers need to know why an assertion is there before they relax it.
- Node-only tests (pure functions, generators) still use the Playwright runner — see `tests/generate-pages.spec.js`.
- Throwaway debug specs: prefix `_`, delete before committing.

## Mocking Supabase

For the `addInitScript` + `Object.defineProperty(window, 'supabase', …)` pattern used across the auth-dependent specs, including the query-builder chain shape and the session fields that must be present, read `mocking.md` in this skill's directory.
