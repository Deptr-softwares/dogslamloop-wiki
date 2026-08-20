-- Trigger functions are not RPCs. Stop exposing them as ones.
--
-- THE FINDING
--
-- Supabase's database linter (0028 / 0029) reported that five functions in the
-- `public` schema are callable over PostgREST as SECURITY DEFINER functions,
-- by `anon` as well as by `authenticated`:
--
--   archive_page_version()          page_data  -> page_history snapshots
--   enforce_discussion_shape()      shape guard on discussion posts
--   notify_discussion_reply()       notification fan-out
--   check_discussion_rate_limit()   rate limit on discussion posts
--   check_revision_rate_limit()     rate limit on submissions
--
-- Every one of them is a TRIGGER function. None is called by the site, and
-- none is meant to be reachable at /rest/v1/rpc/. They are exposed only
-- because Postgres grants EXECUTE to PUBLIC on every function at creation -
-- the same default that produced the 2026-08-07 privilege escalation, in its
-- harmless form rather than its dangerous one.
--
-- WHAT THIS IS AND IS NOT
--
-- Not a vulnerability. Calling a trigger function directly raises
-- `trigger functions can only be called as triggers` (0A000) before a single
-- statement of the body runs, so there was nothing to exploit. What it was is
-- a lie in the API surface: five entries in the exposed schema that no caller
-- should ever find, and five warnings hiding the ones that might matter.
--
-- This also corrects a comment in 20260818000001_page_history_null_columns.sql
-- which claimed "PostgREST cannot reach it". PostgREST can reach it. The call
-- fails, which is a different thing, and the distinction is worth keeping
-- straight because it is the reason this needed a migration rather than a
-- shrug.
--
-- WHY THE TRIGGERS KEEP WORKING
--
-- A trigger executes its function as part of the statement that fired it, not
-- as an RPC, and the EXECUTE privilege is not consulted on that path. Revoking
-- here removes the REST entry point and changes nothing about the triggers
-- themselves, which is why this is safe to apply without touching a single
-- CREATE TRIGGER.
--
-- WHAT THIS DELIBERATELY DOES NOT TOUCH
--
-- The linter raised 31 warnings. 26 of them are the project's architecture
-- working as designed, and acting on them would break the site:
--
--   * The ~20 lint-0029 warnings on admin RPCs (assign_role_by_email,
--     set_user_capability, save_tier_list, list_personnel, ...) are false
--     positives. Those are SUPPOSED to be callable by `authenticated`; the
--     authorisation is a caller check INSIDE the function that raises 42501,
--     which the linter cannot see. Revoking EXECUTE would delete the owner
--     tools, the review queue and the tier list editor.
--
--   * get_my_role(), can_moderate() and can_delete_media() are called from
--     RLS POLICY expressions, which are evaluated as the querying role. Two
--     policies on pending_revisions carry no `TO authenticated` clause, so
--     they are evaluated for `anon` too. Revoking EXECUTE from anon would not
--     deny those rows - it would raise `permission denied for function
--     get_my_role` instead of returning nothing.
--
--   * free_submit_eligibility() and get_free_submit_rankings() are called by
--     the anonymous Free Submit Tier List tool. anon EXECUTE is the feature.
--
-- The remaining two are not SQL: leaked-password protection is a dashboard
-- toggle, and the wiki-media listing policy is the Media Library's, which the
-- editor needs. Owner's call, 2026-08-19: leave the bucket alone.

REVOKE ALL ON FUNCTION "public"."archive_page_version"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."archive_page_version"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."archive_page_version"() FROM "authenticated";

REVOKE ALL ON FUNCTION "public"."enforce_discussion_shape"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."enforce_discussion_shape"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."enforce_discussion_shape"() FROM "authenticated";

REVOKE ALL ON FUNCTION "public"."notify_discussion_reply"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."notify_discussion_reply"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."notify_discussion_reply"() FROM "authenticated";

-- Not flagged by the linter, and included anyway: same category, same default
-- grant, and leaving two of five behind would make the next audit read as a
-- regression rather than as the two that were always fine.
REVOKE ALL ON FUNCTION "public"."check_discussion_rate_limit"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."check_discussion_rate_limit"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."check_discussion_rate_limit"() FROM "authenticated";

REVOKE ALL ON FUNCTION "public"."check_revision_rate_limit"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."check_revision_rate_limit"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."check_revision_rate_limit"() FROM "authenticated";
