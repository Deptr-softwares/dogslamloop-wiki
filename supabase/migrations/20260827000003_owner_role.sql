-- v0.17 F12, PASS 2 of 2: `owner` becomes a real role, and `admin` becomes a
-- rank beneath it.
--
--   owner 5 · admin 4 · reviewer 3 · trusted_editor 2 · viewer 1 · (none) 0
--
-- Until now "admin" meant the site owner - CLAUDE.md said so outright: "There
-- is no owner role. The site owner is an admin." The owner is bringing on a
-- second staff member and wants the two separated (owner, 2026-08-26): the
-- owner keeps the owner tools; the new admin works the queue with the force
-- actions, self-approval, tickets, change requests and intercepts.
--
-- ADMIN GETS NO OWNER-TOOL ACCESS (owner, 2026-08-27): "The new admin should
-- not get the owner tool access at all (for now, I will decide if in the
-- future, I can allow admin to access some of the tools)." Hence is_owner()
-- rather than fourteen literals - "for now" is doing real work in that
-- sentence, and per-tool access later should be one edit.
--
-- PASS 1 (20260827000001) IS WHAT MAKES THIS SMALL. It rewrote every policy
-- that named a role into a rank comparison while `admin` still meant what it
-- always meant, so none of those eleven policies is touched here. Without it
-- this migration would have to edit 32 sites at once against a live database.
--
-- THIS MIGRATION DELIBERATELY CHANGES NOBODY'S ROLE. The owner is setting both
-- accounts from the Supabase dashboard, which uses the service role and
-- bypasses RLS (owner, 2026-08-27). Two consequences worth stating plainly:
--
--   1. The CHECK below has to land BEFORE 'owner' can be typed anywhere. The
--      dashboard will reject the value until this migration applies.
--   2. Between this applying and that edit, NOBODY holds 'owner', so every
--      owner tool is locked - including assign_role_by_email, which is how you
--      would normally fix it. The dashboard is the way back in, and it is the
--      route the owner chose knowing this.

-- --------------------------------------------------------------------------
-- The ladder gains a rung
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."role_rank"("role_name" "text")
RETURNS integer
LANGUAGE "sql"
IMMUTABLE
PARALLEL SAFE
SET "search_path" TO 'public'
AS $$
    SELECT CASE "role_name"
        WHEN 'owner'          THEN 5
        WHEN 'admin'          THEN 4
        WHEN 'reviewer'       THEN 3
        WHEN 'trusted_editor' THEN 2
        -- viewer is a soft ban, refused by its own clause rather than by rank.
        -- It sits at 1 rather than 0 only so that "has a role at all" and "has
        -- no role" stay distinguishable.
        WHEN 'viewer'         THEN 1
        ELSE 0
    END;
$$;

-- Restated because CREATE OR REPLACE keeps the ACL and the rule is that a
-- callable function states its own grants. anon is included: is_staff() calls
-- this from a policy every reader evaluates, which 20260827000002 fixed after
-- pass 1 got it wrong.
REVOKE ALL ON FUNCTION "public"."role_rank"("text") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."role_rank"("text") TO "anon";
GRANT EXECUTE ON FUNCTION "public"."role_rank"("text") TO "authenticated";

-- --------------------------------------------------------------------------
-- "Owner", once
-- --------------------------------------------------------------------------
--
-- An equality, not a rank test, and that is the point: nothing outranks the
-- owner, so `>= owner` and `= owner` are the same set today - but writing it as
-- a rank comparison would quietly admit anything added above 5 later.
--
-- Not granted to anon: no policy an anonymous reader evaluates calls it, and
-- every caller below is a SECURITY DEFINER function granted to authenticated.
CREATE OR REPLACE FUNCTION "public"."is_owner"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
    SELECT "public"."get_my_role"() = 'owner';
$$;

REVOKE ALL ON FUNCTION "public"."is_owner"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."is_owner"() FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."is_owner"() TO "authenticated";

COMMENT ON FUNCTION "public"."is_owner"() IS
    'The site owner, and nobody else. One definition, so opening a single owner tool to admins later is one edit rather than a fifteenth sweep.';

-- --------------------------------------------------------------------------
-- user_roles: 'owner' becomes a legal value
-- --------------------------------------------------------------------------
-- 'admin' stays legal - it is a real role from here on, not a retired one.
-- UNIQUE(user_id) is untouched: one role per user is still the rule, and it is
-- the constraint that stopped get_my_role() returning two rows.
ALTER TABLE "public"."user_roles" DROP CONSTRAINT IF EXISTS "user_roles_role_check";

ALTER TABLE "public"."user_roles"
    ADD CONSTRAINT "user_roles_role_check"
    CHECK (("role" = ANY (ARRAY['owner'::text, 'admin'::text, 'reviewer'::text, 'trusted_editor'::text, 'viewer'::text])));

-- assign_role_by_email needs no change to hand out 'owner' or 'admin': it has
-- no whitelist of its own and inserts what it is given, so this CHECK is the
-- only validation and it now permits both.

-- --------------------------------------------------------------------------
-- page_permissions: the three hub pages must NOT widen
-- --------------------------------------------------------------------------
--
-- Read off production 2026-08-26, before writing any of this:
--
--     template / tierlist / writing_guide     trusted_editor
--     main-hub / character-hub / systems-hub  admin
--
-- Those three say 'admin', which TODAY means the owner and nobody else. Leaving
-- them alone would silently hand all three hub pages to the new admin the
-- moment the role exists - a privilege widening nobody asked for and no test
-- would catch, because the row is data and the policy is correct either way.
--
-- The CHECK is widened FIRST and the rows updated SECOND. The other order fails
-- against its own constraint.
ALTER TABLE "public"."page_permissions" DROP CONSTRAINT IF EXISTS "page_permissions_required_role_check";

ALTER TABLE "public"."page_permissions"
    ADD CONSTRAINT "page_permissions_required_role_check"
    CHECK (("required_role" = ANY (ARRAY['trusted_editor'::text, 'admin'::text, 'owner'::text])));

-- 'admin' stays available as a required_role - restricting a page to admin and
-- above is now a meaningful thing to want. These three specifically meant
-- "owner" when they were written, so they say so.
UPDATE "public"."page_permissions"
   SET "required_role" = 'owner'
 WHERE "required_role" = 'admin';

-- --------------------------------------------------------------------------
-- The seven owner tools
-- --------------------------------------------------------------------------
--
-- Every one of these sits behind owner.html. Each guard moves from comparing
-- get_my_role() against the old role name to `NOT is_owner()`, and their
-- refusal messages stop saying "admin", which would otherwise be a lie the
-- moment a real admin reads one.
--
-- (The old comparison is deliberately NOT spelled out above. In v0.16 a
-- migration's own prose - "Deliberately NOT a TRUNCATE" - matched the regex a
-- test used to prove the statement was absent.)
--
-- assign_role_by_email
-- Body carried verbatim from 20260807000001_secure_assign_role_by_email.sql by script, not retyped; only the guard
-- and the word it uses for the caller differ. Grants restated because a
-- callable function revokes its free PUBLIC grant in the same migration.
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

    DELETE FROM public.user_roles WHERE user_id = target_user_id;

    IF assigned_role IS NULL THEN
        RETURN 'Successfully REVOKED all roles from ' || target_email;
    END IF;

    INSERT INTO public.user_roles (user_id, role) VALUES (target_user_id, assigned_role);

    RETURN 'Successfully SET the role of ' || target_email || ' to ' || upper(assigned_role);
END;
$$;

REVOKE ALL ON FUNCTION "public"."assign_role_by_email"("text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."assign_role_by_email"("text", "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."assign_role_by_email"("text", "text") FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."assign_role_by_email"("text", "text") TO "authenticated";

-- list_personnel
-- Body carried verbatim from 20260815000000_fix_personnel_joined_at.sql by script, not retyped; only the guard
-- and the word it uses for the caller differ. Grants restated because a
-- callable function revokes its free PUBLIC grant in the same migration.
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
    IF NOT "public"."is_owner"() THEN
        RAISE EXCEPTION 'Permission denied: only the owner may list personnel.'
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

REVOKE ALL ON FUNCTION "public"."list_personnel"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."list_personnel"() FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."list_personnel"() TO "authenticated";

-- anonymize_user_by_email
-- Body carried verbatim from 20260813000000_page_discussions.sql by script, not retyped; only the guard
-- and the word it uses for the caller differ. Grants restated because a
-- callable function revokes its free PUBLIC grant in the same migration.
CREATE OR REPLACE FUNCTION "public"."anonymize_user_by_email"("target_email" "text")
RETURNS "text"
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    target_user_id UUID;
    revisions_kept INT := 0;
    posts_kept INT := 0;
BEGIN
    IF NOT "public"."is_owner"() THEN
        RAISE EXCEPTION 'Permission denied: only the owner may anonymize an account.'
            USING ERRCODE = '42501';
    END IF;

    SELECT id INTO target_user_id FROM auth.users WHERE email = target_email;

    IF target_user_id IS NULL THEN
        RETURN 'Error: User with this email not found.';
    END IF;

    IF (SELECT role FROM public.user_roles WHERE user_id = target_user_id) = 'owner'
       AND (SELECT count(*) FROM public.user_roles WHERE role = 'owner') <= 1 THEN
        RAISE EXCEPTION 'Refusing to anonymize the only remaining admin.'
            USING ERRCODE = '42501';
    END IF;

    UPDATE public.pending_revisions
    SET author_id = NULL,
        author_name = 'Deleted user'
    WHERE author_id = target_user_id;

    GET DIAGNOSTICS revisions_kept = ROW_COUNT;

    -- Threads keep their posts, re-attributed, for the same reason revisions
    -- do: hard-deleting them would tear holes in conversations other people
    -- are still part of. author_id is nulled explicitly rather than left to
    -- ON DELETE SET NULL so the ordering is visible here.
    UPDATE public.page_discussions
    SET author_id = NULL,
        author_name = 'Deleted user'
    WHERE author_id = target_user_id;

    GET DIAGNOSTICS posts_kept = ROW_COUNT;

    DELETE FROM public.user_notifications WHERE user_id = target_user_id;

    UPDATE public.page_data
    SET last_editor_name = 'Deleted user'
    WHERE last_editor_name = (SELECT email FROM auth.users WHERE id = target_user_id);

    DELETE FROM public.user_roles WHERE user_id = target_user_id;

    DELETE FROM auth.users WHERE id = target_user_id;

    RETURN 'Anonymized ' || target_email || '. ' || revisions_kept ||
           ' revision(s) and ' || posts_kept ||
           ' post(s) kept and re-attributed to "Deleted user".';
END;
$$;

REVOKE ALL ON FUNCTION "public"."anonymize_user_by_email"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."anonymize_user_by_email"("text") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."anonymize_user_by_email"("text") TO "authenticated";

-- set_user_capability
-- Body carried verbatim from 20260813000003_media_deletion.sql by script, not retyped; only the guard
-- and the word it uses for the caller differ. Grants restated because a
-- callable function revokes its free PUBLIC grant in the same migration.
CREATE OR REPLACE FUNCTION "public"."set_user_capability"(
    "target_email" text,
    "capability" text,
    "enabled" boolean
) RETURNS text
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    target_id uuid;
BEGIN
    IF NOT "public"."is_owner"() THEN
        RAISE EXCEPTION 'Permission denied: only the owner may change capabilities.'
            USING ERRCODE = '42501';
    END IF;

    IF "capability" IS DISTINCT FROM 'bypass_cooldown'
       AND "capability" IS DISTINCT FROM 'can_moderate'
       AND "capability" IS DISTINCT FROM 'can_delete_media' THEN
        RAISE EXCEPTION 'Unknown capability: %', "capability" USING ERRCODE = '22023';
    END IF;

    SELECT id INTO target_id FROM "auth"."users" WHERE email = "target_email";
    IF target_id IS NULL THEN
        RAISE EXCEPTION 'No account found for %', "target_email" USING ERRCODE = 'P0002';
    END IF;

    IF "capability" = 'bypass_cooldown' THEN
        UPDATE "public"."user_roles" SET "bypass_cooldown" = "enabled" WHERE "user_id" = target_id;
    ELSIF "capability" = 'can_moderate' THEN
        UPDATE "public"."user_roles" SET "can_moderate" = "enabled" WHERE "user_id" = target_id;
    ELSE
        UPDATE "public"."user_roles" SET "can_delete_media" = "enabled" WHERE "user_id" = target_id;
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No role assigned to % - give them a role before granting a capability.', "target_email"
            USING ERRCODE = 'P0002';
    END IF;

    RETURN format('%s %s for %s.', "capability", CASE WHEN "enabled" THEN 'enabled' ELSE 'disabled' END, "target_email");
END;
$$;

REVOKE ALL ON FUNCTION "public"."set_user_capability"(text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."set_user_capability"(text, text, boolean) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."set_user_capability"(text, text, boolean) TO "authenticated";

-- assign_tier_list
-- Body carried verbatim from 20260814000000_tier_list_owner_tools.sql by script, not retyped; only the guard
-- and the word it uses for the caller differ. Grants restated because a
-- callable function revokes its free PUBLIC grant in the same migration.
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
    -- Caller check first, before reading auth.users or writing anything.
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

    -- Granted only if they hold nothing. UNIQUE(user_id) on user_roles means
    -- this touches one row and can never become a second - the constraint that
    -- exists because two roles broke get_my_role() for that user everywhere.
    IF existing_role IS NULL THEN
        INSERT INTO public.user_roles (user_id, role)
        VALUES (target_id, 'trusted_editor')
        ON CONFLICT (user_id) DO NOTHING;
        granted := true;
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

REVOKE ALL ON FUNCTION "public"."assign_tier_list"(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."assign_tier_list"(text, text, text) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."assign_tier_list"(text, text, text) TO "authenticated";

-- list_tier_lists
-- Body carried verbatim from 20260814000000_tier_list_owner_tools.sql by script, not retyped; only the guard
-- and the word it uses for the caller differ. Grants restated because a
-- callable function revokes its free PUBLIC grant in the same migration.
CREATE OR REPLACE FUNCTION "public"."list_tier_lists"()
RETURNS TABLE (
    "id" uuid,
    "slug" text,
    "author_name" text,
    "email" text,
    "blurb" text,
    "status" text,
    "updated_at" timestamptz
)
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF NOT "public"."is_owner"() THEN
        RAISE EXCEPTION 'Permission denied: only the owner may list tier list assignments.'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT tl.id, tl.slug, tl.author_name, u.email::text, tl.blurb, tl.status, tl.updated_at
    FROM public.tier_lists tl
    LEFT JOIN auth.users u ON u.id = tl.owner_id
    ORDER BY tl.created_at;
END;
$$;

REVOKE ALL ON FUNCTION "public"."list_tier_lists"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."list_tier_lists"() FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."list_tier_lists"() TO "authenticated";

-- reset_free_submit_tier_list
-- Body carried verbatim from 20260825000002_reset_free_submit_tier_list.sql by script, not retyped; only the guard
-- and the word it uses for the caller differ. Grants restated because a
-- callable function revokes its free PUBLIC grant in the same migration.
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
    IF NOT "public"."is_owner"() THEN
        RAISE EXCEPTION 'Permission denied: only the owner may reset the Free Submit Tier List.'
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

REVOKE ALL ON FUNCTION "public"."reset_free_submit_tier_list"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."reset_free_submit_tier_list"() FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."reset_free_submit_tier_list"() TO "authenticated";


-- --------------------------------------------------------------------------
-- Four more sites, found by looking for the WRONG SHAPE
-- --------------------------------------------------------------------------
--
-- Pass 1 swept `= ANY (ARRAY['admin', ...])`. These four compare with plain
-- EQUALITY - `ur.role = 'admin'`, `get_my_role() = 'admin'` - so the grep that
-- built pass 1's list never saw them, and neither did the test that pass 1
-- shipped to prevent exactly this. Both have been widened.
--
-- This is the v0.16 lesson again in a new costume: grep for the shape you are
-- about to invalidate, not for the shape you happened to write down first.

-- get_my_role(): 'owner' joins the tiebreak ordering.
--
-- Vestigial in practice - UNIQUE(user_id) means there is only ever one row to
-- order - but an owner row would otherwise fall to the ELSE branch and sort
-- last, which is exactly the kind of dormant wrongness that wakes up when a
-- constraint is relaxed years later. 'contributor' is retired and stays only
-- because removing it changes nothing.
CREATE OR REPLACE FUNCTION "public"."get_my_role"() RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT "role" FROM "public"."user_roles"
  WHERE "user_id" = "auth"."uid"()
  ORDER BY CASE "role"
    WHEN 'owner' THEN 0
    WHEN 'admin' THEN 1
    WHEN 'reviewer' THEN 2
    WHEN 'trusted_editor' THEN 3
    WHEN 'contributor' THEN 4
    WHEN 'viewer' THEN 5
    ELSE 6
  END
  LIMIT 1;
$$;

ALTER FUNCTION "public"."get_my_role"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."get_my_role"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."get_my_role"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."get_my_role"() TO "authenticated";

-- can_delete_media(): stays with the owner, not the new admin.
--
-- Its own comment calls this "the only irreversible action in the panel" and
-- says it is "granted one person at a time rather than arriving with a role".
-- Deleting a file is not on the owner's list of what an admin may do, so
-- preserving today's behaviour means the OWNER keeps it - and an admin who
-- should have it gets the per-user flag, which is what the flag is for.
--
-- Left as an equality against the role column rather than a call to is_owner(),
-- because it reads the row it is already selecting; routing through
-- get_my_role() would be a second lookup to answer a question this row already
-- answers.
CREATE OR REPLACE FUNCTION "public"."can_delete_media"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    SELECT COALESCE(
        (SELECT (ur.role = 'owner') OR ur.can_delete_media
         FROM public.user_roles ur
         WHERE ur.user_id = auth.uid()),
        false
    );
$$;

ALTER FUNCTION "public"."can_delete_media"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."can_delete_media"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."can_delete_media"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."can_delete_media"() TO "authenticated";

-- save_tier_list(): stamping a patch number onto somebody else's list is an
-- owner action, matching assign_tier_list() beside it.
-- Body carried verbatim from 20260818000000_tier_list_game_version.sql.
CREATE OR REPLACE FUNCTION "public"."save_tier_list"(
    "p_list_id" uuid,
    "p_tiers" jsonb,
    "p_reasoning" jsonb DEFAULT NULL,
    "p_changes" jsonb DEFAULT '[]'::jsonb,
    "p_intro" jsonb DEFAULT NULL,
    "p_game_version" text DEFAULT NULL
) RETURNS text
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    target record;
    actor_name text;
    change jsonb;
    moved int := 0;
BEGIN
    IF "auth"."uid"() IS NULL THEN
        RAISE EXCEPTION 'You must be signed in.' USING ERRCODE = '42501';
    END IF;

    SELECT id, owner_id, author_name INTO target
      FROM public.tier_lists WHERE id = "p_list_id";

    IF target.id IS NULL THEN
        RAISE EXCEPTION 'That tier list does not exist.' USING ERRCODE = 'P0002';
    END IF;

    -- The per-row check, restated because SECURITY DEFINER bypasses the policy
    -- that would otherwise enforce it. The game version travels through here
    -- for the same reason the introduction does: it is that person's claim,
    -- and nobody else may stamp a patch number onto their list.
    IF NOT (
        (target.owner_id IS NOT NULL AND target.owner_id = "auth"."uid"())
        OR "public"."is_owner"()
    ) THEN
        RAISE EXCEPTION 'This is not your tier list.' USING ERRCODE = '42501';
    END IF;

    IF jsonb_typeof("p_tiers") IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Tiers must be an array.' USING ERRCODE = '22023';
    END IF;

    -- Bounded here rather than only in the editor, because the editor's cap is
    -- client-side and this endpoint is reachable directly. Generous: it holds
    -- anything shaped like a patch name and refuses anything shaped like an
    -- essay pasted into the wrong field.
    IF "p_game_version" IS NOT NULL AND char_length("p_game_version") > 60 THEN
        RAISE EXCEPTION 'That game version is too long.' USING ERRCODE = '22001';
    END IF;

    SELECT COALESCE(
        NULLIF(raw_user_meta_data->>'display_name', ''),
        NULLIF(raw_user_meta_data->>'full_name', ''),
        NULLIF(split_part(COALESCE(email, ''), '@', 1), ''),
        'Unknown'
    ) INTO actor_name
    FROM auth.users WHERE id = auth.uid();

    FOR change IN SELECT * FROM jsonb_array_elements(COALESCE("p_changes", '[]'::jsonb))
    LOOP
        INSERT INTO public.tier_list_changes
            (list_id, character_id, from_tier, to_tier, note, author_name)
        VALUES (
            "p_list_id",
            change->>'character_id',
            NULLIF(change->>'from_tier', ''),
            NULLIF(change->>'to_tier', ''),
            COALESCE(change->>'note', ''),
            actor_name
        );
        moved := moved + 1;
    END LOOP;

    -- COALESCE, matching reasoning and intro: a caller that omits the field
    -- leaves it alone rather than blanking it. An author who genuinely wants
    -- to clear the version sends an empty string, which is not NULL and does
    -- overwrite.
    UPDATE public.tier_lists
       SET tiers = "p_tiers",
           reasoning = COALESCE("p_reasoning", reasoning),
           intro = COALESCE("p_intro", intro),
           game_version = COALESCE("p_game_version", game_version),
           updated_at = now()
     WHERE id = "p_list_id";

    RETURN format('Saved. %s change%s recorded.', moved, CASE WHEN moved = 1 THEN '' ELSE 's' END);
END;
$$;

REVOKE ALL ON FUNCTION "public"."save_tier_list"(uuid, jsonb, jsonb, jsonb, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."save_tier_list"(uuid, jsonb, jsonb, jsonb, jsonb, text) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."save_tier_list"(uuid, jsonb, jsonb, jsonb, jsonb, text) TO "authenticated";

-- --------------------------------------------------------------------------
-- FIFTEEN MORE POLICIES - the other half of pass 1's job
-- --------------------------------------------------------------------------
--
-- Pass 1 swept `= ANY (ARRAY['admin','reviewer'])` and reported eleven policies
-- done. These fifteen compare with plain EQUALITY - `get_my_role() = 'admin'` -
-- so neither the grep that built that list nor the test that shipped with it
-- ever saw them. Pass 1 was half the sweep and said it was all of it.
--
-- Every one is an owner tool, so every one becomes is_owner(). That is what
-- they mean TODAY, because today `admin` is the owner - and leaving them alone
-- would have handed the new admin the page registry, the FAQ, the
-- collaborators list, site meta, site settings, the blog, page permissions and
-- the whole tier-list system, on the day the role was created, silently.
--
-- Bodies carried verbatim by script; only the predicate is substituted, so
-- every other clause survives byte for byte - including the OR halves that
-- matter most:
--
--     "Voters read their own votes"   user_id = auth.uid() OR is_owner()
--     "Owners edit their own list"    owner_id = auth.uid() OR is_owner()
--
-- A rewrite that lost those would lock every voter out of their own vote and
-- every tier-list holder out of their own list.
-- site_posts.Admins can write posts  (from 20260808000000_site_posts.sql)
DROP POLICY IF EXISTS "Admins can write posts" ON "public"."site_posts";
CREATE POLICY "Admins can write posts" ON "public"."site_posts"
    TO "authenticated"
    USING (("public"."is_owner"()))
    WITH CHECK (("public"."is_owner"()));

-- page_permissions.Admins can manage page permissions  (from 20260808000002_page_permissions_writable.sql)
DROP POLICY IF EXISTS "Admins can manage page permissions" ON "public"."page_permissions";
CREATE POLICY "Admins can manage page permissions" ON "public"."page_permissions"
    TO "authenticated"
    USING (("public"."is_owner"()))
    WITH CHECK (("public"."is_owner"()));

-- site_pages.Admins can manage the page registry  (from 20260808000003_site_pages.sql)
DROP POLICY IF EXISTS "Admins can manage the page registry" ON "public"."site_pages";
CREATE POLICY "Admins can manage the page registry" ON "public"."site_pages"
    TO "authenticated"
    USING (("public"."is_owner"()))
    WITH CHECK (("public"."is_owner"()));

-- site_faq.Admins can manage the FAQ  (from 20260808000005_site_content.sql)
DROP POLICY IF EXISTS "Admins can manage the FAQ" ON "public"."site_faq";
CREATE POLICY "Admins can manage the FAQ" ON "public"."site_faq"
    TO "authenticated"
    USING (("public"."is_owner"()))
    WITH CHECK (("public"."is_owner"()));

-- site_collaborators.Admins can manage collaborators  (from 20260808000005_site_content.sql)
DROP POLICY IF EXISTS "Admins can manage collaborators" ON "public"."site_collaborators";
CREATE POLICY "Admins can manage collaborators" ON "public"."site_collaborators"
    TO "authenticated"
    USING (("public"."is_owner"()))
    WITH CHECK (("public"."is_owner"()));

-- site_meta.Admins can manage site meta  (from 20260809000002_site_meta.sql)
DROP POLICY IF EXISTS "Admins can manage site meta" ON "public"."site_meta";
CREATE POLICY "Admins can manage site meta" ON "public"."site_meta"
    TO "authenticated"
    USING (("public"."is_owner"()))
    WITH CHECK (("public"."is_owner"()));

-- site_settings.Admins can manage site settings  (from 20260810000000_staff_cooldown_perk.sql)
DROP POLICY IF EXISTS "Admins can manage site settings" ON "public"."site_settings";
CREATE POLICY "Admins can manage site settings" ON "public"."site_settings"
    TO "authenticated"
    USING (("public"."is_owner"()))
    WITH CHECK (("public"."is_owner"()));

-- page_discussions.Admins can delete discussions  (from 20260813000000_page_discussions.sql)
DROP POLICY IF EXISTS "Admins can delete discussions" ON "public"."page_discussions";
CREATE POLICY "Admins can delete discussions" ON "public"."page_discussions"
    FOR DELETE TO "authenticated"
    USING ("public"."is_owner"());

-- tier_lists.Owners edit their own list  (from 20260813000005_certified_tier_lists.sql)
DROP POLICY IF EXISTS "Owners edit their own list" ON "public"."tier_lists";
CREATE POLICY "Owners edit their own list" ON "public"."tier_lists"
    FOR UPDATE TO "authenticated"
    USING (
        ("owner_id" IS NOT NULL AND "owner_id" = "auth"."uid"())
        OR "public"."is_owner"()
    )
    WITH CHECK (
        ("owner_id" IS NOT NULL AND "owner_id" = "auth"."uid"())
        OR "public"."is_owner"()
    );

-- tier_lists.Admins create tier lists  (from 20260813000005_certified_tier_lists.sql)
DROP POLICY IF EXISTS "Admins create tier lists" ON "public"."tier_lists";
CREATE POLICY "Admins create tier lists" ON "public"."tier_lists"
    FOR INSERT TO "authenticated"
    WITH CHECK ("public"."is_owner"());

-- tier_lists.Admins delete tier lists  (from 20260813000005_certified_tier_lists.sql)
DROP POLICY IF EXISTS "Admins delete tier lists" ON "public"."tier_lists";
CREATE POLICY "Admins delete tier lists" ON "public"."tier_lists"
    FOR DELETE TO "authenticated"
    USING ("public"."is_owner"());

-- tier_list_changes.Admins can correct the changelog  (from 20260813000005_certified_tier_lists.sql)
DROP POLICY IF EXISTS "Admins can correct the changelog" ON "public"."tier_list_changes";
CREATE POLICY "Admins can correct the changelog" ON "public"."tier_list_changes"
    FOR DELETE TO "authenticated"
    USING ("public"."is_owner"());

-- tier_page_settings.Admins write the tier page intro  (from 20260814000000_tier_list_owner_tools.sql)
DROP POLICY IF EXISTS "Admins write the tier page intro" ON "public"."tier_page_settings";
CREATE POLICY "Admins write the tier page intro" ON "public"."tier_page_settings"
    FOR UPDATE TO "authenticated"
    USING ("public"."is_owner"())
    WITH CHECK ("public"."is_owner"());

-- free_submit_votes.Voters read their own votes  (from 20260814000001_free_submit_tier_list.sql)
DROP POLICY IF EXISTS "Voters read their own votes" ON "public"."free_submit_votes";
CREATE POLICY "Voters read their own votes" ON "public"."free_submit_votes"
    FOR SELECT TO "authenticated"
    USING ("user_id" = "auth"."uid"() OR "public"."is_owner"());

-- free_submit_votes.Voters withdraw their own votes  (from 20260814000001_free_submit_tier_list.sql)
DROP POLICY IF EXISTS "Voters withdraw their own votes" ON "public"."free_submit_votes";
CREATE POLICY "Voters withdraw their own votes" ON "public"."free_submit_votes"
    FOR DELETE TO "authenticated"
    USING ("user_id" = "auth"."uid"() OR "public"."is_owner"());

