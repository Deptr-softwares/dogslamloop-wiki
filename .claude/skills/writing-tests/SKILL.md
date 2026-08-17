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

## Revert-confirm-restore, for every bug fix

Before claiming a fix works: temporarily revert it (`git stash push -- <file>`), confirm the new spec **fails**, restore, confirm it passes. A regression test that never failed against the old code proves nothing.

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

## Never run two full suites at once

`playwright.config.js` starts one dev server on a fixed port and the workers
share it. A second concurrent run does not just take longer — it reports a
**different test count** and a scatter of failures that all pass in isolation.
v0.15 burned several rounds on runs reporting 519, 951, 975 and 984 of the same
980 tests.

If a run reports failures, re-run **those specs alone** before believing them.
A failure that passes in isolation is load, not a bug — but a *consistent*
failure in isolation is real, and that is the only way to tell the two apart.

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
