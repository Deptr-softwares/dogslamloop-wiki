# Records

The pages that look back over the wiki rather than at one page: My Submissions, where a contributor follows their own submissions and answers the discussion on them; Recent Changes, every approved edit across the wiki; and the Search page, where the wiki says something about a word. A page's own History is in `docs/page-data.md`, and the search box in `docs/page-shell.md`.

## Files

- `submissions.html`, `js/pages/community/submissions.js` and `style/Submissions.css`: My Submissions.
- `recent-changes.html`, `js/pages/records/recent-changes.js` and `style/RecentChanges.css`: Recent Changes.
- `search.html`, `js/pages/records/search-page.js` and `style/search-page.css`: the Search page. The sidebar's search box is `js/utility/search.js`, whose matcher this page shares, styled in `style/Layout.css`.

## Data

- `pending_revisions`: a contributor's own submissions, read under RLS, with their `status` and `ticket_chat`. A reply goes through `post_ticket_message()`.
- `approved_revisions`: what Recent Changes lists.
- `data/search-index.json` (pages and sections) and `data/search-fulltext.json` (their prose), both generated from `page_data`. The full-text file is fetched only by the Search page.

## Watch for

- A contributor's reply goes through the RPC, never a table write: `pending_revisions` grants all to authenticated, and RLS cannot limit which columns an update touches.
- My Submissions' editor link copies the Overseer's routing (`editCurrentTicket` in admin-actions.js) and must carry `&type=`, or every page opens in the character editor. The page kind comes from the page list, never the submission's `page_type`.
- A link from Recent Changes is the page's real path from the page list, so a page under others/ or tools/ resolves.
- The Search page and the search box share one ranker (`window.__siteSearch`), so a query means the same in both. Every snippet is contributor prose, escaped.

## Decisions

Newest first. One entry per decision.

- **2026-11-21, silent release, #298.** My Submissions and Recent Changes take a page's kind from the page list, never the submission's `page_type`, which is only the submitter's word.
- **2026-09-16, v0.19, #193.** Full-text search has a page of its own, the split the owner asked for: the sidebar box takes a reader to a page or a section, and this page answers where the wiki says something about a word. It shows the box's matches first, since a page or section is the better answer whenever one matches, then the prose. The full-text index is a second file fetched only here, so no other page pays for it. Matches are ordered by position and whole words, an order a reader can predict.
- **2026-09-06, v0.18, #171.** A Recent Changes card links to the page's real path: a change to a tool, a gallery or a page under others/ linked to a 404.
- **2026-09-03, v0.17, #152.** A contributor can answer the discussion on their own submission. The owner: "There should be no reason why they get a notification of 'Staff are discussing your submission'" without being able to reply. The thread shows when there is a conversation to join, the reply box goes once the submission is closed, and the message shown is the one the server stored.
- **2026-08-25, v0.16, #133.** EDIT on a submission passes the page's kind to the editor (v0.16 bug 5): a system, tool or tier list page opened in the character editor. The deep link to a tab or move is made only for a character page.
- **2026-08-03, v0.6, #27.** My Submissions, the first page open to anyone signed in whatever their role: a contributor sees, edits and withdraws their own submissions, where submitting had been a one-way trip. A request for changes gets its own badge, so the contributor sees what a reviewer is waiting on without opening the ticket. Recent Changes, the whole wiki's approved edits on one public page, as a page's own history already was.
