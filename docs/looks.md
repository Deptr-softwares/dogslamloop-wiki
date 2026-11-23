# Looks: the reader stylesheets

How the reader pages look: the shared stylesheets every reader page loads, the Classic look, and the stylesheets of the Forum and the Tier List page. Readers see all of it; the editor and staff pages load some of these sheets with their own.

## Files

- `style/Common.css`, `style/Layout.css`, `style/Cards.css`, `style/Buttons.css`, `style/Badges.css`, `style/Alerts.css`, `style/Modals.css`, `style/Forms.css`: the shared look, loaded by every reader page.
- `style/ColorCoding.css`: the character, frame-data, overlay and input-slot colours, as custom properties.
- `style/FrameData.css`: the Skill Card and the Frame Track (`docs/character-page.md`).
- `style/look-classic.css`: the Classic look, reader pages only.
- `style/discussions.css`, `style/forum.css`: threads and the Forum (`docs/discussions.md`).
- `style/certified-tier-lists.css`: the Tier List page (`docs/tier-lists.md`).

## Watch for

- `.claude/rules/practice-css.md` holds the CSS traps: restate `[hidden]` for every class that sets `display`, check every page a shared class is on, read only defined variables, close every comment once.
- Every stylesheet tag carries the shared `?v=` stamp (`tests/asset-stamping.spec.js`).
- The Classic look wins by its `html.look-classic` prefix and loads last; the editor and staff pages never load it.
- `.tier-portrait` is shared between the Tier List page and the tier editor; its size on the page is raised in `certified-tier-lists.css` only.

## Decisions

Newest first. One entry per decision.

- **2026-11-20, v1.2, #287.** An open dropdown is at least as wide as its button and as its longest option, capped by the screen: pinned to the button, a narrow "ALL" button cut its options short (the owner's screenshot).
- **2026-11-20, v1.2, #287.** An authored strategy block's heading is the card's heading, with a rule across the panel, so Overview & Strategy and the move write-ups read like the other tabs (owner, 2026-11-20: "This type of small heading and underline is seemingly only used in the Overview and Strategy, M1s, Skills, and Innate sections").
- **2026-11-20, v1.2, #287.** The Classic look: a plain dark wiki, picked under Look in Site Settings, kept small (the owner: "minimal code"). It re-points the shared variables and takes away the slants, hard shadows, halftone dots and the striped ground; the layout, the frame data's colours and the editors' own colours stay. Panels have no box, like an article, the account buttons are a list of links, and content Blocks get thin rules and no motion (owner, 2026-11-20: "custom build blocks such as callout and dropdown could get its own version").
- **2026-11-18, v1.2, #280.** The frame-data legend's columns follow the legend's own width, not the screen's, so it never cuts a name short beside a sidebar or in VIEW DIFF.
- **2026-11-17, v1.2, #275.** The Micro Variant tabs wrap, and a name longer than the card ends in an ellipsis: one row that never wrapped made a phone's page scroll sideways.
- **2026-11-17, v1.2, #275.** A panel lifts on hover only where there is a pointer to hover with: a phone keeps :hover on whatever was touched last, so a tap made the panel jump and stay jumped (the owner's mobile card).
- **2026-11-17, v1.2, #275.** On a phone, the body text is 14px and titles two steps down (the owner's pick, from their card: "Texts are too large"), a table keeps readable columns and scrolls sideways in its own box ("Avoid big table having extremely stretched vertical length"), and a bottom bar holds search, the account, Site Settings and Ko-fi.
- **2026-11-16, v1.2, #273.** One solid line under every title, as `.section-title` has; dashed lines are for the rows of a list (owner).
- **2026-10-23, v1.1, #250.** Badges are drawn as a skill slot from the game with the badge's picture in it (the owner's pick from mockups), in `Modals.css`, since the profile modals, the toast and the threads all draw them.
- **2026-10-20, v1.1, #240.** A character's name has faint halftone dots behind it, gone by the middle of the name (the owner's pick). Landing on a section wipes a slanted bar of the page colour across the heading's words once (the owner's pick, in place of a soft fade). Selected text, scrollbars and a bar on a panel heading's underline take the page colour, and a clicked tab punches out and settles.
- **2026-10-20, v1.1, #239.** The system buttons' look, the owner's pick from three mockups: a cut top-right corner, a hover fill sweeping in from the left, a hard shadow, a faint tint of the button's own colour. Blue is a fixed colour, never the page's accent, which a character page sets to the character's colour (owner, 2026-10-20).
- **2026-10-20, v1.1, #238.** An in-page link has a faint underline and no arrow, since it sits inside coloured text; a hover names the section (owner, 2026-10-19).
- **2026-10-20, v1.1, #237.** Media has square corners, like everything else on the site (owner, 2026-10-18).
- **2026-10-05, v1.0, #217.** The Forum has its own stylesheet; a post's conversation is styled by `discussions.css`, like a character's thread.
- **2026-09-20, v0.19, #198.** A container that nests Blocks (an accordion's body, a Section Box's panel) is never a flex container: media alignment is float, which a flex item ignores, so an image set to Right inside an accordion drew at the left (found by the owner).
- **2026-09-09, v0.18, #185.** `.btn-sys` is defined once, in `Buttons.css`: a copy in `editor.css` loaded after it and won on every editor page, so a fix here never reached them.
- **2026-09-09, v0.18, #179.** All ten input slots have one black outline, and the four dark fills were brightened with it (owner, 2026-09-08). A dark character's name gets a white outline, only on a dark character page.
- **2026-09-03, v0.17, #152.** The home page's narrow directory columns use a compact grid: two columns, unslanted buttons, the odd last one spanning both, and names that wrap rather than end in an ellipsis (owner, 2026-09-03).
- **2026-08-24, v0.16, #127.** A roster card with an icon is dark, with the site's diagonal hatching, and the character's colour moves to a thicker border (3.5px asked, which renders as 3px) and the hover shadow. The name is a slit across the middle of the card, the full width for every name, revealed on hover where there is hover (owner, 2026-08-24).
- **2026-08-17, v0.15, #108.** Combo notation is coloured by input slot, ten distinct hues in the owner's order (2026-08-16). Each slot's outline is always on and always hard, since a blurred halo reads as a glow (owner, 2026-08-17).
- **2026-08-16, v0.15, #105.** One combo, one box: the route, its damage and its note share one surface, hugging the route (owner, 2026-08-16, modelled on Dustloop's combo table).
- **2026-08-14, v0.14, #90.** The format tags become classes (`.sc-*`) instead of inline styles, so the only inline values are the two dynamic colours, both checked first.
- **2026-08-14, v0.14, #87.** The table of contents is a drawer on a phone, the left drawer's mirror from the other edge, so a phone reader can jump around a long page.
- **2026-08-13, v0.14, #81.** The Tier List page's certified lists have a stylesheet of their own, because the older `.tier-list-*` classes are still live for the editor and the Overseer's preview.
- **2026-08-11, v0.12, #44.** An estimated phase is a solid block, with no hatching, dashed border or badge (the owner's call): the missing ticks are the marker, and anything more would compete with the tick colours.
- **2026-08-03, v0.6, #27.** Below 1024px, tappable buttons grow toward the 44px guideline without changing their desktop size.
