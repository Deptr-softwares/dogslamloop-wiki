-- v0.11: a lightweight completeness summary, for the Character Dashboard's
-- "what needs work" panel.
--
-- The panel needs one boolean per section per character. Computing that in the
-- browser means selecting page_data's full contents: measured at 385 KB for
-- the 21 character rows, because desc_data carries every strategy paragraph
-- and frame_data every move. Downloading a third of a megabyte of prose to
-- decide which checkboxes to tick is the wrong shape, especially on a hub page
-- that already fetches the roster, the revision feed and the tier list.
--
-- This view returns the same information in a few hundred bytes.
--
-- security_invoker is on, so the view is read with the caller's own
-- permissions rather than the owner's. page_data is already public-read
-- ("Public Read Live Data"), so this exposes nothing new - but a view that
-- silently ran as its owner would be a way to leak a table later, when
-- somebody adds a column here without rechecking that policy.
--
-- Section names mirror desc_data's own keys exactly rather than being
-- "improved", so a reader can map a false back to the thing to go and write.
-- The CASE/jsonb_typeof guard on every field is not defensive padding:
-- jsonb_array_length raises on a non-array, so a single malformed row would
-- otherwise break the panel for every character at once.

CREATE OR REPLACE VIEW "public"."page_completeness"
WITH (security_invoker = on) AS
SELECT
    "page_id",
    "page_type",

    -- Objects: present and not an empty object.
    (COALESCE("desc_data"->'profile', 'null'::jsonb) <> 'null'::jsonb
        AND COALESCE("desc_data"->'profile', '{}'::jsonb) <> '{}'::jsonb)   AS "has_profile",
    (COALESCE("desc_data"->'playstyle', 'null'::jsonb) <> 'null'::jsonb
        AND COALESCE("desc_data"->'playstyle', '{}'::jsonb) <> '{}'::jsonb) AS "has_playstyle",

    -- Arrays: present with at least one entry.
    (CASE WHEN jsonb_typeof("desc_data"->'overview') = 'array'
          THEN jsonb_array_length("desc_data"->'overview') > 0 ELSE false END)    AS "has_overview",
    (CASE WHEN jsonb_typeof("desc_data"->'strategy') = 'array'
          THEN jsonb_array_length("desc_data"->'strategy') > 0 ELSE false END)    AS "has_strategy",
    (CASE WHEN jsonb_typeof("desc_data"->'matchups') = 'array'
          THEN jsonb_array_length("desc_data"->'matchups') > 0 ELSE false END)    AS "has_matchups",
    (CASE WHEN jsonb_typeof("desc_data"->'counterplay') = 'array'
          THEN jsonb_array_length("desc_data"->'counterplay') > 0 ELSE false END) AS "has_counterplay",

    (CASE WHEN jsonb_typeof("frame_data"->'m1s') = 'array'
          THEN jsonb_array_length("frame_data"->'m1s') > 0 ELSE false END)      AS "has_m1s",
    (CASE WHEN jsonb_typeof("frame_data"->'skills') = 'array'
          THEN jsonb_array_length("frame_data"->'skills') > 0 ELSE false END)   AS "has_skills",
    (CASE WHEN jsonb_typeof("frame_data"->'specials') = 'array'
          THEN jsonb_array_length("frame_data"->'specials') > 0 ELSE false END) AS "has_specials",

    -- System pages store everything under tabs, so they get one flag rather
    -- than the character breakdown.
    (CASE WHEN jsonb_typeof("desc_data"->'tabs') = 'array'
          THEN jsonb_array_length("desc_data"->'tabs') > 0 ELSE false END)      AS "has_tabs"

FROM "public"."page_data";

ALTER VIEW "public"."page_completeness" OWNER TO "postgres";

-- A view needs its own grant; inheriting the underlying table's is not a
-- thing. Without this the panel would 401 while page_data itself reads fine,
-- which is the confusing shape this project has hit twice already.
GRANT SELECT ON "public"."page_completeness" TO "anon";
GRANT SELECT ON "public"."page_completeness" TO "authenticated";

COMMENT ON VIEW "public"."page_completeness" IS
    'Per-section booleans derived from page_data, for the Character Dashboard''s "what needs work" panel. Exists so that panel does not have to download every page''s full contents to count empty sections.';
