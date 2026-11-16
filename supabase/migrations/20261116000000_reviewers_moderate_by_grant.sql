-- ==========================================================================
-- Reviewers moderate discussions by grant, not by role
-- ==========================================================================
--
-- The owner's card (v1.2): "Remove Reviewer default permission to moderate
-- discussion". Until now can_moderate() was is_staff() OR the per-user flag,
-- so every reviewer could hide, remove and restore posts and read the reports
-- queue the day they were made a reviewer. Reviewing page edits and
-- moderating people are different jobs, and the owner wants to hand out the
-- second one person at a time.
--
-- From here: admin and above by role, everyone else by the flag the owner
-- ticks in owner tools ("Moderate discussions").
--
-- Everything that moderates already asks can_moderate() and nothing else
-- (the post and thread policies, moderate_discussion_post, the forum's
-- moderation, the reports queue and its two RPCs), so this one function is
-- the whole change on this side.


-- --------------------------------------------------------------------------
-- 1. THE REVIEWERS OF TODAY KEEP IT
-- --------------------------------------------------------------------------
-- The owner's pick (2026-11-16): "Keep it, I untick later". Nobody loses
-- moderation on the day this lands, and the reports queue stays staffed. A
-- reviewer made after today starts without it.
--
-- Run before the function changes, though inside one migration the order is
-- invisible to anyone outside it.
--
-- The rung is named through role_rank() so it follows the ladder. The update
-- fires discord_role_on_role_change for each row it changes, which is
-- intended: the relay gives the Discord role that goes with the tick.
UPDATE "public"."user_roles"
SET "can_moderate" = true
WHERE "public"."role_rank"("role") = "public"."role_rank"('reviewer')
  AND "can_moderate" IS DISTINCT FROM true;


-- --------------------------------------------------------------------------
-- 2. can_moderate(): admin and above, or the flag
-- --------------------------------------------------------------------------
-- role_rank() maps NULL (signed in, no role) and anon to 0, so the first half
-- is never NULL, and the COALESCE keeps the second half from being NULL for
-- somebody with no row. The whole answer is therefore always true or false,
-- which matters because the callers are `IF NOT can_moderate() THEN RAISE`.
--
-- Still SECURITY DEFINER: it reads user_roles for the flag, which RLS
-- protects, and anon calls it through the post policies.
CREATE OR REPLACE FUNCTION "public"."can_moderate"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    SELECT "public"."role_rank"("public"."get_my_role"()) >= "public"."role_rank"('admin')
        OR COALESCE(
            (SELECT ur.can_moderate FROM public.user_roles ur
             WHERE ur.user_id = auth.uid()),
            false
        );
$$;

-- Restated in the migration that defines it, as every callable function is.
REVOKE ALL ON FUNCTION "public"."can_moderate"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."can_moderate"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."can_moderate"() TO "authenticated";

COMMENT ON COLUMN "public"."user_roles"."can_moderate" IS
    'Lets this person moderate discussions and read the reports queue. Admins and the owner have it by role; everyone else, reviewers included, only by this flag.';
