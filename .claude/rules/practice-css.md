---
paths:
  - "style/**/*.css"
---

# CSS traps

## Rule

- The `hidden` attribute loses to any `display` a stylesheet sets, because the browser's own `[hidden]` rule sits below every author rule. Restate it (`.thing[hidden] { display: none; }`) for every class that sets `display`, and test with `toBeHidden`, not the attribute. `grep -rn '\[hidden\]' style` lists the classes that carry it already.
- A shared class (`.btn-sys`, `.btn-manga`, `.filter-toggle` and the like) is used on pages that do not reference each other. Before changing one, grep for every element that uses it and look at each.
- Every `var(--x)` without a fallback reads a variable some stylesheet defines.
- A colour the palette names (the top of `Common.css`) is read as its variable, never written out again.
- A grey that is not a palette colour is written `var(--theme-<role>, <the grey>)`, so a Site Settings theme reaches it. Text in a status colour or the accent reads its text shade (`--red-text`, `--accent-text`), never the colour, so a light theme can darken it; a border or a fill reads the colour.
- A state the snapshot cannot draw signed out (a signed-in dock, a pressed button) is in its specimen, or it goes unchecked.
- A comment closes exactly once. After an early `*/` the rest of the note reads as one broken declaration, and the browser drops the next real declaration with it, without a warning.
- A stylesheet's tag carries the same `?v=` stamp as the scripts (`scripts/asset-version.js`).
- A colour test reads the computed colour and checks that the variable behind it reached the browser. Never the class that should cause it.
- "Nothing visible changed" is shown with a computed-style snapshot: every element's computed style on each page kind, in both looks, before and after. Sort the property names, and leave custom properties out: load order reorders them, and one new `:root` token changes every element. `npm run snapshot` does it.
- A difference the snapshot finds only in its specimen markup is a real change to the cascade. It is harmless only where no page draws that element, or no page that draws it loads the sheets this one does. Check each one before calling it that.
- A declaration is dead only where taking it out was tried on an element it applies to, in the state it names. A check that never holds that element in hover, or a page that never draws it, proves nothing about it.

## What happened

- 2026-08-02 (v0.6, #27): a 44px touch-target size on `.btn-sys` and `.btn-manga` was checked where it was asked for, and broke two other pages: the editor's mobile header and the Overseer's preview buttons. The owner found both on a phone.
- 2026-08-17 (v0.15, #108): nine green tests asserted the notation class while a later stylesheet won on `color` (the owner: "thickened but not orange").
- 2026-09-08 (v0.18 FT1): a comment in `ColorCoding.css` closed one paragraph early and swallowed `--input-color-m1`, so every M1 step in combo notation showed in the plain text colour for two and a half months. The test that every slot paints its own colour passed the whole time: with the variable missing, its expected colour was the inherited text colour, which is what the chip painted too. Fixed in #302 (2026-11-22).
- 2026-10-04 (v1.0, #217): `.forum-mod-form` set `display: flex`, so a moderator saw the reason box and CONFIRM before choosing an action.
- 2026-11-22 (#302): `--text-manga`, `--accent-red` and `--bg-primary` were read but never defined. Stylesheets had no `?v=` stamp, so for up to an hour after a release a reader could get new scripts with old styles. The snapshot for that fix found 0 of 5,183 elements changed on 6 pages, after its first two runs reported thousands of differences that were not real (unsorted names, then the new token).
- 2026-11-27 (#318): the snapshot for the flipped looks showed a submission card with 16px of padding in Classic on a phone, in its specimen only, and it was first read as harmless. It was a real change on every page that loads `Cards.css` before `Layout.css`; no reader saw it only because the one page that draws the card loads them the other way round. Fixed before merge.
- 2026-11-28 (#320): the script that took each of the flip's declarations out of the live page to see whether it did anything read `::before` and `::after` for its baseline and not for most of its tests, so nearly every declaration looked live, and #319 recorded that they all did something. Fixed, it found 365 that did nothing, and 311 are out. 31 stayed because they are in base rules older than the flip, whose value can matter where these pages do not show it. 23 stayed because they had not really been tried: neither it nor the snapshot holds every element in hover, and inside a look's `html:not(.look-classic)` wrapper it counted a rule as matched whenever the wrapper was, so the content table's Default headers looked dead on pages with no table.

- 2026-11-28 (found by the owner after #322): since #318 the coloured account buttons' words were the plain text colour in Default. The snapshot that called #318 unchanged runs signed out, where no coloured account button is drawn, and its specimen had only an uncoloured one. The same day, the site dropdown's rows in Site Settings were black: each row copied its option's resolved colour, which is the browser's own field text where no page rule colours options. Both fixed in #323, and the specimen holds a coloured account button.
- 2026-11-29 (#323): Claude's check that a theme reaches every colour (a scratch tool, not in the repo) read elements inside closed `<details>` (closed Update Log entries, FAQ answers), which the browser does not restyle, and reported them as unreached. It skips what `checkVisibility()` says is not drawn now.

## How it is checked

- `tests/css-variables.spec.js`: every `var()` without a fallback reads a defined variable, taken from the browser's own parse of every stylesheet, so a variable lost to a broken comment is missing there too.
- `tests/input-slots.spec.js`: each input slot's colour variable reaches the browser, and no chip falls back to the text around it.
- `tests/colour-palette.spec.js`: no sheet writes a palette colour as a literal, in any spelling, and no colour has two names; every other grey is a `var()` fallback, apart from the user badges' art.
- `tests/site-themes.spec.js`: each theme through the real Site Settings box, in both looks, on reader and staff pages, read as computed colours.
- `tests/asset-stamping.spec.js`: every script and stylesheet tag carries the shared stamp.
- `tests/axe.spec.js`: axe on one page of each kind, with everything they read frozen. The low contrast and small touch targets it found when it arrived are its baseline, kept for the UI/UX pass (C-5): a new finding fails, and so does a fixed one still listed.
- `visual.spec.js` (local only): screenshots before and after a CSS change.
- `npm run snapshot -- [--base=<commit>] [page ...]` (`scripts/style-snapshot.js`, local only): every element's computed style on one page of each kind, in both looks, at 1400px and 390px, and with the pointer held over what reacts to it, against a base commit (HEAD by default). It lists each difference with the rules that set it in each tree, and the specimen's differences apart from the page's own. A border colour on a side with no border style is left out, and every video is held with no file, still or ratio, since those come from the network and the page's script.

## Read more

- MDN, the `hidden` attribute: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/hidden
