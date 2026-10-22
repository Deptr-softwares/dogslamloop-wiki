---
paths:
  - "js/certified-tier-lists.js"
  - "js/tools/free_submit_tier_list.js"
  - "js/tools/create_tier_list.js"
  - "js/tier-editor.js"
---

# One roster loader

Every tier list reads its characters from `loadCharacterRoster` in `js/site_utils.js`: `data/navigation.json` with `data/portraits.json` merged on, keyed by page id. Until v1.1 there were three copies of it, and two shipped reading `entry.image`, which `navigation.json` carries on no character: a guessed Supabase URL, stale art, and a 404 for the five characters whose files end `Portrait2.webp` or drop the suffix. Free Submit shipped that way until v0.18 FT3, and the tier editor until one batch later.

- Never read the roster or the portrait manifest in a list's own file. `tests/character-roster.spec.js` fails if one does.
- `hidden` is passed through, not filtered: each list decides. Create Tier List leaves hidden characters out; the certified lists may rank one.
- `js/tierlist.js` (`fetchTierRoster`) still merges the manifest itself, onto an array matched by nav id, for the old tab renderer. It is not one of these.
