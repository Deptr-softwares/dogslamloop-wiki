---
paths:
  - "js/pages/tier-lists/certified-tier-lists.js"
  - "js/pages/tools/free_submit_tier_list.js"
  - "js/pages/tools/create_tier_list.js"
  - "js/pages/tier-lists/tier-editor.js"
---

# One roster loader

Every tier list reads its characters from `loadCharacterRoster` in `js/utility/site_utils.js`: `data/navigation.json` with `data/portraits.json` merged on, keyed by page id. Until v1.1 there were three copies of it, and two shipped reading `entry.image`, which `navigation.json` carries on no character: a guessed Supabase URL, stale art, and a 404 for the five characters whose files end `Portrait2.webp` or drop the suffix. Free Submit shipped that way until v0.18 FT3, and the tier editor until one batch later.

- Never read the roster or the portrait manifest in a list's own file. `tests/character-roster.spec.js` fails if one does.
- `hidden` is passed through, not filtered: each list decides. Create Tier List leaves hidden characters out; the certified lists may rank one.
- `js/pages/tier-lists/tierlist.js` (`fetchTierRoster`) still merges the manifest itself, onto an array matched by nav id, for the old tab renderer. It is not one of these.

## One reading of a certified list's entries

Since v1.2 an entry in a certified list's `tiers[].characters` is a page id, a badged character `{ id, label, color }`, or a copy `{ id, copy, label, color }` whose key is `page_id#copy`. The editor (`js/pages/tier-lists/tier-editor.js`) and the reader (`js/pages/tier-lists/certified-tier-lists.js`) both read it through `window.tierListEntry` and draw badges with `window.tierBadgeElement` (`js/utility/site_utils.js`).

- Never treat an entry as a plain page id, and never read a label or colour off one directly. `save_tier_list` stores tiers as sent, so `tierListEntry` is also the check: an entry with no string id is dropped, a label is cut to 12 characters, and a colour that is not `#rgb`/`#rrggbb` never reaches a style.
- Moves, notes and `tier_list_changes.character_id` use the entry's key, so each copy is logged on its own.
