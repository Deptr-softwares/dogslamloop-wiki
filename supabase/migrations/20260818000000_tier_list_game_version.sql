-- v0.15 item 13: a tier list records which game version it describes.
--
-- THE PROBLEM
--
-- A tier list is a claim about a patch. JJS rebalances often, and a list read
-- six weeks after it was written is read against a game that has moved -
-- without the reader having any way to tell. Today nothing on the page says
-- which version the author had in front of them, so an out-of-date list and a
-- current one look identical.
--
-- Free text rather than an enum or a lookup table, deliberately. The owner
-- writes these by hand and the game's own versioning is not ours to model; a
-- constrained column would need a migration every patch, and the failure mode
-- of that is somebody writing the wrong version because the right one is not
-- in the list yet.
--
-- Empty by default, and empty means "not stated" rather than "unknown
-- version". Every list that exists today is in that state and none of them are
-- wrong for it, so nothing is backfilled with a guess.

ALTER TABLE "public"."tier_lists"
    ADD COLUMN IF NOT EXISTS "game_version" text NOT NULL DEFAULT '';

COMMENT ON COLUMN "public"."tier_lists"."game_version" IS
    'The game version this ranking describes, as the author typed it. Empty means not stated. Shown to readers beside the author, because a tier list without a patch is a claim with no date on it.';

-- --------------------------------------------------------------------------
-- SAVING, NOW WITH THE GAME VERSION
-- --------------------------------------------------------------------------
--
-- DROP FIRST, with the CURRENT five-argument signature. Adding a parameter
-- with a default does NOT replace a function - it creates an OVERLOAD, and
-- PostgREST resolves by named arguments, so a five-argument call would then be
-- ambiguous between the two. The same trap the introduction migration
-- documented when it went from four parameters to five; this is that comment
-- being right a second time.
DROP FUNCTION IF EXISTS "public"."save_tier_list"(uuid, jsonb, jsonb, jsonb, jsonb);

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
        OR "public"."get_my_role"() = 'admin'
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

ALTER FUNCTION "public"."save_tier_list"(uuid, jsonb, jsonb, jsonb, jsonb, text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."save_tier_list"(uuid, jsonb, jsonb, jsonb, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."save_tier_list"(uuid, jsonb, jsonb, jsonb, jsonb, text) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."save_tier_list"(uuid, jsonb, jsonb, jsonb, jsonb, text) TO "authenticated";
