# When a test and the code disagree

## Contents
- A failing test is a hypothesis
- "Cannot reproduce"
- Probes that lie

## A failing test is a hypothesis, not a verdict

Confirm the test asks the right question before changing code to satisfy it. Five times a test accused correct code:

| Symptom | Actual cause |
|---|---|
| "insert never fired" | Selector `button.btn-sys-green` matched a row's RESTORE button before the CREATE button |
| "escaping is broken" | The route pattern lacked a trailing `*`; `fetchJson` appends a cache-buster, so the mock never matched and real data loaded |
| "submit handler dead" | The mock session had no `email`; `getDisplayName` and `editor-core`'s fallback call `session.user.email.split('@')`, so boot threw before the handler attached |
| "the KLIPY lookup ignored its answer" | The test's route was registered before the helper's route for the same URL, and Playwright runs the last-registered handler first (see `mocking.md`) |
| "the page never finished loading" | A route that holds its response on purpose means `networkidle` never arrives; pass `waitUntil: 'domcontentloaded'` when a test holds requests |

Reproduce the behaviour by hand, or add a `_debug` spec that prints the actual state, before concluding the code is wrong.

## "Cannot reproduce" is a claim about the probes

v0.16 bug 1 (typing dragged the workspace upward) survived twelve clean probes, and a screen recording reopened it the same day. Every probe had typed into a block with content below it, where the scroll range had slack; the bug was fully present further down the page. Twelve probes sharing one unexamined assumption are one piece of evidence.

Before writing "cannot reproduce", write down what every probe held constant (scroll position, focus, viewport, first or last, empty or full, at a boundary or in the middle) and vary one of those. Ask the reporter for a recording early. Its frames can be decoded in-browser with a `<video>` and a canvas; Playwright's bundled ffmpeg has no H.264 decoder.

## Probes that lie

- **`element.focus()` scrolls its element into view; a click does not.** It produced a clean, repeatable 426px jump that no contributor can trigger. Drive focus with `locator.click()` or `page.mouse.click(x, y)`, and keep `.focus()` for asserting what has focus.
- **`goto(PAGE#id)` right after `goto(PAGE)` is a same-document navigation**: no reload, no init scripts, only `hashchange` on a page already built. To test arriving by URL, go to `about:blank` in between. A test named for arrival by hash never ran the arrival code from v0.15 to v0.20.
- **A `scrollTo` wrapper that forwards `(opts, y)` calls `scrollTo(opts, undefined)`**, which the browser reads as `scrollTo(x, y)` and sends to 0,0. Wrap with `(...args)` and forward `...args`.
