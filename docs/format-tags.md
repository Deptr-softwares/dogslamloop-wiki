# Format tags and automatic colours

The tags editors type in any text field (`[b]`, `[color=]`, `[url=]`, `[multicolor=]`, `[icon=]`, `[noauto]` and the rest), and the colours the site adds by itself: character names, frame-data terms, frame timings, a page's own words, and move names by input slot. Readers see the result on every page with text; editors see it in the preview.

## Files

- `js/pages/core/format_tags.js`: the tags and the automatic colours.
- `js/utility/input_slots.js`: which input slot each move name belongs to.
- `js/editor/tools/editor-writing-checks.js`: the editor's writing checks, which flag a tag that is not one.
- `style/Common.css`: the `.sc-*` classes the tags become.

## Data

- `desc_data.pageConfig.words`: a page's own words, each with one colour or a gradient (the editor's Config > Page).
- `desc_data.characterSettings`: aliases and slots that override what `input_slots.js` derives from frame data.
- `CHARACTER_COLORS`, `CHARACTER_ALIASES`, `FRAME_COLORS`, `WINDOW_COLORS` and `ACCOLADES`, from `js/utility/site_lookups.js`.

## Watch for

- The file reads a Block's `innerHTML`, rewrites it as a string and writes it back. Every value it puts in goes through `escapeHtml`, `safeUrl` or `safeColor`, and one that fails stays plain text. Test: `tests/shortcode-safety.spec.js`.
- A Block is styled once and marked `.is-styled`: the tags would eat their own output a second time.
- The passes run in an order: mini icons, the tags (inside out, until nothing changes), `[noauto]` lifted out, character names, frame terms, timings, `[noauto]` put back, page words, then input slots. A new pass needs its place in that order.
- Character names and page words match in their exact case: "Register", "Perfection" and "Active" are ordinary words.
- The tag grammar is written out in seven places (`.claude/rules/practice-new-code.md`); the writing checks' copy is one. One grammar module is planned (D-1).
- Two known gaps, kept for the format design (D-2): `[B]`, `[I]`, `[S]` and `[U]` in capitals become keybind badges in paragraphs and tables, because `page_render.js` runs its keybind pass first; and tags print as typed inside tooltips.

## Decisions

Newest first. One entry per decision.

- **2026-11-22, silent release, #302.** A `[url=]` address with `&` in it goes where it says: the address is read back out of `innerHTML`, so its entities are decoded before the one escape.
- **2026-11-20, v1.2, #288.** A hyphenated move name colours whole inside a longer step ("Flowing Red Scale - Air"), reported by an editor.
- **2026-11-19, v1.2, #284, #285.** Editors can put mini icons in text, typed or picked from the editor's icon button, like Dustloop (the owner's Kanban card): `[icon=accolade/...]`, `[icon=character/...]`, and the site's own icons as `[icon=ui/...]`. A name the site does not know stays as the typed tag, so the mistake shows in the preview.
- **2026-11-12, v1.2, #270.** Block Endlag is the stun of the player who blocked, and the attacker's endlag on block (Extended Recovery) is Recovery (Terminologies, Round 2). The aliases follow.
- **2026-10-20, v1.1, #237.** A page can list words of its own to colour, up to fifty, each with a colour or a gradient, on that page only. The owner (2026-10-18): "auto-coloring custom words in a page ... JUST FOR THAT PAGE". Whole words in their exact case, so "Domain" colours and "domain" stays plain. Built-in colours win where the two meet, and in Combos and Techs a page word that is a move name takes the move's colour.
- **2026-10-20, v1.1, #237.** Plain `[noauto]` stops the built-in colours only, and `[noauto=all]` stops a page's own words too: a page word is one the page's editor chose on purpose (owner, 2026-10-19).
- **2026-10-18, v1.1, #234.** `[outline]` gives text a white outline, drawn the way the site outlines a dark character name.
- **2026-09-20, v0.19, #194.** `[multicolor=a,b,...]` sweeps the text through its colours, any number of stops; the owner chose the gradient reading. The stops take every colour `[color=]` takes, resolved by the browser. A bad stop refuses the whole gradient and keeps the words: ignoring one of three would draw a gradient nobody asked for.
- **2026-09-09, v0.18, #179.** A character name whose own colour is dark gets a white outline, only on a dark character page, where the site already outlines its dark text.
- **2026-09-09, v0.18, #179.** All ten input slots share one black outline.
- **2026-08-20, v0.15, #121.** Block, Blocking and Guard are not coloured by themselves (owner): combo prose uses "block" as an ordinary verb. A kit with a move named Block still colours it.
- **2026-08-20, v0.15, #120.** Techs prose gets move-name colours like Combos: it is the same kind of prose, routes and cancels written as notation.
- **2026-08-17, v0.15, #109.** A fragment link (`[url=#...]`) is an in-page jump with no new tab, and `page_shell.js` resolves it, across tabs too.
- **2026-08-17, v0.15, #108.** Combo notation is coloured by input slot, from a map derived from each move's `input` in frame data, with `desc_data.characterSettings` as a thin override. Nothing is listed by hand, so fixing a move's input fixes its colour too. Measured on the live roster that day: 519 moves, 396 (76%) resolved from `input` alone. Mechanics every character shares (Dash, Jump and their variants) colour on every page, since no character's frame data holds them (owner, 2026-08-17). Move names in prose are coloured only in the Combos tab (owner, 2026-08-17): site-wide they would turn the frame-data pages into a rainbow. A Combo Block's route is coloured anywhere, since a route is notation.
- **2026-08-14, v0.14, #90.** Every value a tag puts in the page goes through one of three gates (`escapeHtml`, `safeUrl`, `safeColor`), and anything that fails renders as plain text: losing a colour is a rendering nit, running someone's script is not. Addresses and colours are allowlisted, not escaped.
- **2026-08-14, v0.14, #90.** The tags become classes (`.sc-b` and the rest, in `style/Common.css`), and `[kbd]` becomes a `<kbd>`, so screen readers and search engines get the meaning.
- **2026-08-14, v0.14, #90.** The automatic colours: frame-data and overlay terms are derived from `site_lookups.js`'s colour lists, so a new colour is highlighted the day it lands; each kind of term is one combined pattern in one pass, longest first, so a short term cannot claim part of a long one; character names match case-sensitively; `[noauto]` stops them for its text. A character mention links to its page, except inside a link and on the character's own page.
