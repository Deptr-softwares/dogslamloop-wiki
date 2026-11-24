# Tier lists

The Tier List page, where each assigned person keeps a tier list under their own name, and the older tier list engine the editor and the Overseer's preview still use. Readers pick a person to read their list; the list's author edits it in the tier editor. Two tool pages sit beside them: the Free Submit Tier List, the community's own ranking, and Create Tier List, where any visitor ranks the roster and copies it as an image.

## Files

- `js/pages/tier-lists/certified-tier-lists.js`: the Tier List page: the picker, one person's list, its changelog and the portrait tooltips.
- `js/pages/tier-lists/tierlist.js`: the original engine for a page's `desc_data.tabs` (an Overall tab and "vs" tabs), and its drag-and-drop builder.
- `style/tierlist.css`: that engine's rows and builder, and the tier portraits every list shares, loaded by the pages that load `tierlist.js` or `tier-editor.js`, and by every tool page.
- `tier-editor.html`, `js/pages/tier-lists/tier-editor.js` and `style/tier-editor.css`: the editor for a certified list.
- `js/pages/tools/free_submit_tier_list.js` and `style/tools/free_submit_tier_list.css`: the Free Submit Tier List.
- `js/pages/tools/create_tier_list.js` and `style/tools/create_tier_list.css`: Create Tier List.
- `js/utility/site_data.js`: the roster loader and `tierListEntry`, shared by every list and the editor (`docs/page-data.md`).
- `js/owner/owner-tier-lists.js`: who has a list, the page's introduction and the Free Submit settings (`docs/owner-tools.md`).

## Data

- `tier_lists`: one row per person's list: its tiers, introduction, reasoning, art style and game version, written through `save_tier_list()`.
- `tier_list_changes`: every move, newest first, with its note. A NULL `from_tier` is newly placed, a NULL `to_tier` removed.
- `tier_page_settings`: the page's own introduction, and the Free Submit settings.
- `page_data.desc_data.tabs`: the older tier list shape, kept in place rather than migrated.
- `free_submit_tiers` (the scale), `free_submit_votes`, `get_free_submit_rankings()`, `free_submit_eligibility()` and `submit_tier_votes()`.
- Create Tier List keeps its list in this browser only (`localStorage` `dsl_create_tier_list`).

## Watch for

- Nothing loads until a name is picked: there is no combined or unattributed list, on purpose.
- The two renderers stay apart: two data models and two permission stories.
- Tier label fitting is written twice on purpose, in `certified-tier-lists.js` and in `tier-editor.js`, which share no dependency.
- Tier names, notes and author names are contributor text; a tier's colour lands in a style attribute and is allowlisted.
- Every character moved in the tier editor needs a note before SAVE, and `tier_list_changes.note` is NOT NULL with a length floor: the editor's gate mirrors the schema.
- The tier editor's board and preview use the reader page's own classes, so the two must stay alike.
- The Free Submit limits and their reasons live in its migration (`20260814000001_free_submit_tier_list.sql`). The ballot asks `free_submit_eligibility()` before it is drawn, and the RPC checks everything again.
- Create Tier List draws its image on a canvas, so every portrait must come from this site (`medias/portraits/`): a cross-origin one taints the canvas.
- The three features keep their own class prefixes, `ctl-`, `fs-` and `mk-`, so a fix to one cannot reach the others. `.tier-portrait` is shared on purpose, its size scoped by each.

## Decisions

Newest first. One entry per decision.

- **2026-11-20, v1.2, #288.** The tier editor saves a document's whole Block list, not only the Section Box or Dropdown open in it.
- **2026-11-19, v1.2, #286.** A list may hold a character more than once, each copy told apart by a badge, and each copy is moved, noted and logged on its own (owner, 2026-11-19).
- **2026-11-19, v1.2, #286.** In the tier editor, copies are made any number at a time, each with a badge (a label and a colour), and the original may wear one too (the owner's picks, 2026-11-19). A new copy waits in Unranked, and SAVE waits until every copy is placed, since only the tiers are saved.
- **2026-11-18, v1.2, #280.** The Free Submit Tier List asks for its scale, rankings and the reader's votes at once, so the page waits on the database once.
- **2026-10-22, v1.1, #246.** In icon mode, a character's name hides once its icon has loaded, and shows when there is no icon.
- **2026-10-22, v1.1, #246.** Create Tier List offers portraits or icons, and big or small branding (owner, 2026-10-22: "make it an option to use either the Icons or the Portraits", and "either the big branding at the top right corner, or the small subtle 1-box size branding at the bottom right corner"), kept on the device and through RESET.
- **2026-10-21, v1.1, #243.** Create Tier List's branding holds the top right of the first tier, on the board and in the image, and the characters flow around it (owner, 2026-10-21, after TierMaker).
- **2026-10-21, v1.1, #242.** Create Tier List: any visitor ranks the roster and copies it as an image, on the site rather than an external tool (owner, 2026-10-18). The image goes to the clipboard (owner, 2026-08-16: "delivers to the clipboard, not a download"), as a PNG download only where the browser cannot copy one, with an optional title (owner, 2026-10-20). No Edit and no History, since the page is the tool (owner, 2026-10-21). A marker shows where a character will drop ("a clear indicator inbetween the characters"), characters sit 3px apart ("somewhere 2px-3px"), and High and Max draw the image two and three times as sharp ("the export quality is kinda low"), all the owner's, 2026-10-21. Hidden characters are left out.
- **2026-10-21, v1.1, #242.** Every tier list reads one roster loader, `loadCharacterRoster`. Two of its three copies read a field `navigation.json` never carries, so the tier editor and Free Submit drew stale, guessed art (`.claude/rules/tier-rosters.md`).
- **2026-10-11, v1.0, #228.** The changelog shows 20 moves a page, newest first, so every move is reachable (owner, 2026-10-10). It used to show the latest 100 and nothing older.
- **2026-10-01, v0.20, #209.** The tier editor sets the art style before it draws the first board: every list opened as portraits, whatever it stored ("the tier list always default back to the Portraits mode").
- **2026-09-20, v0.19, #198.** Hovering a portrait shows that character's last move and its note (owner, 2026-09-20).
- **2026-09-09, v0.18, #181.** The Free Submit Tier List's characters grow into their row, up to a cap (owner, 2026-09-09: "make the free submit character boxes bigger and almost fill up the width"), and the tier editor colours an icon's border as the reader page does.
- **2026-09-09, v0.18, #180.** Each list chooses portraits or roster icons (`art_style`), its author's call: an icon is far more legible twenty to a row. The editor's board redraws at once when it changes.
- **2026-08-18, v0.15, #118.** A list shows the game version it was written against beside when it was updated, and nothing when its author has not said. A tier is renamed by typing, and long names are sized to fit on one line, one size for every tier.
- **2026-08-18, v0.15, #118.** The tier editor previews the introduction, the reasoning and the changelog in the live page's own markup, with the introduction above the board, where the reader meets it (owner, 2026-08-18). A tier's colour uses the site's own picker, opening sideways, not the operating system's.
- **2026-08-14, v0.14, #85.** The Free Submit Tier List, the community's own ranking. Each character shows its sample size, since "S tier" from nine people and from four hundred are different claims, and a character under the floor is shown as unranked, not left out. A selected character shows how its votes spread, since a split community and a unanimous one share a median. The ballot says first whether the reader may vote and why, and taking a vote back is allowed even when voting is closed.
- **2026-08-14, v0.14, #84.** Each person's list has its own introduction, written by them alone and never reviewed, since a signed tier list is opinion. The page's introduction hides while a list is open.
- **2026-08-13, v0.14, #82.** The tier editor: the list is dragged on the board, and every character moved needs a short note before SAVE. The editor compares the board with the placement it loaded, so every difference is a move to explain, written while the author still knows why. Its own drag and drop, not `tierlist.js`'s, which works on the older data model. Leaving with unsaved notes asks first.
- **2026-08-13, v0.14, #81.** The Tier List page holds one list per assigned person, credited by name, in place of 22 unattributed tabs. A ranking is opinion, and a single unattributed one passes it off as the wiki's verdict ("the wiki says this character is S tier" is an argument nobody can win); a named list is a claim somebody answers for, and harder to brigade. A reader lands on nobody.
- **2026-08-01, v0.5, #26.** The builder's drag and drop runs on Pointer Events, so it works by touch: native drag and drop never fires from a touch gesture.
