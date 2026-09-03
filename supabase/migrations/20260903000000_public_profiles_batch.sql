-- v0.17 F11, part 3: reading a whole thread's worth of people at once.
--
-- get_public_profile(uuid) (20260827000005) answers "who is this person" for one
-- id, which is what the profile modal needs. A discussion thread needs the other
-- shape: every author on screen, so their flair can be drawn beside their name
-- without a request per post.
--
-- WHY NOT JUST OPEN THE TABLE UP
--
-- The obvious alternative is a public SELECT policy on user_profiles exposing
-- flair only. It cannot be written: a policy decides WHICH ROWS a reader sees,
-- never WHICH COLUMNS, so "everyone may read the flair but the bio only when it
-- is public" is not expressible as a policy at all. That is the same limit that
-- made thread moderation an RPC in 20260813000001.
--
-- Keeping both reads behind one function also means privacy is enforced in one
-- place. Two doors would have to agree about is_private forever.
--
-- A NEW MIGRATION RATHER THAN AN EDIT
--
-- 20260827000005 has been pushed, so it is immutable - a preview branch records
-- each migration by version and will not run that version again, which is how
-- v0.14 shipped a migration nothing had ever executed. The single-row function
-- is left exactly as it is and this adds the plural one beside it.

CREATE OR REPLACE FUNCTION "public"."get_public_profiles"("target_user_ids" uuid[])
RETURNS TABLE (
    "user_id" uuid,
    "display_name" text,
    "bio" text,
    "flair" text,
    "is_private" boolean,
    "standing" text,
    "joined_at" timestamptz
)
LANGUAGE "sql" STABLE SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
    SELECT
        au."id",
        COALESCE(
            NULLIF(au."raw_user_meta_data"->>'display_name', ''),
            NULLIF(au."raw_user_meta_data"->>'full_name', ''),
            NULLIF(au."raw_user_meta_data"->'custom_claims'->>'global_name', ''),
            NULLIF(au."raw_user_meta_data"->>'user_name', ''),
            'Anonymous'
        )::text,
        -- Identical privacy rule to the single-row function, and identical for a
        -- reason: two readers of the same data that disagree about is_private
        -- would make the setting mean different things in the modal and in the
        -- thread. Never returns the email; never falls back to the email prefix.
        CASE WHEN COALESCE(up."is_private", false) THEN NULL ELSE up."bio" END,
        up."flair",
        COALESCE(up."is_private", false),
        CASE WHEN ur."role" IS DISTINCT FROM 'viewer' THEN ur."role" END,
        au."created_at"
    FROM "auth"."users" au
    LEFT JOIN "public"."user_profiles" up ON up."user_id" = au."id"
    LEFT JOIN "public"."user_roles"    ur ON ur."user_id" = au."id"
    -- Bounded. The ids are unguessable so this is not an enumeration route, but
    -- an unbounded array is still an unbounded scan from an anonymous caller.
    -- A thread page asks for at most its own authors, de-duplicated.
    WHERE au."id" = ANY("target_user_ids"[1:200]);
$$;

ALTER FUNCTION "public"."get_public_profiles"(uuid[]) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."get_public_profiles"(uuid[]) FROM PUBLIC;
-- anon as well as authenticated: a logged-out reader sees the same thread, with
-- the same flairs, and this is the request that draws them.
GRANT EXECUTE ON FUNCTION "public"."get_public_profiles"(uuid[]) TO "anon";
GRANT EXECUTE ON FUNCTION "public"."get_public_profiles"(uuid[]) TO "authenticated";
