-- v0.11: an optional per-page switch for hiding an archived page's leftover
-- entry points.
--
-- Archiving a page has never been as complete as it looks. Setting status to
-- 'archived' drops the row from navigation.json (scripts/fetch-registry.js),
-- which removes it from the sidebar, the roster grid and the systems
-- directory - and that is where it stopped. Two things survived:
--
--   1. The page's own stub. generate-pages.js has only ever read
--      navigation.json, so an archived page was invisible to it and its file
--      stayed on disk serving HTTP 200 with the full original content. v0.11
--      fixes that separately with a tombstone stub; it needs no column.
--   2. References from elsewhere that do not come from navigation.json:
--      matchup and counterplay cards on other character pages, and tier-list
--      rows. Those live in other pages' page_data and keep rendering a link to
--      a page that is no longer part of the wiki.
--
-- (2) is what this column addresses. It is deliberately separate from status
-- rather than implied by it, because the two have different reversibility.
-- Archiving should stay a cheap, undoable decision; scrubbing a character out
-- of every matchup table on the site is a heavier one, and the owner asked for
-- it to be optional.
--
-- Defaults false so this migration changes no behaviour on its own: every
-- existing archived page keeps rendering exactly as it does today until the
-- switch is turned on for it deliberately.

ALTER TABLE "public"."site_pages"
    ADD COLUMN IF NOT EXISTS "hide_entry_points" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "public"."site_pages"."hide_entry_points" IS
    'When true, the front-end also hides references to this page that do not come from navigation.json (matchup/counterplay cards, tier-list rows). Only meaningful for status = ''archived''.';

-- No new policy and no new grant, deliberately - and this is worth stating
-- rather than leaving as an absence, because "policy without a grant" has
-- caught this project twice.
--
-- The existing "Admins can manage the page registry" policy is table-level
-- with USING and WITH CHECK on get_my_role() = 'admin', so it already governs
-- UPDATEs to this column. The existing grants are unqualified table grants
-- (GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ... ), not column-level ones,
-- so they extend to columns added later. Had they been column-scoped, this new
-- column would have been silently unwritable and the UI would have failed with
-- no error that pointed here.
--
-- get_my_role() = 'admin' is also correct as written rather than needing
-- IS DISTINCT FROM: NULL = 'admin' is NULL, which denies, and denying a
-- signed-in user with no role is the intent. The IS DISTINCT FROM rule applies
-- to the inverse shape, where a NULL role would otherwise deny everyone.
