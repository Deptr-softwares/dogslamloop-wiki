-- Two things, both about tier list assignments.
--
-- =========================================================================
-- 1. A regression 20260904000001 introduced in assign_tier_list
-- =========================================================================
-- Making user_roles.role nullable changed what `existing_role IS NULL` means.
-- It used to imply "this person has no row at all", because role was NOT NULL
-- and half the primary key. It now also matches a roleless capability holder -
-- somebody with a row carrying can_moderate and no role.
--
-- assign_tier_list reads exactly that:
--
--     SELECT role INTO existing_role FROM public.user_roles WHERE user_id = target_id;
--     IF existing_role IS NULL THEN
--         INSERT INTO public.user_roles (user_id, role)
--         VALUES (target_id, 'trusted_editor')
--         ON CONFLICT (user_id) DO NOTHING;
--         granted := true;
--
-- For a roleless capability holder the row already exists, so DO NOTHING did
-- nothing - and `granted := true` then reported "Granted trusted_editor." to
-- the owner regardless. No error, no role, and a message saying otherwise.
--
-- DO NOTHING becomes DO UPDATE, and `granted` is taken from FOUND rather than
-- assumed. The WHERE on the update is not decoration: between the SELECT above
-- and this statement somebody could have been given a real role, and an
-- unconditional DO UPDATE would quietly demote them to trusted_editor. With
-- the guard that update affects nothing, FOUND is false, and the message says
-- so.
--
-- This is the swept version of a search for readers that assumed NULL meant
-- "no row". `existing_role` was the only one: the two count(*) sites filter on
-- role = 'admin', which a NULL row does not match, and every other IS NULL test
-- against user_roles is on target_user_id - "no such account" - which is
-- unaffected.
--
-- Body otherwise carried verbatim from 20260827000003_owner_role.sql.

CREATE OR REPLACE FUNCTION "public"."assign_tier_list"(
    "p_email" text,
    "p_slug" text,
    "p_blurb" text DEFAULT NULL
) RETURNS text
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    target_id uuid;
    target_meta jsonb;
    target_email text;
    display_name text;
    existing_role text;
    granted boolean := false;
BEGIN
    IF NOT "public"."is_owner"() THEN
        RAISE EXCEPTION 'Permission denied: only the owner may assign a tier list.'
            USING ERRCODE = '42501';
    END IF;

    IF COALESCE(btrim("p_slug"), '') = '' THEN
        RAISE EXCEPTION 'A slug is required - it is the ?list= link.' USING ERRCODE = '22023';
    END IF;

    SELECT id, email, raw_user_meta_data INTO target_id, target_email, target_meta
      FROM auth.users WHERE email = "p_email";

    IF target_id IS NULL THEN
        RAISE EXCEPTION 'No account found for %', "p_email" USING ERRCODE = 'P0002';
    END IF;

    SELECT role INTO existing_role FROM public.user_roles WHERE user_id = target_id;

    IF existing_role = 'viewer' THEN
        RAISE EXCEPTION '% is a viewer - the soft ban. Lift that in the roster first if this is deliberate.', "p_email"
            USING ERRCODE = '22023';
    END IF;

    -- Granted only if they hold no ROLE - which since 20260904000001 is not the
    -- same as holding no ROW. UNIQUE(user_id) still means this touches one row
    -- and can never become a second.
    IF existing_role IS NULL THEN
        INSERT INTO public.user_roles (user_id, role)
        VALUES (target_id, 'trusted_editor')
        ON CONFLICT ("user_id") DO UPDATE
            SET "role" = 'trusted_editor'
            WHERE "user_roles"."role" IS NULL;
        granted := FOUND;
    END IF;

    display_name := COALESCE(
        NULLIF(target_meta->>'display_name', ''),
        NULLIF(target_meta->>'full_name', ''),
        NULLIF(target_meta->'custom_claims'->>'global_name', ''),
        NULLIF(target_meta->>'user_name', ''),
        NULLIF(split_part(COALESCE(target_email, ''), '@', 1), ''),
        'Unknown'
    );

    INSERT INTO public.tier_lists (slug, owner_id, author_name, blurb, status)
    VALUES (btrim("p_slug"), target_id, display_name,
            NULLIF(btrim(COALESCE("p_blurb", '')), ''), 'published');

    RETURN format('%s now has a tier list at ?list=%s.%s',
        display_name, btrim("p_slug"),
        CASE WHEN granted THEN ' Granted trusted_editor.' ELSE '' END);
END;
$$;

ALTER FUNCTION "public"."assign_tier_list"(text, text, text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."assign_tier_list"(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."assign_tier_list"(text, text, text) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."assign_tier_list"(text, text, text) TO "authenticated";

-- =========================================================================
-- 2. Taking a tier list back
-- =========================================================================
-- Owner: "There is no way to remove a certified tier list contributor once
-- creating them." assign_tier_list had no counterpart, so an assignment was
-- one-way.
--
-- This ARCHIVES rather than deletes, and that is a deliberate refusal of the
-- literal request. 'archived' already exists in tier_lists_status_check, and
-- the public read policy is `status = 'published'` - so archiving takes the
-- list off the site completely, which is the part the owner actually wants.
--
-- Deleting would take more than the assignment. tier_list_changes references
-- tier_lists ON DELETE CASCADE, so the list's entire change history - every
-- note explaining every move - goes with it, and none of that is recoverable.
-- A reversible action that achieves the visible outcome is better than an
-- irreversible one that achieves the same visible outcome.
--
-- Status is a parameter rather than hardcoded to 'archived' so the same
-- function puts a list back. A whitelist, not free text: the CHECK constraint
-- would catch a bad value anyway, but a constraint violation reaching the owner
-- as raw PostgREST text is not an error message.
--
-- The trusted_editor role assign_tier_list may have granted is deliberately NOT
-- revoked here. It is a separate decision, the roster is where roles are
-- managed, and silently demoting somebody as a side effect of unpublishing a
-- page is the kind of surprise this project has been bitten by before.

CREATE OR REPLACE FUNCTION "public"."set_tier_list_status"(
    "p_slug" text,
    "p_status" text
) RETURNS text
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    target_name text;
BEGIN
    IF NOT "public"."is_owner"() THEN
        RAISE EXCEPTION 'Permission denied: only the owner may change a tier list''s status.'
            USING ERRCODE = '42501';
    END IF;

    IF "p_status" IS DISTINCT FROM 'draft'
       AND "p_status" IS DISTINCT FROM 'published'
       AND "p_status" IS DISTINCT FROM 'archived' THEN
        RAISE EXCEPTION 'Unknown status: %. Use draft, published or archived.', "p_status"
            USING ERRCODE = '22023';
    END IF;

    UPDATE "public"."tier_lists"
       SET "status" = "p_status",
           "updated_at" = now()
     WHERE "slug" = btrim("p_slug")
    RETURNING "author_name" INTO target_name;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No tier list at ?list=%', btrim("p_slug") USING ERRCODE = 'P0002';
    END IF;

    RETURN format('%s''s list at ?list=%s is now %s.', target_name, btrim("p_slug"), "p_status");
END;
$$;

ALTER FUNCTION "public"."set_tier_list_status"(text, text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."set_tier_list_status"(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."set_tier_list_status"(text, text) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."set_tier_list_status"(text, text) TO "authenticated";
