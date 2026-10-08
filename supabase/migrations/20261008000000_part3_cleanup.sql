-- v1.0 Part 3: three cleanups the owner asked for (2026-10-08). Spec:
-- V1.0-DEVLOG.md, "Part 3", "Decided 2026-10-08".
--
-- 1. THE TEMPLATE M1 IMAGES. 55 M1 cards on 14 characters link to
--    <character>_firstm1.png, _secondm1.png, _thirdm1.png, _fourthm1.png and
--    _downslam.png in the wiki-media bucket: files from a template that were
--    never uploaded. All 55 answered "not found" on 2026-10-08, so readers see
--    a broken image. The owner chose to remove the links over keeping them for
--    uploads. Each card is left with the empty media the move editor itself
--    creates ({"src": "", "alt": ""}, js/editor-framedata.js), so it shows
--    "[ Missing Media ]" and its editor offers the field.
--
--    Matched on the bucket path AND the five template names, and only where no
--    such object exists in storage, so a real upload under one of those names,
--    made before this runs, is left alone. All 55 are in frame_data.m1s.
--
--    This is content written by contributors, which a preview branch never
--    holds: on a preview it updates nothing, and the first real run is
--    production's.
--
--    trigger_archive_page_before_update saves each page's previous version to
--    page_history, credited to NEW.last_editor_name. Left alone, that would
--    name whoever last edited the page as the author of this cleanup, so it
--    is set to a label, as js/admin-history.js does when restoring a version.
--
-- 2. site_pages.tier. "TBD" on 22 characters and empty everywhere else,
--    checked on production 2026-10-08. Owner: "Delete the "Tier" key on all
--    characters". The only readers were the roster's Tier filter, the owner
--    tools' Page Details form and scripts/fetch-registry.js, all changed in
--    the same release. No view or function reads it (checked against
--    production: submit_tier_votes names site_pages, but its "tier" is
--    free_submit_votes').
--
-- 3. THE OWNER'S TIER LIST DESCRIPTION. 20260813000005 seeded the owner's list
--    with the blurb "The original certified ranking, carried over from the
--    site's single tier list." The owner asked for that line deleted. Nothing
--    on the site edits a blurb after a list is made, so it is cleared here,
--    and only while it still reads exactly as seeded. A blurb that is NULL is
--    not shown (js/certified-tier-lists.js). tier_lists has no trigger, so
--    the list's "updated" time does not move.

UPDATE "public"."page_data" pd
SET "last_editor_name" = 'Site cleanup (v1.0): template M1 images removed',
    "frame_data" = jsonb_set(pd."frame_data", '{m1s}', (
    SELECT jsonb_agg(
        CASE
            WHEN m.value->'media'->>'src' ~ '/storage/v1/object/public/wiki-media/[^/]+_(firstm1|secondm1|thirdm1|fourthm1|downslam)\.png$'
             AND NOT EXISTS (
                SELECT 1 FROM "storage"."objects" o
                WHERE o.bucket_id = 'wiki-media'
                  AND o.name = regexp_replace(m.value->'media'->>'src', '^.*/storage/v1/object/public/wiki-media/', '')
             )
            THEN jsonb_set(m.value, '{media}', '{"src": "", "alt": ""}'::jsonb)
            ELSE m.value
        END
        ORDER BY m.ordinality)
    FROM jsonb_array_elements(pd."frame_data"->'m1s') WITH ORDINALITY AS m(value, ordinality)
))
WHERE jsonb_typeof(pd."frame_data"->'m1s') = 'array'
  AND jsonb_array_length(pd."frame_data"->'m1s') > 0
  AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(pd."frame_data"->'m1s') e
      WHERE e->'media'->>'src' ~ '/storage/v1/object/public/wiki-media/[^/]+_(firstm1|secondm1|thirdm1|fourthm1|downslam)\.png$'
  );

ALTER TABLE "public"."site_pages" DROP COLUMN IF EXISTS "tier";

UPDATE "public"."tier_lists"
SET "blurb" = NULL
WHERE "slug" = 'owner'
  AND "blurb" = 'The original certified ranking, carried over from the site''s single tier list.';
