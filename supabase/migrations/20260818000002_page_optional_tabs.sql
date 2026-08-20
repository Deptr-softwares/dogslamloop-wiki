-- Optional character tabs, configured per page.
--
-- v0.15 item 14 adds a "Techs" tab that most characters should not have. It is
-- off by default and the owner turns it on for the characters that need it, so
-- a page needs somewhere to record that answer.
--
-- WHY page_data AND NOT site_pages
--
-- site_pages is where the owner tools already write, and it was the obvious
-- home. It was rejected deliberately: data/navigation.json is GENERATED from
-- site_pages by the nightly regeneration job, so a toggle written there would
-- not reach the site until regeneration AND the next release. A setting that
-- takes a day and a deploy to appear is a setting nobody trusts.
--
-- page_data is fetched at page boot by every surface that draws the tab strip
-- (js/site_utils.js fetchCloudCharacterData), so the toggle takes effect on the
-- next page load. Owner's call, 2026-08-18.
--
-- WHY A COLUMN AND NOT A KEY INSIDE desc_data
--
-- desc_data is contributor-writable: it is what a pending revision carries and
-- what approving one overwrites wholesale. A setting living in there could be
-- flipped by anyone who can submit an edit, and would be reverted by the next
-- approved revision that happened to be built from a stale copy.
--
-- A separate column inherits page_data's existing RLS instead - "Admin Write
-- Live Data", admin and reviewer only - and nothing in the submit/merge/apply
-- pipeline touches it. js/admin-actions.js approves by upserting page_id,
-- page_type, desc_data, frame_data and last_editor_name; a column absent from
-- that payload is left alone by ON CONFLICT DO UPDATE.
--
-- WHY jsonb AND NOT techs_enabled boolean
--
-- The tab vocabulary lives in one registry (js/character_tabs.js) precisely so
-- that adding a tab is one entry rather than edits at fourteen call sites. A
-- boolean per tab would put half of that back: a second optional tab would need
-- a migration, an owner-tools edit and a fetch change. Keys here are tab ids
-- marked `optional` in that registry, and the value is a boolean:
--
--     {"techs": true}
--
-- An absent key means off, which is what makes the default an empty object
-- rather than a per-tab list that would need backfilling.

ALTER TABLE "public"."page_data"
    ADD COLUMN IF NOT EXISTS "tab_settings" "jsonb" NOT NULL DEFAULT '{}'::"jsonb";

COMMENT ON COLUMN "public"."page_data"."tab_settings" IS
    'Optional character tabs, keyed by tab id from js/character_tabs.js. {"techs": true} shows the Techs tab. Absent means off. Admin/reviewer writable only - see the RLS policy on this table.';

-- An object, never an array or a scalar. The reader treats a non-object as "no
-- optional tabs", so a bad value fails closed rather than throwing - but it
-- should not be storable in the first place.
ALTER TABLE "public"."page_data"
    DROP CONSTRAINT IF EXISTS "page_data_tab_settings_is_object";

ALTER TABLE "public"."page_data"
    ADD CONSTRAINT "page_data_tab_settings_is_object"
    CHECK ("jsonb_typeof"("tab_settings") = 'object');

-- No new policy and no new GRANT: this is a column on an existing table, so it
-- is covered by "Public Read Live Data" (SELECT, everyone) and "Admin Write
-- Live Data" (admin/reviewer) already, and by the table-level grants those
-- policies are paired with. A column-level grant would only narrow what those
-- already allow, and page_data has never used one.
