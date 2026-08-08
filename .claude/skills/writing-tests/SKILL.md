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
