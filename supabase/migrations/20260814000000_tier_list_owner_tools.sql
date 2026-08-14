-- v0.14: tier list owner tools, and a per-person introduction.
--
-- Owner-specified 2026-08-14:
--
--   1. The page's own introduction becomes editable from owner tools instead
--      of being hardcoded in systems/tierlist/index.html.
--   2. Assigning somebody a tier list also grants them trusted_editor.
--   3. Each list gains its own introduction, above the tiers, editable by that
--      person and nobody else - and deliberately NOT through the reviewer
--      queue, because a tier list is signed opinion rather than wiki content.
--   4. Picking a person HIDES the page introduction, so their list reads as
--      their space rather than a subsection of somebody else's page.

-- --------------------------------------------------------------------------
-- THE PER-PERSON INTRODUCTION
-- --------------------------------------------------------------------------
--
-- A block array like `reasoning`, not plain text, so it reuses the editor and
-- generateHTMLForBlocks the rest of the site already has. An introduction
-- wants a link and a bit of emphasis more often than a tier list wants a
-- second content format.
--
-- Distinct from `reasoning` on purpose, and they are not redundant: this sits
-- ABOVE the tiers and says who you are and how you rank; reasoning sits below
-- with the changelog and argues the specific placements. Collapsing them would
-- mean the reader meets the argument before the ranking it is about.
ALTER TABLE "public"."tier_lists"
    ADD COLUMN IF NOT EXISTS "intro" jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN "public"."tier_lists"."intro" IS
    'Rendered above the tiers, and replaces the page introduction while this list is open. Owned by the assignee alone - no reviewer queue, because a signed tier list is not wiki content somebody else approves.';


-- --------------------------------------------------------------------------
-- THE PAGE'S OWN INTRODUCTION
-- --------------------------------------------------------------------------
--
-- Singleton, using the same `id = true` trick site_settings uses, so there is
-- exactly one row and no code has to decide which one is current.
--
-- Its own table rather than a column on site_meta: this is the tier list
-- page's content, and the next thing this page needs configuring (whether Free
-- Submit is open, say) belongs beside it rather than in a table about the
-- whole site.
CREATE TABLE IF NOT EXISTS "public"."tier_page_settings" (
    "id" boolean NOT NULL DEFAULT true,
    "intro" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "tier_page_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tier_page_settings_singleton" CHECK ("id" = true)
);

ALTER TABLE "public"."tier_page_settings" OWNER TO "postgres";
ALTER TABLE "public"."tier_page_settings" ENABLE ROW LEVEL SECURITY;

-- Seeded with the copy currently hardcoded in the page, so nothing disappears
-- on the day this ships and the owner has something to edit rather than an
-- empty box.
INSERT INTO "public"."tier_page_settings" ("id", "intro")
VALUES (true, jsonb_build_array(
    jsonb_build_object(
        'type', 'paragraph',
        'content', 'Every list here belongs to one person. Frame data is measurable; a tier list is an opinion, and an unattributed ranking quietly presents the second as the first. So each one is credited by name, carries the reasoning behind it, and records a note for every character that moves.'
    )
))
ON CONFLICT ("id") DO NOTHING;

CREATE POLICY "Anyone can read the tier page intro" ON "public"."tier_page_settings"
    FOR SELECT USING (true);

CREATE POLICY "Admins write the tier page intro" ON "public"."tier_page_settings"
    FOR UPDATE TO "authenticated"
    USING ("public"."get_my_role"() = 'admin')
    WITH CHECK ("public"."get_my_role"() = 'admin');

GRANT SELECT ON TABLE "public"."tier_page_settings" TO "anon";
GRANT SELECT, UPDATE ON TABLE "public"."tier_page_settings" TO "authenticated";


-- --------------------------------------------------------------------------
-- ASSIGNING A LIST
-- --------------------------------------------------------------------------
--
-- Creating a list and granting trusted_editor are one action, because they are
-- one decision: the owner picked somebody to write on the wiki under their own
-- name. Leaving the role to a second manual step is how a new author ends up
-- assigned but unable to do anything.
--
-- The role is GRANTED, NEVER DOWNGRADED. An admin or reviewer who gets a tier
-- list keeps what they had - trusted_editor is below both, and quietly
-- demoting somebody as a side effect of a favour would be a genuinely nasty
-- bug to track down.
--
-- A 'viewer' is REFUSED rather than upgraded. viewer is the soft ban - "signed
-- in, can read, cannot submit" - so handing a banned account a public platform
-- on the wiki is a contradiction. It is far more likely to be a mistyped email
-- than a deliberate un-banning, and un-banning should be something somebody
-- does on purpose in the roster.
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
    IF "public"."get_my_role"() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Permission denied: only an administrator may assign a tier list.'
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

ALTER FUNCTION "public"."assign_tier_list"(text, text, text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."assign_tier_list"(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."assign_tier_list"(text, text, text) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."assign_tier_list"(text, text, text) TO "authenticated";


-- Every list plus who owns it, for the owner tools roster. SECURITY DEFINER so
-- it can read auth.users for the email, which is the only handle an admin has
-- on a person.
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
    IF "public"."get_my_role"() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Permission denied: only an administrator may list tier list assignments.'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT tl.id, tl.slug, tl.author_name, u.email::text, tl.blurb, tl.status, tl.updated_at
    FROM public.tier_lists tl
    LEFT JOIN auth.users u ON u.id = tl.owner_id
    ORDER BY tl.created_at;
END;
$$;

ALTER FUNCTION "public"."list_tier_lists"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."list_tier_lists"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."list_tier_lists"() FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."list_tier_lists"() TO "authenticated";


-- --------------------------------------------------------------------------
-- SAVING, NOW WITH THE INTRODUCTION
-- --------------------------------------------------------------------------
--
-- DROP FIRST, and for a different reason than the usual one. Adding a
-- parameter with a default does NOT replace the existing function - it creates
-- an OVERLOAD, and PostgREST resolves calls by named arguments, so a
-- four-argument call would be ambiguous between the two. Same family as the
-- 42P13 return-type trap this project has now hit three times: CREATE OR
-- REPLACE only ever replaces a function with the identical signature.
DROP FUNCTION IF EXISTS "public"."save_tier_list"(uuid, jsonb, jsonb, jsonb);

CREATE OR REPLACE FUNCTION "public"."save_tier_list"(
    "p_list_id" uuid,
    "p_tiers" jsonb,
    "p_reasoning" jsonb DEFAULT NULL,
    "p_changes" jsonb DEFAULT '[]'::jsonb,
    "p_intro" jsonb DEFAULT NULL
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
    -- that would otherwise enforce it. This is also what makes "editable by
    -- them and them only" true of the introduction: it travels through here.
    IF NOT (
        (target.owner_id IS NOT NULL AND target.owner_id = "auth"."uid"())
        OR "public"."get_my_role"() = 'admin'
    ) THEN
        RAISE EXCEPTION 'This is not your tier list.' USING ERRCODE = '42501';
    END IF;

    IF jsonb_typeof("p_tiers") IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Tiers must be an array.' USING ERRCODE = '22023';
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

    UPDATE public.tier_lists
       SET tiers = "p_tiers",
           reasoning = COALESCE("p_reasoning", reasoning),
           intro = COALESCE("p_intro", intro),
           updated_at = now()
     WHERE id = "p_list_id";

    RETURN format('Saved. %s change%s recorded.', moved, CASE WHEN moved = 1 THEN '' ELSE 's' END);
END;
$$;

ALTER FUNCTION "public"."save_tier_list"(uuid, jsonb, jsonb, jsonb, jsonb) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."save_tier_list"(uuid, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."save_tier_list"(uuid, jsonb, jsonb, jsonb, jsonb) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."save_tier_list"(uuid, jsonb, jsonb, jsonb, jsonb) TO "authenticated";
