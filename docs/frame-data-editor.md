# The Frame Data editor

The editor's Frame Data tabs (M1, Skill, Innate and the rest): a move's stats, media and accolades, its Micro Variants, and the Frame Track, where phases are built on tracks as counted frames, estimates or seconds. Editors use it; readers see the result in the Skill Card (`docs/character-page.md`).

## Files

- `js/editor/tabs/editor-framedata.js`: the whole editor, drawn by `initDawEditor`. The Frame Track is called the DAW in the code (`docs/glossary.md`).
- `js/pages/core/skill_card.js`: the reader's Skill Card, whose scales and phase maths (`FRAME_ESTIMATES`, `phaseWeight`, `phaseSeconds`) the editor uses, so a phase measures the same in both.
- `js/editor/tabs/editor-tabs.js`: the move strip above it and `initPerMoveEditor`, which mounts it.

## Data

- `page_data.frame_data`: each move's stats, `media`, `accolades`, its variants and their tracks and phases. A phase stores one of `duration` (frames), `estimate` or `seconds`.
- `ACCOLADES` in `js/utility/site_lookups.js`: the accolades and their order.

## Watch for

- Edits here change the move in place and never pass through the Block preview, so this file saves the draft itself on a short timer.
- A phase stores only one of its three measures: a count nothing shows is one a reviewer might trust.
- Optional data is stored only while it holds something (accolades, a Micro Variant's media, "no frame data"), so a move ticked and unticked again is the data it was, and a submission shows no change.
- `initDawEditor` is one closure on purpose: its family of `window.*Daw*` functions share its local variables.
- Frame-data edits are outside UNDO (Stage D, the notebook editor).

## Decisions

Newest first. One entry per decision.

- **2026-11-22, silent release, #302.** Frame-data edits are auto-saved like Block edits, on the same short timer. UNDO for them waits for the notebook editor (owner, 2026-11-22: "Undo later").
- **2026-11-18, v1.2, #280.** A move's accolades are chips under its stats, every one in `ACCOLADES`' order, pressed in the accolade's own colour when the move has it. Ticking one of a group that cannot all be true of one move unticks the rest.
- **2026-11-16, v1.2, #273.** A move can have no frame data: the Frame Track and the Micro Variant tabs go away, and it is stored only when ticked.
- **2026-11-16, v1.2, #273.** A Micro Variant can have its own media, shown when that variant is, stored only while it holds something. Each media field measures its own file, so the two never cancel each other.
- **2026-10-29, v1.2, #258.** The Micro Variant tabs wrap (the owner's pick, 2026-10-29): as one row, a fourth new variant pushed + ADD VARIANT out of the Workspace and scrolled it sideways.
- **2026-10-18, v1.1, #234.** A move's "1. STATS & FRAME DATA" section folds, remembered on this device: on a long move it is most of the Workspace, and the strategy Blocks sit under it (owner, 2026-10-18).
- **2026-10-18, v1.1, #234.** The Frame Track keeps its scroll position when it redraws: every click rebuilt it, and on a long move that threw the editor back to frame 0. A different variant starts at its own beginning.
- **2026-09-20, v0.19, #198.** A phase can be timed in seconds, beside counted frames and estimates, and reads in its own unit ("120f" for a typed 2 would show a conversion as what the author wrote). Switching between the three keeps the bar's shape, and seconds keep two decimals.
- **2026-08-11, v0.12, #44.** Estimated phases ("~Short") for moves no one has counted, their width from the label's nominal weight. A phase switched from counted to estimated takes the nearest estimate, so the bar keeps its shape.
- **2026-08-11, v0.12, #44.** A move's media records its real size when its address is pasted, so a Skill Card picks its box shape before the file loads.
