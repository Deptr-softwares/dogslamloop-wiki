# Page data and the delta engine

How a page's content is read, and how an approved edit is applied to it. Readers get the data on every page; the editor, the review screens and History apply deltas to it.

## Files

- `js/utility/site_data.js`: the roster, tier list entries, archived pages, character modes, matchup tiers, system page section keys, the page data fetcher, and `applyDeltaToData`. The delta engine is planned to leave reader pages in B-5.
- `js/pages/records/history.js`: History, which replays approved revisions through the live page's own renderers.

## Data

- `page_data`: `desc_data` (the page's text, as Blocks), `frame_data` (moves and their Frame Tracks), `tab_settings` (optional tabs).
- `pending_revisions`: a submission is one or more deltas, each a `scope`, a `key` and a `payload`.
- A character with states: `frame_data.modes` (the toggle), `frame_data.modeData` and `desc_data.modeData` (each state's own content).
- `data/portraits.json` (the repo's copies of the portraits) and `data/archived-pages.json`.

## Watch for

- `applyDeltaToData` is the last step of approving a ticket. A scope it does not know throws; it never returns the data unchanged.
- A delta is applied to a snapshot: an entry it does not name stays where it is, and a reorder never deletes. When a reorder is ambiguous, nothing changes.
- A delta for one state wraps the plain scope (`mode`, key `<modeId>::<scope>[::<key>]`), so a new scope needs nothing extra for states.
- System page tabs and sections have no stored id: their keys are derived from titles on both sides, so a rename reads as a delete plus an add.

## Decisions

Newest first. One entry per decision.

- **2026-11-19, v1.2, #286.** A certified tier list may hold a character more than once, each copy told apart by a badge (owner, 2026-11-19). Each copy has its own key, so it is moved, noted and logged on its own.
- **2026-10-29, v1.2, #262.** History shows the whole page as it was right after a revision, from the snapshots the database keeps of every live change, drawn by the live page's own code (owner, 2026-10-29). A revision from before approvals were timestamped shows what it changed, says so, and leaves out the sections it did not touch.
- **2026-10-21, v1.1, #242.** Every tier list loads its roster through one function. There were three copies, and two read a field `navigation.json` never carries, so they drew guessed addresses, old art or a 404. Portraits come from the repo's own copies (`data/portraits.json`): a cross-origin image taints the canvas the image export draws on.
- **2026-10-20, v1.1, #237.** A page's own settings (its words and house style) are one page-level delta, `pageConfig`, beside a character's states and never inside one.
- **2026-09-08, v0.18, #178.** Reordering a system page's tabs submits: a page-level delta listing tab keys, never content, so moving a tab cannot overwrite an edit made to it meanwhile. Before, the editor said "no changes detected".
- **2026-08-20, v0.15, #121.** A reorder is a delta of its own (`order`), listing each entry's identity in the new order. The owner's report: a reorder alone would not submit, and a reorder with a wording change applied the wording and left the order. When in doubt it changes nothing (an entry with no identity, or two sharing one), and an entry the delta does not name keeps its place.
- **2026-08-17, v0.15, #111.** System pages submit one section at a time, and tier lists one tab's tiers at a time, not the whole document: approving two whole-document tickets for one page reverted the first, with no warning to anyone. Sections and tabs are keyed by their titles, derived on both sides, since nothing in a system page has a stored id. Tiers go per tab, not per tier: moving a character from A to S changes two tiers at once.
- **2026-08-16, v0.15, #107.** Applying a delta with a scope the engine does not know throws. Before, it returned the data unchanged, so a Starter Guide ticket showed the reviewer a success message and wrote nothing.
- **2026-08-12, v0.13, #55.** The matchup tiers are one list, read by the page, the preview and the editor's dropdown. Two tiers were renamed, and their old words stay as aliases for good: history and queued tickets keep what was submitted and approved. An unknown tier keeps its wording and renders white, never guessed.
- **2026-08-10, v0.12, #43.** A character's modes are declared (`modes`) apart from their content (`modeData`), and a character with none is one implicit base mode, so every page already stored renders unchanged. A delta for one state wraps the plain scope. A mode's `profile` falls back to the base, since it is the character's identity card; everything else is the state's own. A character page's simultaneous requests for its one page_data row share one request.
- **2026-08-10, v0.12, #41.** A gallery is edited one item at a time, one delta per item keyed by name, so many contributors adding items never collide.
- **2026-08-09, v0.11, #36.** Archiving a page does not hide its references elsewhere; hiding them is a separate choice per page. Archived pages keep a tombstone at their address.
