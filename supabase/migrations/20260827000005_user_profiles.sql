-- v0.17 F11, part 1: user_profiles - the first person record this schema has.
--
-- THE PROBLEM
--
-- There is no place where a person exists on this site. Every name is
-- denormalized onto the row that needed it - pending_revisions.author_name,
-- page_discussions.author_name, moderation_log.moderator_name - and
-- getDisplayName() (js/site_utils.js:1415) reads session.user.user_metadata,
-- which exists only for THE VIEWER'S OWN SESSION. A name for anybody else is
-- not queryable at all.
--
-- This is also why F5's expert badge cannot be built before this one. The badge
-- has to render somebody ELSE'S standing, and user_roles' only SELECT policy is
-- "Users can read own role" - auth.uid() = user_id (20260727000000:281). A
-- client can read exactly one role row: its own. That is the same wall
-- list_personnel() hit in v0.10, and it has the same answer, for the same
-- reason: a SECURITY DEFINER reader, because no policy can express it.
--
-- WHAT THIS TABLE DELIBERATELY DOES NOT HOLD
--
-- The display name. It stays in auth.users.raw_user_meta_data, where signup
-- (js/site_utils.js:1341) and the rename (js/site_utils.js:1383) already put
-- it, and get_public_profile() below reads it there with definer rights.
--
-- Copying it into a column here would create a second source of truth that has
-- to be kept in sync with the first, and the sync would need a trigger on
-- auth.users - which, if it ever raised, would break signup itself. Reading
-- through the function costs nothing and cannot drift.
--
-- The consequence is the good kind: a user with no row here is simply a user
-- with no bio, no flair and a public profile. So there is NO BACKFILL, and
-- every existing account already works.

-- --------------------------------------------------------------------------
-- THE TABLE
-- --------------------------------------------------------------------------
--
-- ON DELETE CASCADE is load-bearing and this is the third instance of the same
-- trap. anonymize_user_by_email hard-deletes the auth.users row;
-- pending_revisions.author_id has no ON DELETE clause, so deleting a
-- contributor already raises a constraint violation, and page_discussions
-- .author_id had to be ON DELETE SET NULL for the same reason. This must not
-- become the third thing blocking account deletion.
CREATE TABLE IF NOT EXISTS "public"."user_profiles" (
    "user_id" uuid NOT NULL,
    "bio" text,
    "flair" text,
    "is_private" boolean NOT NULL DEFAULT false,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "user_profiles_user_fkey" FOREIGN KEY ("user_id")
        REFERENCES "auth"."users"("id") ON DELETE CASCADE,
    -- Caps enforced in the database, not only in the form. The form is a
    -- suggestion; PostgREST is the actual entry point.
    CONSTRAINT "user_profiles_bio_length"
        CHECK ("bio" IS NULL OR "char_length"("bio") <= 500),
    -- The flair is owner-chosen free text (owner, 2026-08-27) rendered inline
    -- beside a display name in a discussion. A newline in it would break that
    -- line's layout everywhere it appears, so it is rejected at the source
    -- rather than stripped at each of the places that render it.
    CONSTRAINT "user_profiles_flair_shape"
        CHECK ("flair" IS NULL OR ("char_length"("flair") <= 32 AND "flair" !~ '[\r\n]'))
);

COMMENT ON TABLE "public"."user_profiles" IS
    'The public person record. Holds only what auth.users does not: bio, flair, privacy. The display name stays in auth.users.raw_user_meta_data and is read by get_public_profile().';

COMMENT ON COLUMN "public"."user_profiles"."is_private" IS
    'Hides the bio, and only the bio. The display name, flair and standing stay visible, because author_name is already public on every discussion, revision and history row - privacy here cannot retroactively unpublish those.';

ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- POLICIES - self-service only
-- --------------------------------------------------------------------------
--
-- There is no public SELECT policy and no anon grant, because nobody reads
-- this table directly. Every read of somebody else's profile goes through
-- get_public_profile() below, which is what lets privacy be enforced on the
-- server. A client that fetched the bio and then hid it in CSS would be
-- offering a privacy setting that devtools defeats.
CREATE POLICY "Users can read own profile" ON "public"."user_profiles"
    FOR SELECT TO "authenticated"
    USING ("auth"."uid"() = "user_id");

-- A viewer is a soft ban: signed in, can read, cannot put content on the site.
-- A bio and a flair are content - they render beside a name in discussions - so
-- the ban covers them. IS DISTINCT FROM, never <>: get_my_role() returns NULL
-- for a signed-in user with no role, and NULL <> 'viewer' is NULL, which would
-- deny every ordinary user instead of only the banned one.
CREATE POLICY "Users can create own profile" ON "public"."user_profiles"
    FOR INSERT TO "authenticated"
    WITH CHECK ("auth"."uid"() = "user_id"
        AND "public"."get_my_role"() IS DISTINCT FROM 'viewer');

-- WITH CHECK repeats the ownership test rather than leaning on USING: USING
-- gates the OLD row and cannot see the new one, so without this a user could
-- pass the gate on their own row and write user_id to somebody else's.
CREATE POLICY "Users can update own profile" ON "public"."user_profiles"
    FOR UPDATE TO "authenticated"
    USING ("auth"."uid"() = "user_id")
    WITH CHECK ("auth"."uid"() = "user_id"
        AND "public"."get_my_role"() IS DISTINCT FROM 'viewer');

-- No DELETE policy. A profile is removed by deleting the account, which the
-- cascade above handles. Staff blanking abusive text is clear_profile_text()
-- below, which is a different verb and keeps the row.
GRANT SELECT, INSERT, UPDATE ON TABLE "public"."user_profiles" TO "authenticated";

-- --------------------------------------------------------------------------
-- updated_at
-- --------------------------------------------------------------------------
--
-- A trigger, not a client-supplied column: the client is the untrusted party
-- and PostgREST would happily accept whatever timestamp it sent.
CREATE OR REPLACE FUNCTION "public"."touch_user_profile"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW."updated_at" := now();
    -- created_at is not the client's to move either.
    NEW."created_at" := OLD."created_at";
    RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."touch_user_profile"() OWNER TO "postgres";

-- Trigger functions are not RPCs. Same treatment 20260819000000 gave the five
-- that were exposed at /rest/v1/rpc/ by the PUBLIC default.
REVOKE ALL ON FUNCTION "public"."touch_user_profile"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."touch_user_profile"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."touch_user_profile"() FROM "authenticated";

DROP TRIGGER IF EXISTS "trigger_touch_user_profile" ON "public"."user_profiles";
CREATE TRIGGER "trigger_touch_user_profile"
    BEFORE UPDATE ON "public"."user_profiles"
    FOR EACH ROW EXECUTE FUNCTION "public"."touch_user_profile"();

-- --------------------------------------------------------------------------
-- READING SOMEBODY ELSE'S PROFILE
-- --------------------------------------------------------------------------
--
-- SECURITY DEFINER because it must read auth.users (the display name and the
-- join date) and user_roles (the standing), neither of which any client can
-- read for another person. Same justification as list_personnel().
--
-- Granted to anon as well as authenticated: a logged-out reader clicking a name
-- in a discussion is the main case this exists for.
--
-- WHAT IT MUST NEVER RETURN: the email address. auth.users is fully readable
-- inside this function, so the column list below is the only thing standing
-- between a public RPC and every address on the site. Note too that the name
-- falls back to 'Anonymous' and NOT to the email prefix, which is where
-- getDisplayName() ends - that fallback is fine for showing you your own name
-- and would be a leak here.
CREATE OR REPLACE FUNCTION "public"."get_public_profile"("target_user_id" uuid)
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
        -- Privacy applied HERE, so the bio never leaves the database rather
        -- than being sent and then hidden.
        CASE WHEN COALESCE(up."is_private", false) THEN NULL ELSE up."bio" END,
        up."flair",
        COALESCE(up."is_private", false),
        -- A viewer is soft-banned. Reporting that as a public standing would
        -- publish a moderation decision and brand the account, so a viewer
        -- reads as an ordinary member with no standing at all.
        CASE WHEN ur."role" IS DISTINCT FROM 'viewer' THEN ur."role" END,
        au."created_at"
    FROM "auth"."users" au
    LEFT JOIN "public"."user_profiles" up ON up."user_id" = au."id"
    LEFT JOIN "public"."user_roles"    ur ON ur."user_id" = au."id"
    WHERE au."id" = "target_user_id";
$$;

ALTER FUNCTION "public"."get_public_profile"(uuid) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."get_public_profile"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."get_public_profile"(uuid) TO "anon";
GRANT EXECUTE ON FUNCTION "public"."get_public_profile"(uuid) TO "authenticated";

-- --------------------------------------------------------------------------
-- MODERATING A PROFILE
-- --------------------------------------------------------------------------
--
-- The flair is free text rendered beside a name across the site, so there has
-- to be a way to take one down. There is deliberately NO staff UPDATE policy
-- on user_profiles, and that is the lesson of 20260813000001: a policy can
-- constrain WHICH ROWS change but not WHAT changes, so a staff UPDATE policy
-- would let staff rewrite a contributor's bio into anything at all. v0.14
-- dropped "Staff can moderate discussions" for exactly that and routed
-- moderation through an RPC that can only blank a body. This is the same shape.
--
-- One verb, matching REMOVE: the text is blanked, the row stays, and the
-- snapshot in moderation_log is the only remaining copy.
CREATE OR REPLACE FUNCTION "public"."clear_profile_text"(
    "target_user_id" uuid,
    "reason" text DEFAULT NULL
) RETURNS void
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    "old_bio" text;
    "old_flair" text;
    "mod_name" text;
BEGIN
    -- Caller check first, before anything is read or written, and by rank
    -- rather than by name. Never rely on the EXECUTE grant alone.
    IF NOT "public"."is_staff"() THEN
        RAISE EXCEPTION 'Permission denied: only staff can clear a profile.'
            USING ERRCODE = '42501';
    END IF;

    SELECT up."bio", up."flair" INTO "old_bio", "old_flair"
    FROM "public"."user_profiles" up WHERE up."user_id" = "target_user_id";

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No profile for that user.' USING ERRCODE = 'P0002';
    END IF;

    UPDATE "public"."user_profiles"
       SET "bio" = NULL, "flair" = NULL
     WHERE "user_id" = "target_user_id";

    SELECT COALESCE(
        NULLIF(au."raw_user_meta_data"->>'display_name', ''),
        NULLIF(au."raw_user_meta_data"->>'full_name', ''),
        'Staff'
    ) INTO "mod_name"
    FROM "auth"."users" au WHERE au."id" = "auth"."uid"();

    -- target_type carries the distinction. The action CHECK on moderation_log
    -- allows hide | remove | restore, so reusing 'remove' keeps that constraint
    -- untouched instead of widening a shipped one.
    INSERT INTO "public"."moderation_log"
        ("action", "target_type", "target_id", "moderator_id", "moderator_name",
         "reason", "snapshot")
    VALUES
        ('remove', 'user_profile', "target_user_id", "auth"."uid"(),
         COALESCE("mod_name", 'Staff'), "reason",
         COALESCE("old_flair", '') || CASE WHEN "old_flair" IS NOT NULL AND "old_bio" IS NOT NULL
                                           THEN E'\n---\n' ELSE '' END || COALESCE("old_bio", ''));
END;
$$;

ALTER FUNCTION "public"."clear_profile_text"(uuid, text) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."clear_profile_text"(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."clear_profile_text"(uuid, text) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."clear_profile_text"(uuid, text) TO "authenticated";
