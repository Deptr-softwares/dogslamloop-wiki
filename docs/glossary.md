# Glossary

What each thing is called on screen, in the code and in the data, where those differ. New code uses the name the screen shows.

| On screen | In the code | In the data | Files |
|---|---|---|---|
| Block | a Block type, from `blockTemplates` | an item with a `type` in `page_data.desc_data` | `editor-blocks.js`, `description.js` |
| Combo Card | `theorybox` | `type: "theorybox"` | `editor-blocks.js`, `editor-tabs.js` |
| Innate (an editor tab) | `specials` | `page_data.frame_data.specials` | `edit.html` |
| Ultimate (an editor tab) | `ultimateAtk` | `page_data.frame_data.ultimateAtk` | `edit.html` |
| Skill Card: a move's box on a character page | the Frame Data Engine | a move in `page_data.frame_data` | `framedata.js` |
| Frame Track: the timeline in the editor's frame data | the DAW: `initDawEditor`, `renderDaw`, `#daw-*` ids, `.daw-*` classes | a move's phases | `editor-framedata.js` |
| Micro Variant | `daw-variant-*` | a move's variants | `editor-framedata.js` |
| A phase's colour (Startup, Active, Recovery and the rest) | `bg-tick-start`, `bg-tick-active`, `bg-tick-recov` and six more | the class name itself, stored in each phase | `ColorCoding.css` |
| The page's text: Overview, Strategy, Matchups, Profile and the rest | the description, `desc_data` | `page_data.desc_data` | `description.js` |
| Format tags: `[b]`, `[color=]`, `[url=]`, `[icon=]` and the rest | shortcodes | inside any text field | `internalstyling.js`, `editor-writing-checks.js` |
| Sidebar, roster, tabs, table of contents, footer | the Page Builder | | `pagebuilder.js` |
| Character colours, aliases, accolades and the site's icons | `CHARACTER_COLORS`, `CHARACTER_ALIASES`, `ACCOLADES`, `UI_ICONS` | `site_pages.color` (the colours) | `site_meta.js` |
| The site's version and settings | `site_meta` | the `site_meta` table, copied to `data/site_meta.json` | `owner.html` |
| Overseer | `admin`: the page, its scripts and its stylesheet | | `admin.html`, `admin.css`, `admin-core.js` |
| Admin, a role | `admin` | `user_roles.role` | `site_utils.js` (`window.ROLE_RANK`) |
| A submission (the Overseer's Revision Queue) | a revision | a row of `pending_revisions`; its `scope` says which part of the page it changes (`system_tab`, `gallery_item`, `multi` and others) | `submissions.html` |
| Workspace: the editor's main panel | `workspace` | | `edit.html` |
| Default look, Classic look | no class, `html.look-classic` | a reader setting | `look-classic.css` |

## Renames

Picked by the owner (2026-11-22). They happen in B-4, when every page's script tags are rewritten anyway, and this table follows.

- `description.js` becomes `page_render.js`, beside `page_router.js` and `page_boot.js`.
- `framedata.js` becomes `skill_card.js`.
- `internalstyling.js` becomes `format_tags.js`. It also colours character names, frame terms and timings on its own.
- `site_meta.js` becomes `site_lookups.js`. `scripts/fetch-content.js` writes its `CHARACTER_COLORS` region, and the content gate's list in `tests/content-gate.spec.js` names it, so both change with it.
- `admin.html` becomes `overseer.html`. The old address forwards, and robots.txt and the sitemap's exclusions move with it. 92 files name `admin.html`, 60 of them tests.
- `pagebuilder.js` is named in B-4, once it is decided how it splits: it builds the sidebar, roster, tabs, table of contents and footer, and also the data grids and their filters.

## Kept

- DAW stays until the notebook editor replaces the Frame Data editor (D-3), and goes with it (owner, 2026-11-22). `.daw-tab-btn`, which styles every editor sub-tab strip, gets its own name in C-2.
- Names stored in the data (`theorybox`, `specials`, `ultimateAtk`, `desc_data`, `frame_data`, the scope names, `bg-tick-*`) stay. Changing one means a migration and an upgrade for every saved draft. This table is how to read them.
