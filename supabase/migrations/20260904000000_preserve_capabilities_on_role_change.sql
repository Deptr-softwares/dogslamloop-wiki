-- Changing somebody's role silently wiped every capability they had.
--
-- assign_role_by_email has always been DELETE-then-INSERT:
--
--     DELETE FROM public.user_roles WHERE user_id = target_user_id;
--     INSERT INTO public.user_roles (user_id, role) VALUES (target_user_id, assigned_role);
--
-- That INSERT names two columns. bypass_cooldown, can_moderate and
-- can_delete_media are not among them, so they came back as their column
-- defaults - FALSE - every single time a role was applied. The owner reported
-- it from the other end: tick a capability box, press APPLY, and the Supabase
-- table still reads FALSE for all three.
--
-- Nothing errored, which is why it survived this long. set_user_capability
-- wrote TRUE correctly; APPLY threw the row away afterwards and built a fresh
-- one. Two tools that each worked, in an order that lost data.
--
-- The delete now happens only on the revoke path, where discarding the row IS
-- the intent - revoking all access should take the capabilities with it.
-- Assigning a role upserts, so it touches the role column and nothing else.
--
-- ON CONFLICT ("user_id") targets user_roles_one_role_per_user
-- (20260801000000), not the (user_id, role) primary key. That matters: the PK
-- would not conflict at all on a role CHANGE, so the row would insert and
-- violate the unique constraint instead. The unique constraint is the one that
-- makes "same person, different role" an update.
--
-- Body otherwise carried verbatim from 20260827000003_owner_role.sql. The
-- guard, the search_path and the grants are restated rather than relied on:
-- CREATE OR REPLACE preserves the existing ACL, but this project has been
-- bitten by a function that was reachable by everyone because nobody said so.

CREATE OR REPLACE FUNCTION "public"."assign_role_by_email"("target_email" "text", "assigned_role" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    target_user_id UUID;
BEGIN
    IF NOT "public"."is_owner"() THEN
        RAISE EXCEPTION 'Permission denied: only the owner may assign roles.'
            USING ERRCODE = '42501';
    END IF;

    SELECT id INTO target_user_id FROM auth.users WHERE email = target_email;

    IF target_user_id IS NULL THEN
        RETURN 'Error: User with this email not found.';
    END IF;

    -- Revoking is the one case where the row should go. Capabilities are
    -- extras on top of a role; with no role there is nothing to extend, and
    -- leaving them behind would silently re-arm the moment a role came back.
    IF assigned_role IS NULL THEN
        DELETE FROM public.user_roles WHERE user_id = target_user_id;
        RETURN 'Successfully REVOKED all roles from ' || target_email;
    END IF;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (target_user_id, assigned_role)
    ON CONFLICT ("user_id") DO UPDATE
        SET "role" = EXCLUDED."role";

    RETURN 'Successfully SET the role of ' || target_email || ' to ' || upper(assigned_role);
END;
$$;

ALTER FUNCTION "public"."assign_role_by_email"("text", "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."assign_role_by_email"("text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."assign_role_by_email"("text", "text") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."assign_role_by_email"("text", "text") TO "authenticated";
