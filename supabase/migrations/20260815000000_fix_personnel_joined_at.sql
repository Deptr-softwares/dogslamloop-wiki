-- list_personnel() has been raising 42703 at every call since v0.13.
--
-- It selects and orders by `ur.created_at` on public.user_roles, and that
-- column does not exist. The table is (user_id, role) plus the capability
-- flags v0.13 added, and it has never carried a timestamp.
--
-- WHY IT SHIPPED THREE TIMES WITHOUT ANYBODY NOTICING. A PL/pgSQL function
-- body is not checked against the schema when the function is created - it is
-- parsed, but column references are resolved at RUN time. So all three
-- migrations that defined this function applied cleanly and the failure waited
-- inside the function for an admin to open the personnel roster.
--
-- The same mistake in a DO block behaves completely differently: a DO block
-- executes during the migration, so when 20260813000005 wrote the same
-- `ur.created_at` it failed immediately, rolled back, and took the four
-- migrations after it down with it. That is what stopped half of v0.14
-- reaching production - and it is also what proved the column is genuinely
-- absent rather than merely undocumented.
--
-- Found by tests/migration-columns.spec.js, which reads the schema out of this
-- directory and checks aliased column references against it. That check exists
-- because of this bug.
--
-- THE FIX. The return column is named `joined_at` and means "when this person
-- joined", so auth.users.created_at is what it always wanted: when the role
-- was assigned is recorded nowhere, but when the account was made is. Same
-- type, same signature - CREATE OR REPLACE is legal and keeps the grants.

CREATE OR REPLACE FUNCTION "public"."list_personnel"()
RETURNS TABLE (
    "user_id" uuid,
    "email" text,
    "role" text,
    "joined_at" timestamptz,
    "bypass_cooldown" boolean,
    "can_moderate" boolean,
    "can_delete_media" boolean
)
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF "public"."get_my_role"() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Permission denied: only an administrator may list personnel.'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT ur.user_id, u.email::text, ur.role, u.created_at,
           ur.bypass_cooldown, ur.can_moderate, ur.can_delete_media
    FROM "public"."user_roles" ur
    JOIN "auth"."users" u ON u.id = ur.user_id
    ORDER BY u.created_at;
END;
$$;

ALTER FUNCTION "public"."list_personnel"() OWNER TO "postgres";
-- Restated rather than relied on. CREATE OR REPLACE preserves the existing
-- ACL, but this project has been bitten by a function that was reachable by
-- everyone because nobody said otherwise.
REVOKE ALL ON FUNCTION "public"."list_personnel"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."list_personnel"() FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."list_personnel"() TO "authenticated";
