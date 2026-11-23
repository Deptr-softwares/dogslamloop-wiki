# The Overseer

overseer.html, the staff page: the revision queue, the media queue, the report queue and Page History, each a tab, beside a preview pane where a submission is read, compared with the live page, discussed and approved. Review staff (reviewer and above) see every queue, a page expert sees their own pages' revisions, and a moderator sees the reports.

## Files

- `overseer.html`: the page.
- `admin.html`: its old address, which forwards here with its ?query and #section.
- `js/overseer/admin-core.js`: the gate (who gets in, which queues they see), the state the other files share, the message and note boxes, the queue tabs.
- `js/overseer/admin-queue.js`: the revision queue, its filters, the preview's table of contents and the action buttons.
- `js/overseer/admin-preview.js`: opening a revision, the QA report, and the four views (PENDING SUBMISSION, LIVE VERSION, DIFF VIEW side by side, CHANGE LIST).
- `js/overseer/admin-diff.js`: the field-by-field diff, which tabs a revision changed, and the tab strip.
- `js/overseer/admin-modes.js`: character states in the preview.
- `js/overseer/admin-actions.js`: INTERCEPT & EDIT, approve, reject, OPEN TICKET, REQUEST CHANGES.
- `js/overseer/admin-tickets.js`: a ticket's vote and chat.
- `js/overseer/admin-merge-compiler.js`: MERGE TICKETS.
- `js/overseer/admin-history.js`: Page History.
- `js/overseer/admin-media-queue.js`: the media queue and deleting a file.
- `js/overseer/admin-reports.js`: the report queue.
- `style/admin.css`: the Overseer's look, and the owner tools' (`owner.html`).
- Shared with the editor: `js/utility/side-by-side.js` and `js/utility/diff-markers.js` (`docs/editor.md`), and the delta engine `applyDeltaToData` in `js/utility/site_data.js` (`docs/page-data.md`).

## Data

- `pending_revisions`: a submission. A scope, a key and a payload (`target_scope`, `target_key`, `delta_payload`; `multi` holds several), or a whole page; its `status` (`pending`, `ticket_open`, `approved`, `rejected`, `withdrawn`), `supporters`, `opposers`, `ticket_chat` and the contributor's `qa_metadata`.
- `page_data`: the live page an approval writes. `archive_page_version()` copies the version it replaces into `page_history` on every update, which Page History lists and restores.
- `user_roles`: the role, and the per-account capabilities `can_moderate` and `can_delete_media`. `get_user_expert_pages()` names a page expert's pages.
- `media_moderation` over the `wiki-media` bucket (no row is unchecked), and `media_usage()`, which finds where a file is used.
- `list_content_reports()`, with `report_count` and `post_images`; `moderate_discussion_post()` and `resolve_content_report()` act on one; `page_discussion_edits` holds a post's earlier versions.
- `post_ticket_message()`: a ticket reply, appended and named in SQL.
- `user_notifications`: what the author is told (an approval, a rejection, an opened ticket, the first staff reply).

## Watch for

- The gate only decides what to show. RLS on every table is the boundary, and the gate's three ways in must agree with `is_staff()`, `can_moderate()` and `can_review_page()`; deleting a file with `can_delete_media()` (`tests/moderator-access.spec.js`, `tests/page-experts.spec.js`).
- Everything this page shows was written by someone else: escaped at every `innerHTML`, put in with `textContent`, or carried in a `data-` attribute to a delegated listener (`tests/queue-page-id-escaping.spec.js`, `tests/admin-difftextlcs-xss.spec.js`).
- A page's kind comes from the page list (`registeredPageType`), never the submission's `page_type`, which is the submitter's word.
- A new submission scope needs three places: a branch in `renderDeltaDiff` (admin-preview.js), its tab in `calculateTabDiffs` (admin-diff.js) and the merge compiler's scan. Missing one, it shows as the raw fallback, marks the wrong tab, or never conflicts and the second ticket overwrites the first (`tests/merged-ticket-diff.spec.js`, `tests/admin-merge-compiler.spec.js`).
- The trusted editor discount is written twice and the two must agree: `updateActionButtons` (admin-queue.js) decides whether MERGE shows, and `renderTicketWorkspace` (admin-tickets.js) prints what it needs.
- A merge ships scoped deltas, never a snapshot (`tests/admin-merge-delta.spec.js`).
- A queue a person is not here for is hidden, never removed: code writing into its panel must still find it.
- The site's custom dropdown copies a select's options once and dispatches only `change`: a select filled later is rebuilt, and listens for `change` (`tests/queue-filter.spec.js`).

## Decisions

Newest first. One entry per decision.

- **2026-11-23, silent release, #309.** The page is `overseer.html`, the name it has on screen, so it no longer shares a name with the admin role (the owner's pick). Its old address forwards, and robots.txt and the sitemap leave both out.
- **2026-11-21, silent release, #298.** A page's kind comes from the page list, never the submission's `page_type`: that one is the submitter's word, and it picks the renderer and is written onto the live row.
- **2026-11-18, v1.2, #280.** DIFF VIEW draws the open tab twice, the live page and the submission, side by side, from the owner's Overseer card ("fit in the review panel that page current state with all the red parts, and the current submission with all the green parts"). It draws only the tab it needs. The old list is CHANGE LIST, kept for what a page does not draw (an editor folder, a setting); a tier list keeps it, since its board redraws by id. The queue column pops in and out (the card: "turning the navigation bar to an overlay that can pop out and in"), and the page moves over rather than dimming, since a clip's buttons stay in the column. Accolades diff by name.
- **2026-11-17, v1.2, #276.** The queues are tabs, one on screen, each loaded the first time it opens, with a count once loaded. A Page History tab opens any page's history, for review staff only, the owner's pick of "a page picker in the Overseer": rolling a page back had needed a submission on it in the queue.
- **2026-11-17, v1.2, #276.** The QA report is the pane's own panel for every submission: "There is no way to view the full QA, unless you need to open a ticket" (owner's Overseer card). The evidence is a link only when it is one whole http(s) address, shown as its text; anything else is shown as written (it read "Evidence link is not a valid http(s) URL." with the text hidden).
- **2026-11-17, v1.2, #276.** The yellow "Modifications Detected" box is gone, on the owner's word: "the submission preview itself can already detects and points out where things changed". The tab and state markers say it.
- **2026-11-16, v1.2, #274.** A reviewer moderates by the owner's tick (`can_moderate`); admins always do.
- **2026-10-29, v1.2, #258.** The queue's page filter is rebuilt once the queue arrives: it only ever said "All pages" (owner's report, 2026-10-29). A page id is escaped, and the merge button is a listener, never an inline onclick.
- **2026-10-05, v1.0, #218.** A reported post's earlier versions show on its card, and an edit after the report is marked: the words the reporter saw may be gone.
- **2026-10-05, v1.0, #217.** Forum posts can be reported (shown as FORUM), and the Discord relay's copies of images are drawn.
- **2026-09-28, v0.20, #206.** A moderator sees a reported post's images.
- **2026-09-28, v0.20, #205.** A Combo Block's notation styles diff through the helper both review screens share.
- **2026-09-20, v0.19, #198.** A Combo Card in Multiple Sections mode and a Section Box diff each nested part.
- **2026-09-09, v0.18, #184.** A gallery item diffs as one whole object, declared in the registry (`wholeEntryDiff`).
- **2026-09-09, v0.18, #182.** The contributor's changelog, confidence and evidence are on the queue card, so a reviewer can choose what to open. The evidence is not a link there: one click from a staff page to a contributor's address is a phishing step. The confidence uses the size badges' three colours.
- **2026-09-08, v0.18, #178.** A system page's tab order diffs as its labels, and merges as one conflict for the page: two reorders are one competing decision.
- **2026-09-06, v0.18, #171.** A notification's link is the page's real path: it is clicked days later, when a wrong one is a 404 with no context.
- **2026-09-04, v0.18, #159.** A page expert gets in for their own pages' revisions (reported by the owner after making someone a Disaster Plants expert). The gate gives three answers (revisions, media, reports) rather than one label, since the ways in combine.
- **2026-09-03, v0.17, #152.** A contributor can answer in their own ticket, their replies told apart from staff. The RPC appends a message in SQL (two replies at once lost one) and sets its author's name (it was whatever the caller said).
- **2026-09-03, v0.17, #151.** The revision queue has filters (page, status). Its page list is built from the rows that came back, so an expert sees only theirs; "nothing is waiting" and "nothing matches" are two states; the merge count is the whole page's.
- **2026-08-27, v0.17, #145.** Deleting media is an admin power because the media queue is on this page (owner, 2026-08-27: which page a tool is on decides who owns it). `can_delete_media` gives it to one reviewer at a time. Admins hold the force actions, self-approval, tickets, change requests and intercepts (owner, 2026-08-26).
- **2026-08-27, v0.17, #141.** OPEN TICKET is one definition for every branch of the buttons: the owner's branch never got a copy, and could not open a ticket. The collaborative actions come before the two force actions.
- **2026-08-25, v0.16, #135.** The trusted editor discount is by rank, so reviewers and admins get it (v0.16 bug 6), and the ticket says "Staff Perk Applied".
- **2026-08-25, v0.16, #133.** INTERCEPT & EDIT passes the page's kind (v0.16 bug 5): a system, tool or tier list page opened in the character editor. Written in two files on purpose, here and `submissions.js`, since small duplication beats a cross-file dependency.
- **2026-08-25, v0.16, #131.** A long patch badge breaks anywhere (v0.16 bug 4: 402px wide in a 190px column).
- **2026-08-25, v0.16, #128.** Leaving DIFF VIEW returns to the tab the strip names (v0.16 bug 3: the strip said Skills and the pane Overview, and Techs could not be previewed), and every optional tab is bound at boot: a Techs button shown later did nothing.
- **2026-08-20, v0.15, #121.** An order change shows both sequences and which entries moved, named as the strip names its list, and marks that list's tab.
- **2026-08-18, v0.15, #118.** A queue card's column shrinks, so a long badge no longer pushes REVIEW out of the card (owner, 2026-08-18).
- **2026-08-18, v0.15, #115.** An editor folder shows in the diff ("Editor Folder"): joining one moves the Block.
- **2026-08-17, v0.15, #111.** A system or tier list page merges one section at a time; the merge compiler had found no conflicts on it, so MERGE TICKETS did nothing. A section's prose diffs as prose and its layout as fields.
- **2026-08-17, v0.15, #110.** Every edit type shows in Diff View. One breadcrumb for every page type ("Combos › Read First", not "[ COMBOINTRO ➔ FULL ]"); a field-by-field diff of objects with the names a reviewer reads, where two raw JSON blobs sat side by side; Combo List rows by position, named by route; and a raw fallback with a banner for any scope with no branch: seven scopes had rendered nothing.
- **2026-08-17, v0.15, #108.** A Combo Card diffs its own fields and write-up, and a fixed Block section ("Read First") marks its own tab, not Overview.
- **2026-08-16, v0.15, #106.** A ticket opens on its tab through the vocabulary ("counterplays" was not a tab, so counterplay tickets opened on Overview), and every keyed section is merged.
- **2026-08-16, v0.15, #102.** One entry that fails cannot hide the rest of a merged ticket, and a singular scope's key is 'full', never null: a ticket counted 5 edits and showed 2.
- **2026-08-14, v0.14, #88.** On a wide screen a clip opens in the preview pane, which shows one thing at a time; a closed clip is emptied so it stops playing.
- **2026-08-13, v0.14, #79.** A file can be deleted from the media queue, with its own confirmation showing its name and what was found using it. Storage first, then the record.
- **2026-08-13, v0.14, #78.** Moderators get in by a capability, not a role, since `user_roles` allows one row per account. They see the reports, not the revision or media queue (owner, 2026-08-13: "this is THE staff page, so somebody who moderates belongs on it").
- **2026-08-13, v0.14, #77.** The report queue, the same shape as the media queue. `report_count` is computed in SQL, since three reports on one post is a different situation from one. The post is moderated before its report is closed, so a failure leaves visible work.
- **2026-08-13, v0.14, #74.** The preview shows character states: a revision that edited a state rendered unchanged, so a reviewer approved blind. Its own toggle (the live page's chip), since `character_modes.js` is built for the live page. The preview opens on the state the revision edits, a deleted state can still be opened, and INTERCEPT & EDIT lands on the state being read.
- **2026-08-12, v0.13, #60.** The media queue. Media is not loaded until a reviewer asks (the owner's decision): the newest unchecked files are the heaviest clips. Where a file is used is a first-class filter (the owner's decision). "Unused" means nothing was found, never safe to delete. A flagged row's note is public, and the prompt says so.
- **2026-08-11, v0.12, #44.** Stand-ins for three shared helpers, for a deploy that pairs new files with an hour-old cached copy of the shared one: that took the editor down on 2026-08-10.
- **2026-08-10, v0.12, #43.** A character state's edit names its state on the queue card, and merges inside that state.
- **2026-08-10, v0.12, #40.** A merged ticket ships one scoped patch per accepted conflict, never a snapshot taken when it was compiled: everything approved in between was overwritten. Every contributor's changelog and evidence carry through, attributed, and the merge's confidence is its sources' lowest.
- **2026-08-10, v0.12, #40.** A revision is navigated by a tab strip on top, like the page it will become, with the changed tabs marked on it; a vertical list in the sidebar meant scrolling it while reading. INTERCEPT & EDIT opens on the tab being read. Each action passes its own placeholder to the note box: approving asked the reviewer to explain a decline, in red.
- **2026-08-08, v0.10, #31.** No notification to an anonymized author: there is nobody to tell.
- **2026-08-07, v0.8, #28.** The gate retries once before refusing: one dropped request locked staff out until they refreshed. The author is told when a ticket opens, and on the first staff reply only. The phone layout: the view toggle in two rows, the ticket's columns stacked, one header row with MENU, and action buttons that wrap (they were off screen on a real phone).
- **2026-08-03, v0.6, #27.** A page restored from the back-forward cache reloads: a reviewer going back to the Overseer was refused every time, and a refresh always fixed it. Rejecting is a status, not a delete, so the submission and its discussion stay. REQUEST CHANGES sends written feedback, lighter than approve, reject or intercept. On a phone the view toggle is fixed at the bottom of the screen.
- **2026-07-21, v0.4.** The merge compiler matches list entries by identity, never position: a deletion shifted the list and raised conflicts on entries nobody touched, and choosing one wrote nothing into a real entry.
