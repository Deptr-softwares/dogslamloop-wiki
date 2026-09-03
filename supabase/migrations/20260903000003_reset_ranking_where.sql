-- v0.17 fix: Reset Ranking failed with "DELETE requires a WHERE clause".
--
-- THE BUG
--
-- reset_free_submit_tier_list() deletes every vote, so it was written as an
-- unqualified DELETE:
--
--     WITH gone AS (DELETE FROM public.free_submit_votes RETURNING 1)
--
-- Supabase runs with a safe-update guard that rejects an UPDATE or DELETE
-- carrying no WHERE clause, so the statement never executed and the owner got
-- the guard's message back through the tool. It is not a permission problem:
-- the caller check above it passed, which is why the error is about SQL rather
-- than about access.
--
-- Nothing about the intent changes. `WHERE true` is the same set of rows the
-- unqualified form meant; it just says so in a way the guard can see.
--
-- THIS IS A NEW MIGRATION, NOT AN EDIT
--
-- 20260825000002 created this function and 20260827000003 re-created it with
-- the owner guard. Both are pushed, and a preview branch records each migration
-- by version and will not run that version again - editing either would be
-- verified by nothing and would leave production exactly as it is now.
--
-- The body below is carried from 20260827000003 (the current definition) with
-- the WHERE added. The is_owner() guard is kept: after the v0.17 split, only
-- the owner reaches the tool this belongs to.

CREATE OR REPLACE FUNCTION "public"."reset_free_submit_tier_list"()
RETURNS "text"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    removed integer := 0;
BEGIN
    -- The caller check comes FIRST, before anything is read or written, and it
    -- is inside the function rather than left to the grant. The owner-tools
    -- page being RBAC-gated is a client-side courtesy that is bypassed by
    -- hitting the REST endpoint directly.
    IF NOT "public"."is_owner"() THEN
        RAISE EXCEPTION 'Permission denied: only the owner may reset the Free Submit Tier List.'
            USING ERRCODE = '42501';
    END IF;

    -- Deliberately NOT a TRUNCATE. DELETE is MVCC-safe alongside a concurrent
    -- submit_tier_votes call, respects the row count below, and does not need
    -- the table-level lock TRUNCATE takes - which on this table would block
    -- every voter mid-ballot.
    --
    -- WHERE true is the whole fix. It selects exactly the rows the unqualified
    -- DELETE meant, and satisfies the safe-update guard that was refusing to
    -- run the statement at all.
    WITH gone AS (
        DELETE FROM "public"."free_submit_votes" WHERE true RETURNING 1
    )
    SELECT count(*) INTO removed FROM gone;

    -- free_submit_tiers is the SCALE, not the data: the six tiers and their
    -- colours are configuration the ranking is expressed in. Clearing it would
    -- leave the page with nothing to sort by and nothing to render, and it is
    -- not what "reset the list" means.

    RETURN format('Cleared %s vote%s from the Free Submit Tier List.',
                  removed, CASE WHEN removed = 1 THEN '' ELSE 's' END);
END;
$$;

ALTER FUNCTION "public"."reset_free_submit_tier_list"() OWNER TO "postgres";

-- CREATE OR REPLACE keeps the existing ACL, so these are a restatement rather
-- than a change - and they are here because a future DROP+CREATE would reset
-- the grant to PUBLIC, which is how the 2026-08-07 escalation happened.
REVOKE ALL ON FUNCTION "public"."reset_free_submit_tier_list"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."reset_free_submit_tier_list"() FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."reset_free_submit_tier_list"() TO "authenticated";
