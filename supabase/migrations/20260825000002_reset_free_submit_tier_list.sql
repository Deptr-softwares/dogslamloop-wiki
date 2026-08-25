-- v0.16 feature 4: reset the Free Submit Tier List.
--
-- A game update changes the balance and the community's ranking is suddenly a
-- record of a version nobody plays. The owner needs to clear it and let the
-- ranking rebuild against the new patch.
--
-- WHY AN RPC RATHER THAN A DELETE FROM THE CLIENT. free_submit_votes has no
-- DELETE grant for anyone but the voter deleting their own row ("Voters
-- withdraw their own votes"), and it should stay that way: a blanket admin
-- DELETE policy on that table would be a standing capability, reachable from
-- any session with an admin token, protecting nothing. A single function that
-- checks the caller and does one specific thing is narrower.
--
-- IT IS DESTRUCTIVE AND IRREVERSIBLE. The votes are the raw material of the
-- median - there is no aggregate to recompute them from - so this returns a
-- count and the UI puts it behind the site's own confirm modal rather than a
-- browser confirm(). See js/owner-tier-lists.js.

CREATE OR REPLACE FUNCTION "public"."reset_free_submit_tier_list"()
RETURNS "text"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    caller_role text;
    removed integer := 0;
BEGIN
    -- The caller check comes FIRST, before anything is read or written, and it
    -- is inside the function rather than left to the grant. auth.uid() resolves
    -- to the caller inside a SECURITY DEFINER function, which is what makes
    -- this work; the owner-tools page being RBAC-gated is a client-side
    -- courtesy that is bypassed by hitting the REST endpoint directly.
    --
    -- IS DISTINCT FROM, not <>: get_my_role() returns NULL for a signed-in user
    -- with no role, and `NULL <> 'admin'` is NULL rather than true - so the
    -- obvious operator would let every roleless account through this gate.
    caller_role := "public"."get_my_role"();
    IF caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Permission denied: only an admin may reset the Free Submit Tier List.'
            USING ERRCODE = '42501';
    END IF;

    -- Deliberately NOT a TRUNCATE. DELETE is MVCC-safe alongside a concurrent
    -- submit_tier_votes call, respects the row count below, and does not need
    -- the table-level lock TRUNCATE takes - which on this table would block
    -- every voter mid-ballot.
    WITH gone AS (
        DELETE FROM "public"."free_submit_votes" RETURNING 1
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

-- Creating a function grants EXECUTE to PUBLIC. This project has already had
-- one unauthenticated privilege escalation from exactly that default, so the
-- revoke is not optional and anon is named explicitly as well as PUBLIC.
REVOKE ALL ON FUNCTION "public"."reset_free_submit_tier_list"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."reset_free_submit_tier_list"() FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."reset_free_submit_tier_list"() TO "authenticated";

COMMENT ON FUNCTION "public"."reset_free_submit_tier_list"() IS
    'Admin-only. Deletes every free_submit_votes row so the community ranking can rebuild against a new game patch. Leaves free_submit_tiers, which is the scale rather than the data.';
