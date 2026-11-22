# The Block editor

The Workspace's list of Blocks: their forms, the format toolbar, the colour popups, folders, selection, copy and paste, dragging, reordering list strips, Find and Replace, and the Media Library. Editors use it on edit.html; the owner tools, the Post editor and the tier editor load the parts they need.

## Files

- `js/editor/blocks/editor-blocks.js`: the Block list and each Block's form, the format toolbar and its popups (colour, gradient, section link, icon), selection, copy and paste, dragging, table cells, and textarea sizing.
- `js/editor/blocks/editor-folders.js`: Block folders.
- `js/editor/blocks/editor-reorder.js`: reorder and insert in place on every list strip (moves, matchups, sections, combo groups and the rest).
- `js/editor/tools/editor-find-replace.js`: Find and Replace across a whole page.
- `js/editor/tools/editor-media.js`: the Media Library, uploads, and the picker the Gallery bin opens.

## Data

- `page_data.desc_data`: the Blocks. A Block's `folder` and `folderColor` are editor-only: the page renderer reads named fields and never these.
- The `wiki-media` bucket: uploaded media. `media_uploads`: who uploaded each file. `can_upload_media()`: whether the signed-in editor may upload.
- `localStorage` `dsl_recent_colors`: the Recent colours row, per device.

## Watch for

- Every contributor value in a Block's form reaches innerHTML, most of them inside an attribute, so each one goes through `escapeHtml`. Colours go through `safeColor` or an allowlist, never an escape alone. Test: `tests/block-escaping.spec.js`.
- Which Blocks are shut, selected or showing a Combo Card section is kept by the Block object (a WeakSet or WeakMap), never by index and never on the Block: an index moves on reorder, and a flag would be saved into the page.
- A folder is a contiguous run of Blocks sharing a `folder` value. Any move ends in `reconcileFolderAt`, or a run splits into two folders with one name.
- History holds states: a change saves its start with `saveBlockHistory()` and its end through `updateLivePreview()`. A change that skips either half makes UNDO take back the edit before it.
- `initStrategyBlockBuilder` is one closure on purpose: its parts share its local variables.
- owner.html and tier-editor.html load `editor-blocks.js` without `editor-core.js`, so `customConfirm` and `editorAlert` are missing there and the code checks for them.

## Decisions

Newest first. One entry per decision.

- **2026-11-19, v1.2, #286.** The Media Library lists names, with one preview: a card per clip downloaded 52.2 MB of one page's 120.7 MB before anyone hovered. Nothing is fetched until a row is picked. The picker takes one more click (USE THIS), the price of seeing the file first. Words search the file name and "@" searches by uploader (owner, 2026-11-19).
- **2026-11-19, v1.2, #286.** The library pages through the whole bucket: one page of 1,000 hid every file past it, from the list and from the overwrite guard alike (pages linked 510 files that day).
- **2026-11-19, v1.2, #284.** The toolbar's icon picker offers the accolades, every character whose icon is uploaded, and then the site's own icons, as the owner asked. A character with no icon is left out, since its tag would come back as text.
- **2026-11-19, v1.2, #283.** The Color Swatches and Collaborator Blocks are offered on their own page only (Color Codes, Collaborators).
- **2026-10-21, v1.1, #242.** Uploading is off in the Playground: it sends nothing anywhere, and an upload would be live in the shared library at once (owner, 2026-10-20).
- **2026-10-20, v1.1, #241.** Recent colours: the last ten custom colours an editor applied, gradients too, newest first, per device, "so the editor don't need to go to color everytime and redraw the custom color to get it" (owner, 2026-10-20). A colour with a preset is left out, and only an exact match counts as the same colour (the owner's pick over near ones). One list for the text colour popup, a heading's side bar, a folder's colour and Config > Page words.
- **2026-10-20, v1.1, #241.** A notation style's name field lists the style names the page already uses, most used first, because a reader's choice follows the name: the helper "was meant to detect the current style name being used on the page itself, and suggest the editor to name the style like that for sync purpose" (owner, 2026-10-20).
- **2026-10-20, v1.1, #239.** A custom gradient of two to six stops, from an editor's feedback ("multicolor becomes an option instead of manually typing it out"). Six was the most any gradient on the site used that day (28 of 31 used two). It is shut until its heading is clicked: open, it pushed the presets under the tab buttons on a short screen.
- **2026-10-20, v1.1, #239.** Folders have a colour, from an editor's feedback ("add coloring to folders for visual sorting"), picked per folder, saved with the page and reviewed like any edit (owner, 2026-10-19). It is stored on every member, like the name.
- **2026-10-20, v1.1, #239.** A whole folder can be dragged by the handle on its header, from an editor's feedback ("let folders be arranged for faster organization in group batches instead of one at a time"). Folders do not nest, so a drop inside one moves to its nearer edge.
- **2026-10-20, v1.1, #239.** In a Table Block, clicking a cell picks its row and column, from an editor's feedback: -Row and -Col could only take the last one, so a mistake in the middle meant retyping everything below it. With nothing picked, the buttons act at the end as before.
- **2026-10-20, v1.1, #239.** The table buttons stay under the pointer while the table grows or shrinks above them: adding five rows meant chasing +Row down the screen (editor feedback, 2026-10-19).
- **2026-10-20, v1.1, #239.** + FOLDER says what it makes, and the open and close button is a chevron: a bare + beside the name was taken for the folder's dropdown (editor feedback). The header's buttons are gray, and turn green or red only once the hover sweep has filled them (owner, 2026-10-20).
- **2026-10-20, v1.1, #238.** A Heading Block has an optional side bar in any colour: every Block renders the same way across the site, and the coloured bar the Matchup, Counterplay and Starter Guide tabs gave their headings became a style of the Heading Block (owner, 2026-10-19).
- **2026-10-18, v1.1, #236.** Every "delete this?" in the editors asks through `confirmDelete`, and one switch in Config turns them all off: "All destructive actions in the editor should have a double confirm modal", with "the option to be entirely turns off" (owner, 2026-10-18). The Delete key on a selection asks too, though UNDO covers it. A prompt that asks a real question (restore a draft, replace all) is never switched off.
- **2026-10-18, v1.1, #236.** With the drag handles hidden in Config, a card's left edge is the handle: "The editor can still move the Blocks around by grabbing its left edge" (owner, 2026-10-18).
- **2026-10-18, v1.1, #234.** A one-line field (a move name, a table cell, a combo's damage) widens over its neighbours while it is edited and its text overflows: the owner's call, trading neatness for being able to read what is typed. Nothing beside it moves, and it is the same element throughout.
- **2026-10-08, v1.0, #224.** The format toolbar reaches fields outside the builder that carry `data-format-field`, starting with the Combo Card's Name: the toolbar wrote nothing there, or into the last builder field (owner, 2026-10-08).
- **2026-09-29, v0.20, #208.** The library asks before uploading a clip over 2 MB or past 720p, and never refuses: every clip on Puppet Master's Overview was 1920x1080, 0.3 to 4.9 MB, shown in a column about 800px wide. A long clip can be heavy and still be the right file.
- **2026-09-28, v0.20, #206.** Uploading needs the upload media permission: Trusted Editors and up have it by role, and the owner can tick it for anyone else. Storage's policy enforces it; the library only says so first.
- **2026-09-28, v0.20, #205.** Notation styles (a combo's extra routes) are edited on four surfaces, with the markup, the writes and the add and remove rules in one place: the Combo Card's two editors had drifted three times.
- **2026-09-24, v0.20, #203.** The Workspace opens with every Block open again, and folders shut: the owner reverted collapsed-by-default after living with it, "navigating through huge amount of content is easier than navigating through a bunch of boxes that have a tiny preview".
- **2026-09-24, v0.20, #203.** A Combo Card in Multiple Sections is named in a list by its first section's title, the tab a reader lands on, and a new section's tab label starts empty: seeded from the title, it kept "New Combo" for good.
- **2026-09-20, v0.19, #198.** The Section Box (a title, an introduction and switchable sections) and Multiple Sections on the Combo Card share comboGroups' `{ title, content }` shape, so the diff and the renderer needed no new container shape. Turning Multiple Sections on seeds the first section from the card, and off copies the section on screen back, so the switch loses nothing.
- **2026-09-20, v0.19, #197.** Blocks can be selected with Ctrl-click and moved, copied, pasted or deleted together, from a bar that shows while something is selected. A card in the selection hands its own buttons to the whole selection, as a file manager does. Delete only, never Backspace: to many people it means "go back".
- **2026-09-20, v0.19, #196.** Gradient presets for `[multicolor=]`, two-stop pairs only: a quick tool that asks how many stops is not quick, and more stops can be typed.
- **2026-09-10, v0.19, #191.** The library credits whoever uploaded each file. A failed credit fails silently: a credit is a caption, and the upload already worked.
- **2026-09-09, v0.18, #184.** The Gallery tab reuses the whole Block editor for its footer (the format tools and the Media Library), the owner's call: the toolbar's bindings all resolve through one container, and lifting them out would have put the most-used editor path through a refactor. The library opens as a picker there.
- **2026-08-25, v0.16, #133.** One map names every Block type, and the Add Block menu and every card's type dropdown read it: the dropdown printed raw keys, and the owner looked in the menu for the "THEORYBOX" it showed, and asked for a Block that already existed as + Combo Card.
- **2026-08-25, v0.16, #133.** The link button asks in the site's own modal, not window.prompt.
- **2026-08-25, v0.16, #129.** A shut Block shows a one-line label from the field its type keeps its meaning in, and a new Block opens, since it was made to be written in. A folder is a transparent strip held together by its left rule, not a quieter card, with glyph buttons that have a title and a label. A shut Block hides its folder picker: "When I open a folder, I already know that those blocks are in that folder." (owner, 2026-08-25).
- **2026-08-20, v0.15, #121.** A new Block has no author credit: credit is the contributor's choice, and stamping it repeated one name per Block in the tab's contributor list.
- **2026-08-18, v0.15, #115.** Block folders: a contiguous run sharing a name, editor-only, so a reader's page is the same with or without them. The name is an input (renaming is the most common thing done to a folder), the picker is a custom dropdown so "no folder" and "create new folder" do not look like two more folders (owner, 2026-08-18), an empty folder lives for the session only, and ungrouping keeps every Block.
- **2026-08-18, v0.15, #114.** Every list strip has one fixed group of reorder and insert controls acting on the selected entry: per-item controls moved with the item, so a second nudge meant chasing them (found by the owner). Inserting runs the strip's own add flow, then moves the new entry.
- **2026-08-18, v0.15, #113.** Find and Replace walks a page's data rather than a list of Block types, and never touches structure, links, media, credit or identity fields. It searches every tab and every character state, and has an UNDO of its own, since the editor's covers only the open section.
- **2026-08-17, v0.15, #108.** A textarea grows to fit, then stops and scrolls (owner, 2026-08-17). A combo's route field scrolls at a sensible height, in monospace so the steps line up, and the Combo Card's fields are dense, since the form beside a preview had become a scroll before anyone typed (owner, 2026-08-17).
- **2026-08-16, v0.15, #105.** Every contributor value in a Block's form is escaped, because most land inside an attribute, where an unescaped quote ends it: a reviewer opening a ticket opens that contributor's content in this editor.
- **2026-08-15, v0.14, #91.** A visual colour picker in place of `<input type="color">`, which opens the system's own dialog and can take the text selection (the owner's fine-tuning item).
- **2026-08-12, v0.13, #58.** The colour popup offers the characters' and the frame data's colours beside the basic seven, which stay a group of their own as the neutral choices.
- **2026-08-12, v0.13, #56.** The library uploads several files at once, one after another (the overwrite guard reads one snapshot of the bucket), and refuses new MP4s (owner, 2026-08-12). Every MP4 on the wiki still plays. Measured the day before: MP4 was 18% of the files and 56% of the bytes, 4.6 times a WebM on average.
- **2026-08-01, v0.5, #26.** Dragging uses pointer events, so mouse and touch share one path: native drag and drop never fires from touch.
