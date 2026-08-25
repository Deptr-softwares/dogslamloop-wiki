-- v0.16 feature 3: Hidden Characters.
--
-- A character playable only in a Private Server. The owner was explicit about
-- what this means (2026-08-24): these are "only playable in a Private Server -
-- basically people know about them, they are just hidden away from the Public
-- and Ranked games." Publicly known, not secret.
--
-- THAT DISTINCTION IS LOAD-BEARING, because this repository is public. A page's
-- name, URL and generated stub are committed to git regardless of any flag
-- here, and navigation.json is a static file anyone can fetch. So `is_hidden`
-- hides a character from the roster UI and from nothing else. It is a correct
-- fit for a private-server character and would NOT be a correct fit for an
-- unreleased one - that case is filed separately and unscheduled.
--
-- Defaults to FALSE so an uninitialised row is visible, which is the behaviour
-- every existing row already has. No backfill is needed and none is done: the
-- column default covers all 52 existing rows without an UPDATE that would
-- rewrite the table.
--
-- No new policy and no new grant. site_pages already has both for SELECT (anon
-- and authenticated) and for the owner's writes; adding a column to a table
-- does not change who may read or write it, and inventing a policy here would
-- only be a second place for the two to disagree.

ALTER TABLE "public"."site_pages"
    ADD COLUMN IF NOT EXISTS "is_hidden" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "public"."site_pages"."is_hidden" IS
    'Private-server-only character: kept out of the roster listing unless the reader turns on "Show Hidden". Not a secrecy mechanism - the page, its URL and its stub are public.';
