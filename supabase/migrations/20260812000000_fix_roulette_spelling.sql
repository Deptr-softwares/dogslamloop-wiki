-- Fix the spelling of the Roulette page.
--
-- Created 2026-08-10 as "Roullete", at "others/roullete/index.html". The
-- display name is cosmetic; the URL is not. A page URL is permanent the moment
-- anyone shares it, so this is worth fixing now, while nothing points at it,
-- rather than living with the typo or leaving a tombstone behind later.
--
-- Safe to do as a straight UPDATE because the page has no content yet. Checked
-- before writing this, against production:
--
--   page_data          0 rows for page_id 'roullete'
--   page_permissions   0 rows
--   pending_revisions  0 rows
--
-- and page_history cannot have rows without page_data, since history is
-- written from it. So nothing references the old id and there is nothing to
-- cascade. If that were not true this would need to move the dependent rows
-- first - page_id is the join key everywhere.
--
-- No generated artifact is touched here. data/navigation.json is rebuilt from
-- this table by scripts/fetch-registry.js, so it picks the change up on the
-- next refresh; it cannot be updated in this migration and must not be
-- hand-edited.

UPDATE "public"."site_pages"
SET
    "page_id" = 'roulette',
    "nav_id"  = 'Roulette',
    "name"    = 'Roulette',
    "url"     = 'others/roulette/index.html'
WHERE "page_id" = 'roullete';
