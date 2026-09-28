-- Hotfix: is_owner() answered NULL, not false, for an account with no role.
--
-- 20260827000003 defined it as
--
--     SELECT "public"."get_my_role"() = 'owner';
--
-- get_my_role() returns NULL for a signed-in account with no role, and
-- `NULL = 'owner'` is NULL. Every owner tool guards itself with
--
--     IF NOT "public"."is_owner"() THEN RAISE EXCEPTION ... 42501
--
-- and `NOT NULL` is NULL, which IF treats as false: the RAISE is skipped and
-- the function carries on. So every signed-in account WITHOUT a role passed
-- every owner check, twenty call sites, assign_role_by_email among them. An
-- account holding any role, even viewer, was refused correctly, which is why
-- every probe run by a staff account saw the guard work.
--
-- Found 2026-09-28 on the v0.20 batch 3 preview branch: the seeded roleless
-- account called assign_role_by_email on itself and became owner.
--
-- This is the rule CLAUDE.md states for get_my_role(), broken in the helper
-- written to spare every call site from remembering it. COALESCE makes the
-- helper NULL-safe, which repairs all twenty sites at once. Same shape as
-- can_delete_media() and can_upload_media(), which were always wrapped.
--
-- Version 20260927000000 so it sorts BEFORE 20260928000000 on next-update:
-- this reaches main first, and a later migration with a lower version would
-- be out of order when the release applies it.

CREATE OR REPLACE FUNCTION "public"."is_owner"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
    SELECT COALESCE("public"."get_my_role"() = 'owner', false);
$$;

REVOKE ALL ON FUNCTION "public"."is_owner"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."is_owner"() FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."is_owner"() TO "authenticated";

COMMENT ON FUNCTION "public"."is_owner"() IS
    'The site owner, and nobody else. Never NULL: an account with no role is false, because every caller writes IF NOT is_owner() and NOT NULL skips the RAISE.';
