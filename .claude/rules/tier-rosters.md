---
paths:
  - "js/certified-tier-lists.js"
  - "js/tools/free_submit_tier_list.js"
  - "js/tier-editor.js"
---

# Three copies of loadRoster

`js/certified-tier-lists.js`, `js/tools/free_submit_tier_list.js` and `js/tier-editor.js` each carry a near-identical `loadRoster`: read `data/navigation.json`, then merge `data/portraits.json` onto it. `navigation.json` has no `image` field on any character, so a copy that skips the manifest falls back to a guessed Supabase URL: stale art, and a 404 for the five characters whose files end `Portrait2.webp` or drop the suffix. Free Submit shipped that way until v0.18 FT3, and the tier editor until one batch later.

- Change all three together, and check the other two whenever one is touched.
- Unifying them is the owner's call, not a refactor to make in passing.
