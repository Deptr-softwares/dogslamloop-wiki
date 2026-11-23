---
paths:
  - "js/**/*.js"
  - "style/**/*.css"
  - "scripts/**/*.js"
---

# Where new code goes

## Rule

- Before writing, search for code that already does the job, by what it does as well as by its name, and reuse it. Change it when it almost fits.
- A new feature extends what exists: a Block through the editor's `blockTemplates`, a box through `window.runDialog`, a shared helper in the `site_utils` part for its job. Something new beside an existing mechanism is fine when its reason is written in the area's `docs/` page (owner, 2026-11-22).
- One rule, one place. Two copies of a rule that must agree drift; the rules in `.claude/rules/` name the known pairs. Small per-file duplication is still preferred over one feature file depending on another (`owner.js` runs its own RBAC gate rather than importing `admin-core.js`'s).
- Split a file by job when a page kind can skip part of it, or when it passes about 1,500 lines.
- The smallest change that solves the stated problem. No option or layer for a case that does not exist yet, and no refactor in passing.

## Where shared code lives

- Every page loads `js/utility/site_utils.js` and the parts split from it by job first, in this order: `site_utils.js` (settings, paths, the Supabase client, escaping, roles, dialogs: `window.escapeHtml`, `window.escapeRegExp`, `window.showAccessDenied`), `site_data.js` (page data and the delta engine), `site_media.js` (media, the tooltip, math), `site_account.js` (sign-in, profiles, badges, notifications). A shared helper goes in the part for its job.
- A part past about 1,500 lines is split by job the same way (owner, 2026-11-22). The new part is named `site_<job>.js`, loads right after the part it came from on every page (`PARTS` in `scripts/page-scripts.js`), and joins `PARTS` in `tests/site-utils-parts.spec.js`. Past six parts, the family moves into its own folder, `js/utility/site/`.
- A new file goes in the `js/` folder for its purpose (CLAUDE.md, "Stack").

## What happened

- 2026-08-03 (v0.6, #27): `editor.js` had reached 4,281 lines. It was split into nine files by job.
- v0.18 and v0.19: the Combo Card's two editors drifted apart twice (`combo-card.md`).
- 2026-09-09 (#181) to 2026-10-20 (#242): three copies of the roster loader, two of them reading a field `navigation.json` never carries, until v1.1 made them one (`tier-rosters.md`).
- 2026-11-20 (#293): 55 definitions of the HTML escaper, and 13 functions that each ran their own confirm, message or prompt box. The boxes disagreed about a second question while one was open, so a double click could run an action twice. One of each now.
- 2026-11-21 (#301): `site_utils.js` had reached 3,193 lines. It is four parts by job now.
- 2026-11-22 (#302): the format-tag grammar is written out in seven places. The writing checks' copy did not know `[icon=]`, so every mini icon drew a warning. One grammar module is planned (D-1).

## How it is checked

- `tests/js-folders.spec.js`: each file sits in a folder for its purpose, and every page tag names a file that is there.
- `tests/site-utils-parts.spec.js`: every page loads the parts, in order.
- `tests/global-scope-collisions.spec.js`: no two files a page loads declare the same top-level name.
- `tests/one-escape-helper.spec.js`: one escaper.
- `tests/page-weight.spec.js`: each kind of page has a budget for the scripts and stylesheets its tags load (gzipped, today plus 5%). A page that outgrows it fails; one that gets more than 5% lighter fails until its number is lowered in the same PR.

## Read more

- Kent Beck's rules of simple design (passes the tests, reveals intention, no duplication, fewest elements), as Martin Fowler sets them out: https://martinfowler.com/bliki/BeckDesignRules.html
