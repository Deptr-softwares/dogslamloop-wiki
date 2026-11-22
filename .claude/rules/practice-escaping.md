---
paths:
  - "js/**/*.js"
  - "scripts/**/*.js"
  - "/*.html"
---

# Escaping what people wrote

Anything a page shows that came from a user, a contributor, Discord, the URL or the database.

## Rule

- Every such value is hostile. Put it in the page with `textContent`, or through `window.escapeHtml` (`window.escapeHtmlKeepBreaks` where line breaks stay) at **every** `innerHTML` interpolation, including the ones that only ever held a name or a number.
- Never put one in an inline `onclick` or any other `on...` attribute. Put it in a `data-` attribute and read it in a delegated listener.
- A format tag's address goes through `safeUrl`, and is escaped inside the attribute.
- There is one escaper, `window.escapeHtml` in `js/utility/site_utils.js`. Two exceptions are deliberate: `page_router.js` keeps its own copy because it runs before `site_utils.js` loads, and `escPageText` in `internalstyling.js` escapes only `&`, `<` and `>` so a move name with an apostrophe still matches.

## What happened

- 2026-08-14 (#90): three stored-XSS holes in the format-tag engine. That week the counterplay card (#92) and contributor Block content (#105) were escaped too.
- 2026-09-06 (#173): a sweep of every `innerHTML` write found four more proven holes.
- From October, five hotfixes each escaped one more place that showed stored text as markup: frame data, profile stats and editor labels (#233), custom tab names and matchup opponents (#235), the editor's VIEW DIFF list (#281), an unsupported Block's type (#294), and every field of a submitted tier list (#296).
- 2026-11-20 (#293): 55 definitions of the escaper were removed. 37 of the copies fell back to the raw text if `escapeHtml` was missing, and a wrapper the first count missed did so while it was being removed.
- 2026-11-22 (#302): a `[url=]` address with a quote and no space in it could have left the `href`. It was escaped already, but no test had tried it.

## How it is checked

- `tests/block-fuzz-escaping.spec.js`: every Block type the editor can create, with markup in every text field, through the reader's renderer and the editor's Block list. The Blocks come from the editor's own templates, so a new type is covered without editing the test.
- `tests/shortcode-safety.spec.js`: hostile format tags through the real renderer.
- `tests/one-escape-helper.spec.js`: no copy, alias, wrapper or fallback of the escaper.
- `npm run lint` (`eslint-plugin-no-unsanitized`): an HTML write whose value the lint cannot see go through `window.escapeHtml` fails. The 221 writes found when it arrived (2026-11-22) are recorded in `eslint-suppressions.json`. Fixing one means taking it out of the file with `npx eslint js/ --prune-suppressions`; a new one is never added there, it is escaped where the lint can see it, or rewritten with `textContent`.

## Read more

- OWASP, Cross Site Scripting Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
