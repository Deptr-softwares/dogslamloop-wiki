-- History shows the whole page as it was after a revision (owner, 2026-10-29:
-- "The whole page as it was").
--
-- history.html drew a revision by applying its delta to an EMPTY page, so it
-- showed the changed parts surrounded by "has not been written yet", and the
-- page it was part of never appeared. page_history already holds the whole
-- page: archive_page_version snapshots page_data's content BEFORE every live
-- change. So the page as it was right after revision N is the first snapshot
-- taken after N was approved, or the live page if nothing has changed since.
--
-- Two things were missing:
--   1. When a revision was approved. Nothing recorded it (qa_metadata carries
--      only reviewed_by), so none of the approvals before this migration can
--      be paired with a snapshot. They keep showing what they changed.
--   2. A way for a reader to see a snapshot. page_history is staff-only.
--
-- Approval writes page_data first and marks the revision approved second
-- (js/admin-actions.js), so the approval's own snapshot (the page BEFORE it)
-- is older than approved_at, and the next one is the page after it.


-- =========================================================================
-- 1. approved_at, set by the database
-- =========================================================================
--
-- Set by a trigger rather than by the page that approves, so every way of
-- approving gets it and nobody can write their own: a client value is
-- replaced on every INSERT and UPDATE. An inserted row never counts as
-- approved, because no part of the site approves by inserting.

ALTER TABLE "public"."pending_revisions"
    ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone;

CREATE OR REPLACE FUNCTION "public"."stamp_revision_approval"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.approved_at := NULL;
    ELSIF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
        NEW.approved_at := now();
    ELSE
        NEW.approved_at := OLD.approved_at;
    END IF;
    RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."stamp_revision_approval"() OWNER TO "postgres";

-- A trigger function is never called directly (20260819000000).
REVOKE ALL ON FUNCTION "public"."stamp_revision_approval"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."stamp_revision_approval"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."stamp_revision_approval"() FROM "authenticated";

DROP TRIGGER IF EXISTS "stamp_revision_approval" ON "public"."pending_revisions";
CREATE TRIGGER "stamp_revision_approval"
    BEFORE INSERT OR UPDATE ON "public"."pending_revisions"
    FOR EACH ROW EXECUTE FUNCTION "public"."stamp_revision_approval"();


-- =========================================================================
-- 2. The page as it was after an approved revision
-- =========================================================================
--
-- SECURITY DEFINER because page_history is staff-only. What it returns is
-- page content that was live, and page_data is readable by everyone for
-- every page ("Public Read Live Data"), so a reader learns nothing they could
-- not have read at the time. It answers only for an approved revision with an
-- approval time, and NULL for anything else, which history.html reads as
-- "show what it changed".
--
-- source is 'snapshot' or 'live', for the page to say which it is showing.

CREATE OR REPLACE FUNCTION "public"."get_page_after_revision"("target_revision_id" uuid)
RETURNS jsonb
LANGUAGE "sql"
STABLE
SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
    WITH "rev" AS (
        SELECT "r"."page_id", "r"."approved_at"
        FROM "public"."pending_revisions" "r"
        WHERE "r"."id" = "target_revision_id"
          AND "r"."status" = 'approved'
          AND "r"."approved_at" IS NOT NULL
    ),
    "snap" AS (
        SELECT "h"."desc_data", "h"."frame_data"
        FROM "public"."page_history" "h", "rev"
        WHERE "h"."page_id" = "rev"."page_id"
          AND "h"."version_timestamp" > "rev"."approved_at"
        ORDER BY "h"."version_timestamp" ASC
        LIMIT 1
    )
    SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM "rev") THEN NULL
        WHEN EXISTS (SELECT 1 FROM "snap") THEN (
            SELECT jsonb_build_object('desc_data', "desc_data", 'frame_data', "frame_data", 'source', 'snapshot')
            FROM "snap")
        ELSE (
            SELECT jsonb_build_object('desc_data', "p"."desc_data", 'frame_data', "p"."frame_data", 'source', 'live')
            FROM "public"."page_data" "p", "rev"
            WHERE "p"."page_id" = "rev"."page_id")
    END;
$$;

ALTER FUNCTION "public"."get_page_after_revision"(uuid) OWNER TO "postgres";

-- History is a public page, so readers who are not signed in call this too.
REVOKE ALL ON FUNCTION "public"."get_page_after_revision"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."get_page_after_revision"(uuid) TO "anon";
GRANT EXECUTE ON FUNCTION "public"."get_page_after_revision"(uuid) TO "authenticated";

COMMENT ON FUNCTION "public"."get_page_after_revision"(uuid) IS
    'The page as it was right after an approved revision: the first page_history snapshot taken after approved_at, or the live page if there is none. NULL for a revision that is not approved or has no approval time.';

-- The lookup above, per page in time order.
CREATE INDEX IF NOT EXISTS "page_history_page_time_idx"
    ON "public"."page_history" ("page_id", "version_timestamp");
