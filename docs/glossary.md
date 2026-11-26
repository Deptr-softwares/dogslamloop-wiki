# Glossary

What each thing is called on screen, in the code and in the data, where those differ. New code uses the name the screen shows.

| On screen | In the code | In the data | Files |
|---|---|---|---|
| Block | a Block type, from `blockTemplates` | an item with a `type` in `page_data.desc_data` | `editor-blocks.js`, `page_render.js` |
| Combo Card | `theorybox` | `type: "theorybox"` | `editor-blocks.js`, `editor-tabs.js` |
| Innate (an editor tab) | `specials` | `page_data.frame_data.specials` | `edit.html` |
| Ultimate (an editor tab) | `ultimateAtk` | `page_data.frame_data.ultimateAtk` | `edit.html` |
| Skill Card: a move's box on a character page | the Frame Data Engine | a move in `page_data.frame_data` | `skill_card.js` |
| Frame Track: the timeline in the editor's frame data | the DAW: `initDawEditor`, `renderDaw`, `#daw-*` ids, `.daw-*` classes | a move's phases | `editor-framedata.js` |
| Micro Variant | `daw-variant-*` | a move's variants | `editor-framedata.js` |
| A phase's colour (Startup, Active, Recovery and the rest) | `bg-tick-start`, `bg-tick-active`, `bg-tick-recov` and six more | the class name itself, stored in each phase | `ColorCoding.css` |
| The page's text: Overview, Strategy, Matchups, Profile and the rest | the description, `desc_data` | `page_data.desc_data` | `page_render.js` |
| Format tags: `[b]`, `[color=]`, `[url=]`, `[icon=]` and the rest | shortcodes | inside any text field | `format_tags.js`, `editor-writing-checks.js` |
| Sidebar, dock, tabs, table of contents, footer | the page shell | | `page_shell.js` |
| The roster, the hub columns, the Systems directory | the roster | | `hub_roster.js` |
| Character colours, aliases, accolades and the site's icons | `CHARACTER_COLORS`, `CHARACTER_ALIASES`, `ACCOLADES`, `UI_ICONS` | `site_pages.color` (the colours) | `site_lookups.js` |
| The site's version and settings | `site_meta` | the `site_meta` table, copied to `data/site_meta.json` | `owner.html` |
| Overseer | `admin`: its scripts and its stylesheet | | `overseer.html`, `admin.css`, `admin-core.js` |
| Admin, a role | `admin` | `user_roles.role` | `site_utils.js` (`window.ROLE_RANK`) |
| A submission (the Overseer's Revision Queue) | a revision | a row of `pending_revisions`; its `scope` says which part of the page it changes (`system_tab`, `gallery_item`, `multi` and others) | `submissions.html` |
| Workspace: the editor's main panel | `workspace` | | `edit.html` |
| Default look, Classic look | no class, `html.look-classic` | a reader setting | `look-classic.css` |

## Renamed

Picked by the owner (2026-11-22, and the page shell's two names 2026-11-23), renamed in v1.3. The devlogs and the applied migrations keep the old names, as they were written.

- `description.js` is `page_render.js`, beside `page_router.js` and `page_boot.js`.
- `framedata.js` is `skill_card.js`.
- `internalstyling.js` is `format_tags.js`. It also colours character names, frame terms and timings on its own.
- `site_meta.js` is `site_lookups.js`. The `site_meta` table and `data/site_meta.json` keep their names.
- `admin.html` is `overseer.html`. The old address forwards to it.
- `pagebuilder.js` is `page_shell.js`, and the hubs' roster and directories moved out of it into `js/dashboards/hub_roster.js`.

## Kept

- DAW stays until the notebook editor replaces the Frame Data editor (D-3), and goes with it (owner, 2026-11-22). The editor's sub-tab strips, `.daw-tab-btn` until v1.3, are the site's tab strip: `.sub-tabs` and `.sub-tab`.
- Names stored in the data (`theorybox`, `specials`, `ultimateAtk`, `desc_data`, `frame_data`, the scope names, `bg-tick-*`) stay. Changing one means a migration and an upgrade for every saved draft. This table is how to read them.
