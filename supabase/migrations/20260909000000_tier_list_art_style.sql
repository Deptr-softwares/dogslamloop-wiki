-- v0.18 FT4: a certified tier list chooses its own character art.
--
-- THE PROBLEM. Every certified list draws the roster with the wiki's character
-- PORTRAITS, and a portrait is a tall crop of a full-body render. On a tier row
-- twenty characters wide that reads as a strip of faces, which is what the
-- feature wanted - but the roster ICONS added in v0.16 are square, flat, and
-- far more legible at that size. The owner asked (2026-09-08) for the
-- contributor who owns a list to be able to pick between them, rather than the
-- site deciding for everyone.
--
-- WHY A COLUMN AND NOT A SETTING. This is per LIST, not per site and not per
-- reader: two contributors can reasonably want different treatments for lists
-- that sit side by side in the same picker, and a reader following a shared
-- ?list=<slug> link has to see what its author chose. `tier_lists` has no
-- general-purpose settings blob, and putting a rendering choice inside `intro`
-- - which is authored content - would make one contributor's prose edit able to
-- clobber the other half of it.
--
-- WHY IT NEEDS NO NEW POLICY OR GRANT. Column privileges are not used on this
-- table: `authenticated` already holds a table-level GRANT UPDATE, and the row
-- is gated by "Owners edit their own list", which 20260827000003_owner_role.sql
-- rewrote against is_owner() rather than a literal role name. A new column on
-- an already-policied table inherits both. Adding a policy here would be a
-- second gate saying the same thing.
--
-- The default is 'portrait', so every existing list renders exactly as it does
-- today and this migration changes nothing visible until somebody opts in.

ALTER TABLE "public"."tier_lists"
    ADD COLUMN IF NOT EXISTS "art_style" text NOT NULL DEFAULT 'portrait';

-- CHECKED IN THE DATABASE, not only in the editor's dropdown. The renderer
-- branches on this value, and an unexpected one would fall through to whichever
-- side the branch happens to treat as its default - so the set of legal answers
-- is stated where it cannot be bypassed by a direct PostgREST call.
--
-- Guarded by a DO block because Postgres has no ADD CONSTRAINT IF NOT EXISTS,
-- and this migration must be re-runnable against a branch that already has it.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "pg_constraint" WHERE "conname" = 'tier_lists_art_style_check'
    ) THEN
        ALTER TABLE "public"."tier_lists"
            ADD CONSTRAINT "tier_lists_art_style_check"
            CHECK ("art_style" IN ('portrait', 'icon'));
    END IF;
END $$;

COMMENT ON COLUMN "public"."tier_lists"."art_style" IS
    'Which character art this list draws: portrait (the tall wiki portrait, the '
    'default and what every list used before v0.18) or icon (the square roster '
    'icon added in v0.16). Set by the list''s own contributor in tier-editor.html.';

-- --------------------------------------------------------------------------
-- save_tier_list(): carry the choice through the same door as everything else
-- --------------------------------------------------------------------------
--
-- The editor writes a list through this RPC and nothing else, so art_style has
-- to travel with it. Signature change, so the old one is dropped first rather
-- than left behind as an overload PostgREST could still resolve to.
--
-- BODY CARRIED VERBATIM FROM 20260827000003_owner_role.sql, which is the
-- current definition - NOT from 20260818000000, which reads
-- get_my_role() = 'admin'. Copying the older one would have re-locked the owner
-- out of every tier list, silently, while looking like a faithful copy. That
-- file's own header warns about exactly this: the OR halves are what keep a
-- list-holder in their own list.
--
-- Only two things are added: the parameter, and its validation.

DROP FUNCTION IF EXISTS "public"."save_tier_list"(uuid, jsonb, jsonb, jsonb, jsonb, text);

CREATE OR REPLACE FUNCTION "public"."save_tier_list"(
    "p_list_id" uuid,
    "p_tiers" jsonb,
    "p_reasoning" jsonb DEFAULT NULL,
    "p_changes" jsonb DEFAULT '[]'::jsonb,
    "p_intro" jsonb DEFAULT NULL,
    "p_game_version" text DEFAULT NULL,
    "p_art_style" text DEFAULT NULL
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

    -- Named rather than left to the CHECK constraint. Both refuse it, but the
    -- constraint raises 23514 with the table's name in it, which tells a
    -- contributor who mistyped nothing they can act on.
    IF "p_art_style" IS NOT NULL AND "p_art_style" NOT IN ('portrait', 'icon') THEN
        RAISE EXCEPTION 'Art style must be portrait or icon.' USING ERRCODE = '22023';
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
    -- overwrite. art_style has no meaningful empty value - it is one of two
    -- words - so omitting it is the only way to leave it alone.
    UPDATE public.tier_lists
       SET tiers = "p_tiers",
           reasoning = COALESCE("p_reasoning", reasoning),
           intro = COALESCE("p_intro", intro),
           game_version = COALESCE("p_game_version", game_version),
           art_style = COALESCE("p_art_style", art_style),
           updated_at = now()
     WHERE id = "p_list_id";

    RETURN format('Saved. %s change%s recorded.', moved, CASE WHEN moved = 1 THEN '' ELSE 's' END);
END;
$$;

ALTER FUNCTION "public"."save_tier_list"(uuid, jsonb, jsonb, jsonb, jsonb, text, text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."save_tier_list"(uuid, jsonb, jsonb, jsonb, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."save_tier_list"(uuid, jsonb, jsonb, jsonb, jsonb, text, text) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."save_tier_list"(uuid, jsonb, jsonb, jsonb, jsonb, text, text) TO "authenticated";
