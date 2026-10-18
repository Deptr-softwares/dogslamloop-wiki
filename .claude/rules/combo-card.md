---
paths:
  - "js/editor-blocks.js"
  - "js/editor-tabs.js"
---

# The Combo Card has two editors

The `theorybox` block form in `js/editor-blocks.js` and `renderDocumentCardBody` in `js/editor-tabs.js` (a card inside a Combos/Techs group) edit the same data through different markup and different handlers. A field added to one is invisible in the other, and they have drifted more than once: the author-credit field went into the block form alone (fixed in v0.18), and so did the v0.19 Multiple Sections switch, until the owner found it missing.

- Add every Combo Card field to both editors.
- Put a rule both need in a shared helper, not a second copy: `window.editorCardSectionIndex`, `window.seedCardSections` and `window.editorCardFieldTarget` exist for this.
- A rendering test of either surface cannot see that the other was forgotten, so the test for this is derived from the source.
