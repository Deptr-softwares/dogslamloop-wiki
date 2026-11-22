# The editor

edit.html: where editors write a page and send it for review. The header and its splitter, loading a page (or a ticket, or a draft), Config, drafts, character states, Sync and the live preview, VIEW DIFF, Submit, the first-visit notices, the tour and the Manual of Style, the writing checks, and the Editor Playground. The Block list itself is `docs/block-editor.md`, and the Frame Data tab is `docs/frame-data-editor.md`.

## Files

- `js/editor/core/editor-core.js`: start-up, the header and splitter, Cancel, the QA modal and the Submit pipeline.
- `js/editor/core/editor-config.js`: the Config panel (Editor, Actions, Page).
- `js/editor/core/editor-modes.js`: character states in the editor.
- `js/editor/core/editor-dialogs.js`: the editor's message and confirm boxes.
- `js/editor/core/editor-drafts.js`: the auto-save, Save, and the Draft Manager.
- `js/editor/core/editor-sync.js`: Sync, the live preview, VIEW DIFF and the change list.
- `js/editor/tools/editor-previews.js`: the preview of the Overview, Matchups and keyed sections.
- `js/editor/tools/editor-playground.js`: the Editor Playground.
- `js/editor/tools/editor-notices.js`: the first-visit notices.
- `js/editor/tools/editor-tutorial.js`: the tour and the Manual of Style.
- `js/editor/tools/editor-writing-checks.js`: the writing checks.
- `js/utility/diff-markers.js`: the inline text diff, shared with the review queue.
- `js/utility/side-by-side.js`: the side-by-side diff, shared with the Overseer.

## Data

- `pending_revisions`: what Submit sends, one delta per section (several become a `multi` ticket). `page_permissions` and `site_settings` decide who may send and who skips the cooldown.
- `desc_data.pageConfig`: a page's own words to colour and its house style document, sent as their own scope.
- `get_open_submission_scopes()`: where, who and when for the open submissions on a page, never what (the Edit Conflict Check).
- `approved_revisions`: the past versions VIEW DIFF can compare with.
- `localStorage`: `wiki_draft_*` (auto-saves), `wiki_save_*` (Save), `wiki_submitted_*`, `dsl_editor_config`, `dsl_editor_*` (the header and splitter), `dsl_notice_seen_*`, `dsl_editor_tutorial_seen`.
- The Writing Guide's `page_data` row: the tour's steps and the Manual of Style's Basics.

## Watch for

- The role and cooldown checks in the editor only choose the message: RLS and `check_revision_rate_limit()` are the boundary, and the two must agree. Roles are compared by rank.
- An intercept whose ticket did not load is refused at Submit, never sent as a new submission.
- On a character with states, `currentEditorDescData` and `currentEditorFrameData` are views onto the active state's slice of the masters. Drafts and Submit use the masters; anything new that writes page data goes through the views.
- `triggerManualSync` and `updateLivePreview` branch on the page type and tab almost alike: a new tab or page type needs both.
- The Block buffer reaches the page's data only on sync, so anything that switches what is on screen (a tab, a state, Find and Replace, VIEW DIFF) flushes first.
- The tour's and the MoS's words come from the Writing Guide, never from code: a heading added there is a step in the tour.
- What the Playground cannot do is switched off where it happens (Submit, uploads, the Conflict Check, page drafts), not hidden from one place.

## Decisions

Newest first. One entry per decision.

- **2026-11-19, v1.2, #283.** A base-only character can have states too (other forms, like an install), and + STATE asks whether to start empty or as a copy of the base kit: an ultimate replaces the whole kit, so it starts empty, and an install is mostly the kit buffed.
- **2026-11-18, v1.2, #280.** VIEW DIFF compares side by side, from the owner's Overseer card ("There is no way to compare historical page versions from the current version in the editor") and their pick from the mockups (2026-11-18): a "Compare with" picker, the live page or a past approved version on the left, the page in the editor on the right. The old list is CHANGE LIST. The Workspace folds away meanwhile, since the halves were "way too compressed" (owner, 2026-11-18), and a WORKSPACE button brings it back.
- **2026-11-02, v1.2, #268.** The Workspace footer is moved only when it needs to move, and one sent back and forth three times in two seconds stays unpinned for that section: it jittered many times a second (reported from macOS).
- **2026-10-30, v1.2, #263.** Someone below a page's required role is told on opening the editor, not only at Submit (owner, 2026-10-29).
- **2026-10-24, v1.2, #253.** The tour and the Manual of Style find their Writing Guide section in any tab: the owner reorganises the guide through the site.
- **2026-10-21, v1.1, #242.** The Editor Playground: "a place where Editor can mess around with the Editor as much as they like without any consequences or worry" (owner, 2026-10-18). It starts as a blank character page, open to anyone, and Submit becomes Pull: "the editor can pull page_data from any page and edit them in the editor playground". It keeps one draft of its own.
- **2026-10-20, v1.1, #241.** Writing checks: character names written the anime's way and broken format tags (owner, 2026-10-18), scoped to "only JJK equivalent name count, meme name and shortened name don't count", then "you should also warn on Higgy and Kuro" (owner, 2026-10-20). A yellow line with FIX while typing, and a list at Submit that can still be sent. Grammar waits for later.
- **2026-10-20, v1.1, #239.** Clicking a Block in the preview opens it in the Workspace, the first step towards editing in the preview (an editor's feedback, 2026-10-19).
- **2026-10-20, v1.1, #237.** Submit keeps every draft and warns instead (owner, 2026-10-19), and there are five auto-save slots across pages: "a max limit of 5 auto-save slots for every editor". One already submitted goes first; a SAVED version is never dropped.
- **2026-10-20, v1.1, #237.** Sync and Save are two buttons, and Save writes "its own independent slot in Drafts" (owner, 2026-10-19). Config can hold the preview until Sync.
- **2026-10-20, v1.1, #237.** Config's Edit Conflict Check: "run a quick check against the current submission queue and see if any edits on the same page will clash with the current edits detected right now" (owner, 2026-10-19). It reads Submit's own list of edits, and the queue's side through an RPC that says where, who and when, never what.
- **2026-10-20, v1.1, #237.** Config > Page: words coloured "JUST FOR THAT PAGE", and a house style document that "would also appear as a red-colored button next to MoS" (owner, 2026-10-18), "always visible even if nothing is written yet" (owner, 2026-10-19). They travel in a submission as their own scope, so a reviewer sees the change first.
- **2026-10-20, v1.1, #237.** Config's Editor tab has three sections, "Workspace, Block, and Preview Panel" (owner, 2026-10-19), and the preview can follow the Block being edited.
- **2026-10-20, v1.1, #237.** The Workspace footer rests at the bottom of the Workspace on a short section: "The Workspace Footer is always stuck at the bottom of the Workspace regardless if the Workspace itself is current shortened" (owner, 2026-10-19). Measured, since a flex column moved fifty other elements.
- **2026-10-18, v1.1, #236.** The Config panel: "Config lets editor choose setting for their editor and perform mass action" (owner, 2026-10-18), in three parts. Editor settings are "Settings saved per device".
- **2026-10-18, v1.1, #234.** After a new submission, the editor carries on as an edit of it (the purple UPDATE button): pressing Submit again sent a second one. Opening the editor on a page with your own open submission offers to continue it (a submission was revised as a second one 18 minutes after it was sent). Your own update is scanned like a new submission, so it carries everything changed.
- **2026-10-18, v1.1, #234.** No auto-save while editing a submission: a draft of it came back on the page's editor, where Submit sent it a second time.
- **2026-09-28, v0.20, #206.** One inline diff file for the review queue and the editor, so the two cannot disagree: the editor's older copy printed its tags as text.
- **2026-09-20, v0.19, #196.** The tour: a JRPG-style spotlight on each part of the editor, its steps read from the Writing Guide's headings (the owner's five: Workspace Header, Workspace Navigation, Workspace, Workspace Footer, Preview Panel), so the guide is the one source. It starts from GOT IT on the editor's notice, and steps aside for a notice rather than hiding it, since both are the owner's features.
- **2026-09-20, v0.19, #196.** The Manual of Style: a red MoS button with the Writing Guide's Basics, a language standard, and REWATCH TUTORIAL. The language standard is written in the code, since the guide states none and the owner asked for help ("I actually don't know much about this"): American English, because the guide's Basics writes "capitalize".
- **2026-09-09, v0.18, #185.** A system page's preview repaints only the section being edited, and only while a structural check passes, so a missed case costs a redraw, never a stale preview.
- **2026-09-09, v0.18, #179.** Two first-visit notices, on the editor and the Media Library, both pointing at the Writing Guide. The copy is the owner's, word for word ("Do not change anything"), with the grammar pass they asked for (2026-09-08): "Local Resource" stays singular and capitalised, as the name of a guide section.
- **2026-08-27, v0.17, #142.** An intercept whose ticket did not load is refused at Submit, routed on the URL's intent: clicking EDIT on your own submission had produced a second revision in the queue.
- **2026-08-27, v0.17, #141.** An intercepted ticket with no single scope (a batch, or a whole-page upload) is scanned like a submission instead of rebuilt: the rebuild sent an empty delta, and the reviewer's edits vanished while the button said UPDATED (the "nothing changed" the owner reported).
- **2026-08-25, v0.16, #135.** The editor's role check compares by rank, like the policy: a reviewer saw the Edit button, wrote a whole edit and was refused at Submit.
- **2026-08-25, v0.16, #134.** A draggable splitter between the Workspace and the preview, at 30/70 by default so the preview shows a reader's proportions, snapping onto the default within 2% (owner, 2026-08-25). Its floors are in pixels.
- **2026-08-20, v0.15, #121.** A list whose entries only moved is a change: Submit sends its order, and the change summary reports it.
- **2026-08-20, v0.15, #120.** The editor offers only the tabs a character has: Techs was "not visible even in the editor and the admin preview".
- **2026-08-16, v0.15, #106.** One preview renderer for every keyed section, mirroring the reader's: a second copy per section is how the two drift.
- **2026-08-16, v0.15, #101.** Submit scans every character state, not only the one on screen.
- **2026-08-14, v0.14, #89.** The editor's header collapses, remembered per browser: a preference about a screen, read before the editor draws (the owner's fine-tuning item).
- **2026-08-12, v0.13, #69.** Submit sends every edited tab, not only the open one, from the data the editor already holds.
- **2026-08-11, v0.12, #44.** A tool page's config and prose are separate scopes: the config is the owner's and the prose everyone's.
- **2026-08-10, v0.12, #43.** Character states in the editor: the same toggle as the page, with the editor's data pointed at the active state's slice, so no writer had to learn about states.
- **2026-08-10, v0.12, #41.** A gallery sends one delta per item, keyed by name, so two people adding different items never collide.
- **2026-08-10, v0.12, #40.** Cancel is a chain of real exits: a reviewer intercepting a ticket arrives in a new tab with no history, where going back did nothing.
- **2026-08-08, v0.10, #33.** A viewer is soft-banned from submitting, and told before the QA modal.
