---
paths:
  - "js/**/*.js"
  - "style/**/*.css"
  - "scripts/**/*.js"
  - "supabase/functions/**"
---

# Comments

What a comment holds (owner, 2026-11-22: "JSDoc block").

## Rule

- A file opens with a JSDoc block: what the file is for, then
  - `@since` the version it came in (`@since v0.15, changed v1.2` once its behaviour changed),
  - `@touches` the data, files and globals it reads, writes or calls,
  - `@watch` what to look out for when editing it,
  - `@see docs/<area>.md` when its area has a docs page.
- A function another file calls, or one with a trap, gets the same block, with only the tags that say something. A helper whose name says what it does gets none.
- `@since` comes from git, never a guess: the first commit that added the file (`git log --follow --diff-filter=A`) or the function (`git log -S`), and the first release on or after that day in `data/updates.json`. A function gets one only when it came later than its file.
- A new file's `@since` is the version its work is logged under, in that version's devlog: v1.3 for Stages A and B.
- `@since` and `@see` are JSDoc's own tags; `@touches` and `@watch` are this repo's.
- Inside a function, a comment says why, in a line or two. Never what the next line does.
- Never in a comment: a date, the owner's words, who asked, a prompt, a PR or batch number, what the code used to do, or a measurement. They go in the area's `docs/` page, under Decisions (`docs/area-template.md`), and in git.
- In CSS, the same items as labelled lines in one block: `/* What it styles. Since v1.1. Touches: ... Watch: ... */`.
- Left as they are: generated-region markers, the vendor file's licence header, and applied migrations (`supabase/migrations.lock.json` locks them).
- A deliberate silent failure says so in its comment (CLAUDE.md, "Fail visibly").

## Example

Before, `js/pages/core/page_render.js` (15 lines, shortened here):

```js
// --- PROFILE DESCRIPTION (v1.1) ---
//
// Owner's list: "Add Profile Description (have: Quote, Trivia, Next, and
// Previous) to a Character Page". It fills the profile card under the stats,
// the way a wiki infobox ends in its Character Navigation rows (owner,
// 2026-10-20, after a first version spanned the page under the overview and
// "looks really awkward"). ...
// Trivia is listed in the card, one fact a line (owner, 2026-10-23, replacing
// the one "2 facts" row whose facts opened on hover). ...
```

After:

```js
/**
 * Quote, Trivia and Character Navigation in the profile card under a character's
 * stats. The reader page and the editor's preview both draw it here, so the two
 * cannot drift.
 * @since v1.1
 * @touches desc_data.profile, fillProfilePager
 * @watch a Trivia line splits at its first "|": "Label | text"
 */
window.profileDescriptionHTML = function (profile) {
```

The two dated decisions moved to the Decisions list in `docs/character-page.md`, which the file's own block names with `@see`.

## What happened

- 2026-11-22: comments were 46% of the gzipped JavaScript readers download (708 KB, 383 KB without them) and 57% of the gzipped CSS (141 KB, 61 KB without). In `js/`, 216 comment lines held a date and 405 named the owner. The owner found comments that recorded the day of a change and what they had asked for, and set what a comment holds instead.

## How it is checked

- A commit that only changes comments is shown to change no code: the file's tokens (espree, ESLint's parser) are the same before and after.
- `tests/comment-rule.spec.js`, on every script and stylesheet in `js/` and `style/` (the vendor library left out): each opens with a block carrying `@since`, no comment holds a date, a PR, batch or item number or the owner's words, and every `docs/` page a comment names exists. A new file meets it from its first commit.

## Read more

- JSDoc, the `@since` tag: https://jsdoc.app/tags-since
