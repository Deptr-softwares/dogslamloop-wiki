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
- **2026-11-19, v1.2, #287.** The Classic look: a plain dark wiki, picked under Look in Site Settings, kept small (the owner: "minimal code"). It re-points the shared variables and takes away the slants, hard shadows, halftone dots and the striped ground; the layout, the frame data's colours and the editors' own colours stay. Panels have no box, like an article, the account buttons are a list of links, and content Blocks get thin rules and no motion (owner, 2026-11-20: "custom build blocks such as callout and dropdown could get its own version").
- **2026-11-18, v1.2, #280.** The frame-data legend's columns follow the legend's own width, not the screen's, so it never cuts a name short beside a sidebar or in VIEW DIFF.
- **2026-11-17, v1.2, #275.** The Micro Variant tabs wrap, and a name longer than the card ends in an ellipsis: one row that never wrapped made a phone's page scroll sideways.
- **2026-10-23, v1.1, #250.** Badges are drawn as a skill slot from the game with the badge's picture in it (the owner's pick from mockups), in `Modals.css`, since the profile modals, the toast and the threads all draw them.
- **2026-10-04, v1.0, #217.** The Forum has its own stylesheet; a post's conversation is styled by `discussions.css`, like a character's thread.
- **2026-08-13, v0.14, #81.** The Tier List page's certified lists have a stylesheet of their own, because the older `.tier-list-*` classes are still live for the editor and the Overseer's preview.
- **2026-08-11, v0.12, #44.** An estimated phase is a solid block, with no hatching, dashed border or badge (the owner's call): the missing ticks are the marker, and anything more would compete with the tick colours.
