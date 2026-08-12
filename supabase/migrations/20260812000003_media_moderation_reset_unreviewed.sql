-- Correct the seed from 20260812000002_media_moderation.sql.
--
-- That migration seeded EVERY object in the wiki-media bucket as approved,
-- with a note saying the owner reviewed them on 2026-08-11. It was written
-- against a measurement of 198 files taken that day. The bucket actually held
-- 316 by the time it ran:
--
--   total objects      316
--   predate 2026-08-11 198   <- genuinely reviewed
--   since  2026-08-11  118   <- never reviewed by anyone
--   placeholders         0
--
-- The media team began bulk-recording skill clips, which is why the number
-- moved so fast. The content is not in question - the owner confirmed the new
-- clips are expected and fine.
--
-- Two things are wrong anyway, and the second is the reason this migration
-- exists rather than being left alone:
--
--   1. Those 118 rows assert a review that did not happen. An audit trail
--      that records the wrong thing is worse than one with a gap in it.
--   2. The queue would open EMPTY. Every file reads as approved, so the one
--      screen built to show "what has nobody looked at" would show nothing,
--      on precisely the 118 files it exists for.
--
-- Resetting is a DELETE, not a status change - absence of a row means
-- unchecked, which is the whole point of that design. This is the first time
-- that has paid off.
--
-- Matched on storage.objects.created_at rather than a file list, so the
-- boundary is the bucket's own record of when each object arrived rather than
-- anything restated here. Objects uploaded between that migration and this
-- one are caught by the same rule.

DELETE FROM "public"."media_moderation" AS "m"
USING "storage"."objects" AS "o"
WHERE "o"."bucket_id" = 'wiki-media'
  AND "o"."name" = "m"."path"
  AND "o"."created_at" >= '2026-08-11'::timestamptz
  -- Only the seeded rows. A reviewer who has already judged one of these
  -- through the queue must not have that decision thrown away by a migration
  -- that lands afterwards.
  AND "m"."note" LIKE 'Seeded on 2026-08-12:%';
