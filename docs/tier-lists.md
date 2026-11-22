# Tier lists

The Tier List page, where each assigned person keeps a tier list under their own name, and the older tier list engine the editor and the Overseer's preview still use. Readers pick a person to read their list; the list's author edits it in the tier editor.

## Files

- `js/pages/tier-lists/certified-tier-lists.js`: the Tier List page: the picker, one person's list, its changelog and the portrait tooltips.
- `js/pages/tier-lists/tierlist.js`: the original engine for a page's `desc_data.tabs` (an Overall tab and "vs" tabs), and its drag-and-drop builder.
- `js/pages/tier-lists/tier-editor.js`: the editor for a certified list (trimmed in B-3).
- `js/utility/site_data.js`: the roster loader and `tierListEntry`, shared by the page and the editor (`docs/page-data.md`).

## Data

- `tier_lists`: one row per person's list: its tiers, introduction, reasoning, art style and game version.
- `tier_list_changes`: every move, newest first, with its note. A NULL `from_tier` is newly placed, a NULL `to_tier` removed.
- `tier_page_settings`: the page's own introduction.
- `page_data.desc_data.tabs`: the older tier list shape, kept in place rather than migrated.

## Watch for

- Nothing loads until a name is picked: there is no combined or unattributed list, on purpose.
- The two renderers stay apart: two data models and two permission stories.
- Tier label fitting is written twice on purpose, here and in `tier-editor.js`, which share no dependency.
- Tier names, notes and author names are contributor text; a tier's colour lands in a style attribute and is allowlisted.

## Decisions

Newest first. One entry per decision.

- **2026-11-19, v1.2, #286.** A list may hold a character more than once, each copy told apart by a badge, and each copy is moved, noted and logged on its own (owner, 2026-11-19).
- **2026-10-22, v1.1, #246.** In icon mode, a character's name hides once its icon has loaded, and shows when there is no icon.
- **2026-10-10, v1.0, #228.** The changelog shows 20 moves a page, newest first, so every move is reachable (owner, 2026-10-10). It used to show the latest 100 and nothing older.
- **2026-09-20, v0.19, #198.** Hovering a portrait shows that character's last move and its note (owner, 2026-09-20).
- **2026-09-09, v0.18, #180.** Each list chooses portraits or roster icons (`art_style`), its author's call: an icon is far more legible twenty to a row.
- **2026-08-18, v0.15, #118.** A list shows the game version it was written against beside when it was updated, and nothing when its author has not said. A tier is renamed by typing, and long names are sized to fit on one line, one size for every tier.
- **2026-08-14, v0.14, #84.** Each person's list has its own introduction, written by them alone and never reviewed, since a signed tier list is opinion. The page's introduction hides while a list is open.
- **2026-08-13, v0.14, #81.** The Tier List page holds one list per assigned person, credited by name, in place of 22 unattributed tabs. A ranking is opinion, and a single unattributed one passes it off as the wiki's verdict ("the wiki says this character is S tier" is an argument nobody can win); a named list is a claim somebody answers for, and harder to brigade. A reader lands on nobody.
- **2026-08-01, v0.5, #26.** The builder's drag and drop runs on Pointer Events, so it works by touch: native drag and drop never fires from a touch gesture.
