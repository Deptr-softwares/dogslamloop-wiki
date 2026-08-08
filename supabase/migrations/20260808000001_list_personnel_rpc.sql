-- v0.10: list_personnel() - the roster query behind owner.html's personnel
-- tool.
--
-- Until now the only way to manage roles was assign_role_by_email(), a blind
-- setter: you had to already know someone's email, and there was no way to
-- see who currently holds what. That is not an oversight in the UI, it is a
-- hard limit of what any client can read:
--   * user_roles' only SELECT policy is "Users can read own role"
--     (auth.uid() = user_id), so a client sees exactly one row - its own.
--   * There is no profiles table anywhere in this schema.
--   * auth.users is not reachable through PostgREST.
-- So enumerating personnel is impossible without a SECURITY DEFINER function.
-- This is that function, and nothing more: it reads, it never writes.
--
-- Follows the checklist established by the 2026-08-07 privilege-escalation
-- fix (20260807000001_secure_assign_role_by_email.sql), because this function
-- has exactly the shape that made that one dangerous - definer rights over
-- auth.users:
--   1. Caller check FIRST, before touching anything.
--   2. Revoke the inherited PUBLIC/anon EXECUTE grant.
--   3. Pin search_path.
--   4. Grant EXECUTE explicitly to the one role that needs it.

CREATE OR REPLACE FUNCTION "public"."list_personnel"()
RETURNS TABLE (
    "user_id" uuid,
    "email" text,
    "role" text,
    "joined_at" timestamptz
)
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    -- Admin only, and checked before any data is read rather than relying on
    -- the EXECUTE grant alone. Postgres grants EXECUTE to PUBLIC by default,
    -- so a future migration that recreates this function without the REVOKE
    -- below would silently reopen it to anonymous callers - this check is
    -- what makes that survivable.
    IF "public"."get_my_role"() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Permission denied: only an admin can list personnel.'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        ur."user_id",
        au."email"::text,
        ur."role",
        au."created_at"
    FROM "public"."user_roles" ur
    JOIN "auth"."users" au ON au."id" = ur."user_id"
    ORDER BY
        -- Most privileged first, then alphabetically, so the roster reads the
        -- way someone thinks about it rather than in insertion order.
        CASE ur."role"
            WHEN 'admin' THEN 1
            WHEN 'reviewer' THEN 2
            WHEN 'trusted_editor' THEN 3
            WHEN 'contributor' THEN 4
            WHEN 'viewer' THEN 5
            ELSE 6
        END,
        au."email";
END;
$$;

ALTER FUNCTION "public"."list_personnel"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."list_personnel"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."list_personnel"() FROM "anon";

GRANT EXECUTE ON FUNCTION "public"."list_personnel"() TO "authenticated";
