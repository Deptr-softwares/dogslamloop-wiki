---
name: writing-tests
description: How to write, falsify, run and read Playwright tests in this project, and how to decide whether a red test or the code is wrong. Use when writing or reviewing a spec, proving a fix with a test, choosing which specs to run, reading a test run or CI failure, or diagnosing a bug that will not reproduce.
paths:
  - "tests/**"
  - "playwright.config.js"
---

# Writing tests here

A test proves something only if it can fail. Most rules below are ways a passing test stopped being about anything.

- Choosing which specs to run, and reading a local run or a CI failure: [running.md](running.md)
- When a test accuses the code, or a bug will not reproduce: [debugging.md](debugging.md)
- Mocking Supabase, routes and `.single()`: [mocking.md](mocking.md)

## Assert what the reader would notice

- **Drive the real control**, then assert no `pageerror` and a visible consequence. `post-editor.html` passed a render-only test while every block operation threw.
  ```js
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.click('#primary-action');
  expect(errors).toEqual([]);
  await expect(page.locator('#result')).toBeVisible();
  ```
- **Read back what the browser computed, not the class that should cause it.** v0.15's notation colouring had nine green tests asserting the class `is-2` while a later stylesheet won on `color` (the owner: *"thickened but not orange"*). Compare against a resolved custom property, not a literal hex.
  ```js
  const painted = await chip.evaluate(el => getComputedStyle(el).color);
  expect(painted).not.toBe(plainTextColour);
  ```
- **Assert the positive.** An absence check (`not.toContain('onBlock')`) keeps passing once the key is spelled differently. For XSS, assert the tag survives escaped.
- **`toBeVisible()` is not "the user can click it".** Modals under the modal that opened them, controls under an absolutely positioned `✖`: check what is on top.
  ```js
  const onTop = await page.evaluate(() => {
    const b = document.getElementById('editor-modal-confirm');
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return b.contains(hit) || hit === b;
  });
  ```
- **A fixture can make its own assertion vacuous**: pending data set equal to live made "these tabs changed" trivially empty. When a test passes first time, ask what would have to break for it to fail.
- **Compare two derivations both ways.** "Everything offered resolves" and "everything real is offered" are different claims; the v0.15 link picker passed the first while offering no moves at all.
- **Structure, not pixels.** Linux renders these fonts wider than Windows, so assert the structural claim (`buttonGroupTop >= titleBottom`: it stacked), not a pixel edge.

## Live data is the owner's

Specs load real pages against real Supabase data, and the owner edits it. A test an owner edit can turn red stops the regeneration job (`CLAUDE.md`, Deploy model).

- Never assert a count of anything the owner controls, and never compare a frozen artifact with a regenerated one.
- **A fixture must not retype what a generator emits.** `registry-roundtrip` listed the flags by hand and silently dropped `is_hidden`. State the mapping once and reverse it (`NAV_FLAGS` in `scripts/fetch-registry.js`).
- **Record the handle the code gives you; don't count from the front.** `comboGroups[0]` is the owner's Boomcat content. Read the index from `window.currentCombosSection`.
- **A test that needs particular content serves a frozen fixture** from `tests/fixtures/` (as `input-slots.spec.js` does for Crow Charmer), never the live row.
- Ask: **what could the owner do tomorrow that makes this fail?** Adding, colouring, hiding or renaming a character are normal Tuesday actions.

## Falsify every fix

1. **Commit the fix first.** The undo is then `git restore <file>` from a commit. `git checkout -- <file>` on an uncommitted file discards the whole implementation, not just the probe; it has happened three times.
2. Break the fix, confirm the new test **fails**, restore, confirm it passes. A regression test that never failed proves nothing.
3. **Check the mutation applied.** Apply it through something that confirms its anchor matched exactly once: replacing a string that is not there is a silent no-op, and v0.20 read one as "this test cannot catch it".
4. **`node --check` the mutated file**, and distrust a catch that turns the whole spec red. One guard broken should fail only the tests about that guard.
5. **A survived mutation is a question.** Either the code's behaviour did not change (appending a node twice just moves it) or the test cannot see it (a drag that ends on another element fires no `click` in Chromium). Find out which before rewriting either.
6. **A fake keeps the real thing's state over time** (first call wins, counters, leases), or it hides bugs that depend on when it is asked.

## Shared pages

Anything that renders over a shared page on load changes every spec on it: v0.18's first-visit notice covered `edit.html` in 59 specs, because every test starts with empty `localStorage`. Seed the dismissal once in `playwright.config.js` (`use.storageState`). The one spec that tests the notice resets it with `test.use({ storageState: { cookies: [], origins: [] } })`.

## Out of reach

RLS, grants and RPC guards (probe them: the `supabase-migration` skill), GitHub Pages 404 routing, Discord and OG unfurling (assert the tags in the served HTML, not the DOM), GitHub Actions, and whether a real media link still resolves.

## Conventions

- Specs live flat in `tests/*.spec.js`, one per feature or bug, led by a comment saying what bug or contract the file protects.
- Node-only tests still use the Playwright runner (`tests/generate-pages.spec.js`).
- Throwaway debug specs: prefix `_`, delete before committing.
- `visual.spec.js` is local-only (`testIgnore` in CI): a before/after tool for CSS work.
