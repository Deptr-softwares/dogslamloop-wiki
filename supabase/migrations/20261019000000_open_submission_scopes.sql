-- EDIT CONFLICT CHECK (v1.1)
--
-- The editor's Config > Actions compares the edits on screen with the page's
-- open submissions, so an editor can see that someone else is already changing
-- the same section before sending a second change to it. Owner, 2026-10-19.
--
-- A regular editor cannot read other people's pending_revisions: the "Staff
-- can view queue" policy is can_review_page(page_id). This function answers
-- for them, and it answers only WHERE (the scope and key of every change),
-- WHO (the author's public display name) and WHEN. Never the content: no
-- delta_payload, desc_data, frame_data, qa_metadata or ticket_chat leaves it.
--
-- One row per change. A batched submission ('multi') is one row per delta in
-- it. A legacy whole-page upload (is_delta false) is one row with a NULL scope,
-- which the editor reads as "the whole page". Scopes are returned as stored,
-- so a character-state change keeps its 'mode' wrapping, the same vocabulary
-- the editor's own scan produces.
--
-- The name is get_public_profile()'s, which ends at 'Anonymous' and never at
-- the email prefix the submitting browser may have used for author_name.

CREATE OR REPLACE FUNCTION "public"."get_open_submission_scopes"("p_page_id" "text")
RETURNS TABLE (
    "revision_id" uuid,
    "author_name" text,
    "created_at" timestamptz,
    "is_mine" boolean,
    "scope" text,
    "key" text
)
LANGUAGE "plpgsql" STABLE SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
#variable_conflict use_column
BEGIN
    -- Caller check first, before anything is read. Signed in, and not
    -- soft-banned: a viewer cannot submit, so has nothing to check. IS NOT
    -- DISTINCT FROM, never =: get_my_role() is NULL for an ordinary
    -- contributor, and NULL = 'viewer' would let the ban through.
    IF "auth"."uid"() IS NULL THEN
        RAISE EXCEPTION 'Permission denied: sign in to check for conflicting edits.'
            USING ERRCODE = '42501';
    END IF;
    IF "public"."get_my_role"() IS NOT DISTINCT FROM 'viewer' THEN
        RAISE EXCEPTION 'Permission denied: your account cannot submit edits.'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        r."id",
        (SELECT gp."display_name" FROM "public"."get_public_profile"(r."author_id") gp),
        r."created_at",
        r."author_id" = "auth"."uid"(),
        d."scope",
        d."key"
    FROM "public"."pending_revisions" r
    CROSS JOIN LATERAL (
        SELECT e->>'scope' AS "scope", e->>'key' AS "key"
        FROM jsonb_array_elements(
            CASE WHEN r."is_delta" AND r."target_scope" = 'multi' AND jsonb_typeof(r."delta_payload") = 'array'
                 THEN r."delta_payload" ELSE '[]'::jsonb END) e
        WHERE jsonb_typeof(e) = 'object'
        UNION ALL
        SELECT r."target_scope", r."target_key"
        WHERE r."is_delta" AND r."target_scope" IS DISTINCT FROM 'multi'
        UNION ALL
        SELECT NULL::text, NULL::text
        WHERE NOT COALESCE(r."is_delta", false)
    ) d
    WHERE r."page_id" = "p_page_id"
      AND r."status" IN ('pending', 'ticket_open')
    ORDER BY r."created_at";
END;
$$;

ALTER FUNCTION "public"."get_open_submission_scopes"("text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."get_open_submission_scopes"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."get_open_submission_scopes"("text") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."get_open_submission_scopes"("text") TO "authenticated";
