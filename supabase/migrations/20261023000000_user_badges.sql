-- The Halloween update (owner, 2026-10-23; no version): user badges, an early
-- version, with the first two: "DSL Halloween 2026 - Gold Ver" for beating the
-- minigame on the first try, and "DSL Halloween 2026" for beating it later.
--
-- THE SHAPE
--
-- The owner's: "its own column in the table that hold the data in a list []".
-- user_profiles.badges holds the ids a person has earned, in the order they
-- earned them. Beside it, hidden_badges holds the ones they chose to hide
-- (owner: "they should be toggleable by users"), so a new badge shows until
-- its holder hides it.
--
-- What an id MEANS (its name, picture and how it is earned) is the client's
-- catalog, window.SITE_BADGES in js/site_utils.js. Which ids can be claimed,
-- and until when, is claim_badge() below. The two lists must agree.
--
-- WHO WRITES WHAT
--
-- A badge is earned in the browser (the minigame runs there), so a determined
-- person can always claim one by calling claim_badge() themselves. The owner is
-- fine with that ("It is just fun"). What this migration does stop is writing
-- ANY id into badges, which would let anybody hand themselves a badge that is
-- not a Halloween one, from a future event or one that does not exist.
--
-- The UPDATE policy on user_profiles cannot say that: a policy decides which
-- ROWS change, never which COLUMNS (the lesson of 20260813000001 and of
-- clear_profile_text()). So the table grant becomes a column grant: a reader
-- can write their bio, flair, privacy and which badges they hide, and badges
-- itself is written only by claim_badge(), with definer rights.
--
-- A column added to user_profiles from now on is NOT writable from the site
-- until it is added to the two GRANTs below. That is the safe direction: the
-- save fails loudly ("permission denied for column"), it never leaks.

ALTER TABLE "public"."user_profiles"
    ADD COLUMN IF NOT EXISTS "badges" text[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS "hidden_badges" text[] NOT NULL DEFAULT '{}';

-- Only a badge you have can be hidden, and no more entries than you have
-- badges: without the count, a repeated id would let one row grow without end.
ALTER TABLE "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_hidden_badges_held"
    CHECK ("hidden_badges" <@ "badges" AND "cardinality"("hidden_badges") <= "cardinality"("badges"));

COMMENT ON COLUMN "public"."user_profiles"."badges" IS
    'Badge ids earned, in order. Written only by claim_badge(); readers have no column grant on it.';
COMMENT ON COLUMN "public"."user_profiles"."hidden_badges" IS
    'Badge ids the holder chose to hide. Always a subset of badges. Hidden ids never leave the database through get_public_profiles().';

REVOKE INSERT, UPDATE ON TABLE "public"."user_profiles" FROM "authenticated";
REVOKE INSERT, UPDATE ON TABLE "public"."user_profiles" FROM "anon";
-- user_id is in both: the first profile save is an upsert, and PostgREST's
-- ON CONFLICT DO UPDATE sets every column it was sent. The RLS policies still
-- pin user_id to the caller.
--
-- hidden_badges is UPDATE only. A new row has no badges, so there is nothing
-- for it to hide, and an upsert could not carry it anyway: Postgres checks the
-- row it WOULD insert (badges still '{}') against the CHECK above before it
-- finds the conflict, so any hidden badge fails it. The site saves a row that
-- exists with a plain UPDATE (found on the local stack, 2026-10-23).
GRANT INSERT ("user_id", "bio", "flair", "is_private")
    ON TABLE "public"."user_profiles" TO "authenticated";
GRANT UPDATE ("user_id", "bio", "flair", "is_private", "hidden_badges")
    ON TABLE "public"."user_profiles" TO "authenticated";

-- --------------------------------------------------------------------------
-- CLAIMING A BADGE
-- --------------------------------------------------------------------------
--
-- Called by the site when somebody wins the minigame signed in, or signs in
-- later with a win waiting on their device. Adding a badge they already have
-- changes nothing, so a second win or a retried request is harmless.
CREATE OR REPLACE FUNCTION "public"."claim_badge"("badge_id" text)
RETURNS text[]
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    "caller" uuid := "auth"."uid"();
    "held" text[];
BEGIN
    IF "caller" IS NULL THEN
        RAISE EXCEPTION 'Sign in to keep a badge.' USING ERRCODE = '42501';
    END IF;

    -- A viewer is soft-banned, the same line the profile policies draw.
    -- IS NOT DISTINCT FROM: get_my_role() is NULL for a member with no role.
    IF "public"."get_my_role"() IS NOT DISTINCT FROM 'viewer' THEN
        RAISE EXCEPTION 'Permission denied: this account cannot claim badges.'
            USING ERRCODE = '42501';
    END IF;

    -- The claimable badges, and until when. A week past the event (Nov 1), so
    -- a reader who won signed out can still sign in and keep it. At 12:00 UTC
    -- on November 8, November 7 has ended everywhere, UTC-12 last.
    IF NOT ("badge_id" = ANY (ARRAY['halloween-2026-gold', 'halloween-2026'])) THEN
        RAISE EXCEPTION 'No such badge.' USING ERRCODE = '22023';
    END IF;
    IF now() >= timestamptz '2026-11-08 12:00:00+00' THEN
        RAISE EXCEPTION 'The Halloween 2026 badges can no longer be claimed.'
            USING ERRCODE = '22023';
    END IF;

    -- The row may not exist yet: user_profiles has no signup trigger.
    INSERT INTO "public"."user_profiles" ("user_id", "badges")
    VALUES ("caller", ARRAY["badge_id"])
    ON CONFLICT ("user_id") DO UPDATE
        SET "badges" = CASE
            WHEN "badge_id" = ANY ("user_profiles"."badges") THEN "user_profiles"."badges"
            ELSE "user_profiles"."badges" || "badge_id"
        END
    RETURNING "user_profiles"."badges" INTO "held";

    RETURN "held";
END;
$$;

ALTER FUNCTION "public"."claim_badge"(text) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."claim_badge"(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."claim_badge"(text) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."claim_badge"(text) TO "authenticated";

-- --------------------------------------------------------------------------
-- SHOWING THEM
-- --------------------------------------------------------------------------
--
-- get_public_profiles() (20260903000000) is how a thread and the profile modal
-- read everybody else, so the badges they show ride along on it: one request
-- per thread, as before. A new output column changes the function's type, which
-- CREATE OR REPLACE cannot do, so it is dropped and made again with the same
-- body and grants plus the column.
--
-- The single-row get_public_profile() is left as it is: no page reads it, and
-- get_open_submission_scopes() (20261019000000) calls it for the name only.
DROP FUNCTION IF EXISTS "public"."get_public_profiles"(uuid[]);

CREATE FUNCTION "public"."get_public_profiles"("target_user_ids" uuid[])
RETURNS TABLE (
    "user_id" uuid,
    "display_name" text,
    "bio" text,
    "flair" text,
    "is_private" boolean,
    "standing" text,
    "joined_at" timestamptz,
    "badges" text[]
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
        -- Unchanged from 20260903000000: never the email, never the email
        -- prefix, and the bio only when it is public.
        CASE WHEN COALESCE(up."is_private", false) THEN NULL ELSE up."bio" END,
        up."flair",
        COALESCE(up."is_private", false),
        CASE WHEN ur."role" IS DISTINCT FROM 'viewer' THEN ur."role" END,
        au."created_at",
        -- The badges they show, in the order they earned them. A hidden one
        -- never leaves the database, the same way a private bio does not.
        ARRAY(
            SELECT held.id
            FROM unnest(COALESCE(up."badges", '{}')) WITH ORDINALITY AS held(id, n)
            WHERE NOT (held.id = ANY (COALESCE(up."hidden_badges", '{}')))
            ORDER BY held.n
        )
    FROM "auth"."users" au
    LEFT JOIN "public"."user_profiles" up ON up."user_id" = au."id"
    LEFT JOIN "public"."user_roles"    ur ON ur."user_id" = au."id"
    WHERE au."id" = ANY("target_user_ids"[1:200]);
$$;

ALTER FUNCTION "public"."get_public_profiles"(uuid[]) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."get_public_profiles"(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."get_public_profiles"(uuid[]) TO "anon";
GRANT EXECUTE ON FUNCTION "public"."get_public_profiles"(uuid[]) TO "authenticated";
