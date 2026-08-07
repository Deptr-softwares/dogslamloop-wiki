-- SECURITY FIX: privilege escalation through assign_role_by_email().
--
-- The function is SECURITY DEFINER (it executes with the database owner's
-- rights, because it has to read auth.users and write user_roles) but it has
-- never checked WHO is calling it. Postgres grants EXECUTE on a new function
-- to PUBLIC by default, and no migration ever revoked that - so the grant
-- reached `anon`, and the anon key is public by design (it ships in
-- js/site_utils.js and is therefore in the page source of every page).
--
-- Confirmed exploitable against production before this fix: an unauthenticated
-- POST to /rest/v1/rpc/assign_role_by_email returned HTTP 200 and the
-- function's own "user not found" string. Anyone who knew or guessed an
-- account's email could set any role on it - granting themselves 'admin'
-- (which carries full moderation access, owner tools, and direct page_data
-- writes via the "Admin Write Live Data" policy), or revoking the owner's own
-- admin row to lock them out of their own site.
--
-- Present since the original schema (20260727000000_remote_schema.sql:58).
-- The v0.6 rewrite (20260801000000_role_model_fix.sql:92) changed the body
-- from a toggle to a set-operation but carried the missing guard forward.
--
-- The other SECURITY DEFINER functions were checked and are not exposed:
-- get_my_role() only ever returns the caller's own role, and
-- archive_page_version / check_revision_rate_limit / rls_auto_enable are
-- triggers rather than client-callable RPCs.
--
-- Fixed in depth, so that no single mistake re-opens it:
--   1. Revoke the inherited PUBLIC/anon grant - closes the actual hole.
--   2. Check the caller's role inside the function - makes a future stray
--      GRANT non-fatal, and stops an authenticated non-admin (a contributor)
--      from escalating even though they can reach the function.
--   3. Pin search_path, which every other SECURITY DEFINER function here
--      already does and this one never did.

-- 1. Close the inherited grant. PUBLIC is where the default came from; anon
--    and authenticated are named explicitly so this is not sensitive to how
--    role membership resolves.
REVOKE ALL ON FUNCTION "public"."assign_role_by_email"("text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."assign_role_by_email"("text", "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."assign_role_by_email"("text", "text") FROM "authenticated";

-- 2 + 3. Same body as before plus the caller check and a pinned search_path.
--
-- auth.uid() resolves to the CALLER inside a SECURITY DEFINER function - it
-- reads the request's JWT claims, not the definer's identity - so
-- get_my_role() here identifies whoever invoked the RPC. That is the same
-- mechanism every existing RLS policy in this schema already depends on.
CREATE OR REPLACE FUNCTION "public"."assign_role_by_email"("target_email" "text", "assigned_role" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    target_user_id UUID;
BEGIN
    IF "public"."get_my_role"() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Permission denied: only an admin can assign roles.'
            USING ERRCODE = '42501';
    END IF;

    SELECT id INTO target_user_id FROM auth.users WHERE email = target_email;

    IF target_user_id IS NULL THEN
        RETURN 'Error: User with this email not found.';
    END IF;

    DELETE FROM public.user_roles WHERE user_id = target_user_id;

    IF assigned_role IS NULL THEN
        RETURN 'Successfully REVOKED all roles from ' || target_email;
    END IF;

    INSERT INTO public.user_roles (user_id, role) VALUES (target_user_id, assigned_role);

    RETURN 'Successfully SET the role of ' || target_email || ' to ' || upper(assigned_role);
END;
$$;

ALTER FUNCTION "public"."assign_role_by_email"("text", "text") OWNER TO "postgres";

-- CREATE OR REPLACE does not reset privileges, but the REVOKEs above ran
-- against the pre-existing function - so grant the one role that legitimately
-- needs this explicitly, rather than leaving it to be inherited again.
-- owner.html is admin-gated in the client and the function is admin-gated in
-- the database; a non-admin authenticated caller now fails the check above.
GRANT EXECUTE ON FUNCTION "public"."assign_role_by_email"("text", "text") TO "authenticated";
