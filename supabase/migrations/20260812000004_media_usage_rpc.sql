-- Which media is actually used, and where.
--
-- Feeds the moderation queue's usage filters (used live / only in history or
-- pending / unused anywhere) and the media library's usage badges.
--
-- WHY THIS IS EXTRACTION AND NOT A LIKE SCAN
--
-- The obvious query - join storage.objects to the page tables on
-- "text LIKE '%' || name || '%'" - was measured on production before this was
-- written. It took **14.7 seconds** over 9 MB of data:
--
--   Nested Loop, 316 objects x 211 history rows = 66,676 pairs
--   Rows Removed by Join Filter: 65,924
--   Execution Time: 14746 ms
--
-- The data is not the problem; the shape is. Every pair re-materialises an
-- ~18 kB concatenation, so answering a question about 9 MB costs well over a
-- gigabyte of text scanning, and it is quadratic - at the current rate of 4.9
-- history rows a day it degrades steadily while the data stays trivial.
--
-- Extracting the references instead is one pass over ~513 rows.
--
-- WHAT THIS DELIBERATELY IS NOT
--
-- **Not authoritative for deletion.** Extraction and the garbage collector's
-- substring matching fail in OPPOSITE directions: substring matching
-- over-matches, so its mistakes keep files alive, while a regex that misses
-- an unusual reference form makes a used file look unused. That asymmetry is
-- fine for a label and unacceptable for a delete path, so the collector keeps
-- its own conservative check and this function never feeds it. "Unused" in
-- the queue means "nothing found", not "safe to delete".
--
-- SECURITY INVOKER (the default), on purpose. An earlier sketch read
-- storage.objects, which would have forced SECURITY DEFINER and with it the
-- whole privilege-escalation surface this project has already been burned by
-- once. Reading only the three page tables means existing RLS decides what a
-- caller sees, and the client joins the result against the bucket listing it
-- already has.
--
-- Percent-encoding is left to the caller. The same object appears raw in some
-- rows and encoded in others; the client normalises both sides against the
-- bucket listing rather than this function guessing at a decoder in SQL.

CREATE OR REPLACE FUNCTION "public"."media_usage"()
RETURNS TABLE ("path" "text", "live_pages" "text"[], "other_refs" bigint)
LANGUAGE "sql"
STABLE
SET "search_path" TO 'public'
AS $$
    WITH "live" AS (
        SELECT "p"."page_id", "m"[1] AS "ref"
        FROM "public"."page_data" AS "p",
             LATERAL "regexp_matches"(
                 COALESCE("p"."desc_data"::"text", '') || COALESCE("p"."frame_data"::"text", ''),
                 'wiki-media/([^"?]+)', 'g') AS "m"
    ),
    "historical" AS (
        SELECT "m"[1] AS "ref"
        FROM "public"."page_history" AS "h",
             LATERAL "regexp_matches"(
                 COALESCE("h"."desc_data"::"text", '') || COALESCE("h"."frame_data"::"text", ''),
                 'wiki-media/([^"?]+)', 'g') AS "m"
        UNION ALL
        SELECT "m"[1]
        FROM "public"."pending_revisions" AS "r",
             LATERAL "regexp_matches"(
                 COALESCE("r"."desc_data"::"text", '') || COALESCE("r"."frame_data"::"text", '') || COALESCE("r"."delta_payload"::"text", ''),
                 'wiki-media/([^"?]+)', 'g') AS "m"
    )
    -- A live row carries its page_id; a historical one carries NULL, which is
    -- what separates the two counts in a single grouping.
    SELECT "combined"."ref",
           COALESCE("array_agg"(DISTINCT "combined"."page_id")
                    FILTER (WHERE "combined"."page_id" IS NOT NULL), '{}'::"text"[]),
           "count"(*) FILTER (WHERE "combined"."page_id" IS NULL)
    FROM (
        SELECT "ref", "page_id" FROM "live"
        UNION ALL
        SELECT "ref", NULL::"text" FROM "historical"
    ) AS "combined"
    GROUP BY "combined"."ref";
$$;

-- Creating a function grants EXECUTE to PUBLIC. Every new RPC in this project
-- starts exposed to anonymous callers, and that is exactly how the 2026-08-07
-- privilege escalation happened - so the default is revoked before anything
-- is granted, even though this one is SECURITY INVOKER and RLS would already
-- limit what anon could see.
REVOKE ALL ON FUNCTION "public"."media_usage"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."media_usage"() FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."media_usage"() TO "authenticated";
