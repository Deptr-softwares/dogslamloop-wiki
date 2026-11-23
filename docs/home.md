# The home page and the hubs

The three hand-written hub pages, the Main Dashboard (`index.html`), the Characters hub and the Systems hub: their CMS-written prose, headings and step lists, the Game Info panel, the computed widgets, the Update Log, the FAQ and the Credits. Readers see them first; the owner edits their words in the owner tools and the editor.

## Files

- `js/dashboards/hub_content.js`: the hubs' prose slots (from `page_data`), section headings, the Game Info panel and the step lists (from `site_meta`).
- `js/dashboards/dashboards.js`: the computed widgets: what needs work, recent character edits, the tier snapshot, wiki stats, the terminology peek and the matchup grid.
- `js/dashboards/home_widgets.js`: Recent Changes and the full Update Log, the FAQ, and the Credits list.
- `js/dashboards/hub_roster.js`: the character roster with its filters, icons and hover banners, the home page's category columns, and the Systems directory. Only the three hubs load it.
- `style/dashboards.css`: the three hubs' widgets, grids, columns and matchup grid, loaded by the pages that load `hub_roster.js`.
- `style/posts.css`: Update Log entries and their tables, the blog and hotfix notes, loaded by the pages that load `posts.js`.

## Data

- `page_data` for each hub (its slots), the `site_meta` table (headings, step lists, Game Info), falling back to `data/site_meta.json`.
- `data/updates.json` (the Update Log), `data/faq.json`, `systems/collaborators/collaborators_data.json` (the Credits), all generated.
- `page_completeness` (which sections a page has), `approved_revisions`, and every page's `desc_data.matchups` for the grid.

## Watch for

- The hubs are hand-written (`NEVER_TOUCH` in `scripts/generate-pages.js`) and are not tabbed pages: `hub_content.js` never calls `loadPageDescriptions`.
- The CMS is the only copy of the hubs' words: each container ships "Loading..." and is always replaced.
- Every widget that reads `page_data` or the revision feed filters archived pages itself (`isEntryPointHidden`).
- The terminology peek carries `wiki-text` and must stay inside `<main>`, or its format tags show as typed.

## Decisions

Newest first. One entry per decision.

- **2026-11-17, v1.2, #278.** The home page's scripts are deferred. It is the one page with a Content-Security-Policy meta tag, and Chrome stops fetching ahead when it meets one, so its blocking scripts were fetched one at a time and the page was ready for its data at about 1.6 s instead of 0.35 s. Deferred, they are all asked for at once and still run in order once the page is read.
- **2026-10-08, v1.0, #227.** The hubs' words have one copy, in the CMS: the hand-written fallback text had gone stale, and the owner asked to "clear the old hardcoded texts in place of the CMS generated texts".
- **2026-09-24, v0.20, #204.** The matchup grid marks a Clash where a pair's two pages do not mirror each other, any mismatch, one step included (the owner's pick of three). A Clash is marked, never resolved, and hidden characters are left out (owner, 2026-09-24).
- **2026-09-20, v0.19, #194.** The Systems hub has a matchup grid under Terminology, every character against every other, at full size rather than a sample, since its value is seeing the roster's shape at once (the owner's request).
- **2026-09-03, v0.17, #154.** Every release's changes are grouped under Features, Fine-tuning and Bug fixes (owner, 2026-09-03). A heading is an object beside the plain lines, so older entries draw as they were.
- **2026-08-09, v0.11, #36, #37.** The hubs' prose, headings, step lists and Game Info come from the CMS, and the `site_meta` table is read directly, with the committed JSON as the fallback: reading only the JSON made an owner's save change nothing on the site. The computed widgets are plain code over the data; "needs work" follows the `is_wip` flag, an editorial call, not a measure.
- **2026-08-08, v0.10, #31.** The home page's Credits and the Collaborators page read the same file, so editing one updates both.
