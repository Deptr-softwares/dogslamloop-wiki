-- v0.13 item 9: per-user capabilities, as columns rather than roles.
--
-- The problem this avoids is on record. `20260801000000_role_model_fix.sql`
-- added UNIQUE(user_id) to user_roles deliberately, because holding two roles
-- broke get_my_role() with "more than one row returned by a subquery" - which
-- broke that user's access to everything, not just the thing the second role
-- was for. So "give this person one extra power" must never become a second
-- row.
--
-- A boolean column keeps UNIQUE(user_id) and get_my_role() exactly as they
-- are. Roles stay a hierarchy; a capability is a flag on top of one.
--
-- ONE capability ships here, and it is enforced. Declaring a set of columns
-- nothing reads would be dead configuration that looks like a feature - an
-- owner could tick a box and reasonably expect something to change. The
-- pattern is what matters, and adding the next one is a column plus a check
-- in whatever enforces it.

ALTER TABLE "public"."user_roles"
    ADD COLUMN IF NOT EXISTS "bypass_cooldown" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "public"."user_roles"."bypass_cooldown" IS
    'Per-user submission cooldown exemption. Independent of the site-wide staff switch in site_settings: either one is enough to skip the wait.';

-- The rate-limit trigger, extended.
--
-- Keyed on NEW.author_id rather than the caller. They are the same person on
-- an ordinary insert, but the trigger''s job is to rate-limit the AUTHOR of
-- the revision, and a reviewer intercepting a ticket writes rows carrying the
-- original author''s id. Asking about the author is what the rest of this
-- function already does.
CREATE OR REPLACE FUNCTION "public"."check_revision_rate_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  bypass_enabled boolean;
  caller_role text;
  author_exempt boolean;
BEGIN
  SELECT staff_bypass_submission_cooldown INTO bypass_enabled
    FROM site_settings WHERE id = true;

  caller_role := get_my_role();

  -- Positive IN test, so the NULL case fails safe on its own: get_my_role()
  -- returns NULL for a signed-in user with no role, and `NULL IN (...)` is
  -- NULL rather than true, so an ordinary contributor falls through to the
  -- limit below. COALESCE guards the settings row being absent, which must
  -- also mean "enforce".
  IF COALESCE(bypass_enabled, false)
     AND caller_role IN ('trusted_editor', 'reviewer', 'admin') THEN
    RETURN NEW;
  END IF;

  -- The per-user capability, checked second so it can grant the exemption to
  -- someone the site-wide switch does not cover - a contributor with no role
  -- at all, which is the case it exists for. COALESCE because a user with no
  -- user_roles row at all selects into NULL, and NULL must mean "enforce".
  SELECT bypass_cooldown INTO author_exempt
    FROM user_roles WHERE user_id = NEW.author_id;

  IF COALESCE(author_exempt, false) THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pending_revisions
    WHERE author_id = NEW.author_id
    AND created_at > (NOW() - INTERVAL '3 minutes')
  ) THEN
    RAISE EXCEPTION 'Server Rate limit exceeded. You can only submit a revision every 3 minutes.';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."check_revision_rate_limit"() OWNER TO "postgres";

-- The roster needs to show the flag, so list_personnel returns it. Same
-- SECURITY DEFINER shape and the same checklist as the original: caller check
-- first, revoke the inherited grant, pin search_path, grant explicitly.
--
-- DROP first, and this is not optional. list_personnel already returns four
-- columns; adding a fifth changes its return type, and CREATE OR REPLACE
-- cannot do that - Postgres raises 42P13 "cannot change return type of
-- existing function". The first version of this migration omitted the DROP,
-- failed on exactly that, and because migrations run in a transaction it took
-- the column, the trigger and the new RPC down with it: the merge went
-- through, the PR was green, and nothing reached the database.
--
-- Dropping also drops the grants, which is why they are restated below rather
-- than assumed to survive.
DROP FUNCTION IF EXISTS "public"."list_personnel"();

CREATE OR REPLACE FUNCTION "public"."list_personnel"()
RETURNS TABLE (
    "user_id" uuid,
    "email" text,
    "role" text,
    "joined_at" timestamptz,
    "bypass_cooldown" boolean
)
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF "public"."get_my_role"() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Permission denied: only an administrator may list personnel.'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT ur.user_id, u.email::text, ur.role, ur.created_at, ur.bypass_cooldown
    FROM "public"."user_roles" ur
    JOIN "auth"."users" u ON u.id = ur.user_id
    ORDER BY ur.created_at;
END;
$$;

ALTER FUNCTION "public"."list_personnel"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."list_personnel"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."list_personnel"() FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."list_personnel"() TO "authenticated";

-- Setting a capability is its own RPC rather than a direct UPDATE, for the
-- same reason assign_role_by_email is: user_roles has no UPDATE policy for
-- anyone but the row's owner, and handing clients one would let any user set
-- their own flags.
--
-- Deliberately cannot create a row. A capability is an extra on top of a
-- role, so there has to be a role to extend - and an INSERT here would be a
-- second way to grant access, competing with assign_role_by_email and the
-- UNIQUE(user_id) constraint that keeps it honest.
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
    -- Caller check first, before reading auth.users or writing anything.
    IF "public"."get_my_role"() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Permission denied: only an administrator may change capabilities.'
            USING ERRCODE = '42501';
    END IF;

    -- Whitelisted, not interpolated. The column name reaching a dynamic
    -- statement from the client is how a setter like this becomes an
    -- arbitrary-write primitive.
    IF "capability" IS DISTINCT FROM 'bypass_cooldown' THEN
        RAISE EXCEPTION 'Unknown capability: %', "capability" USING ERRCODE = '22023';
    END IF;

    SELECT id INTO target_id FROM "auth"."users" WHERE email = "target_email";
    IF target_id IS NULL THEN
        RAISE EXCEPTION 'No account found for %', "target_email" USING ERRCODE = 'P0002';
    END IF;

    UPDATE "public"."user_roles"
    SET "bypass_cooldown" = "enabled"
    WHERE "user_id" = target_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No role assigned to % - give them a role before granting a capability.', "target_email"
            USING ERRCODE = 'P0002';
    END IF;

    RETURN format('%s %s for %s.', "capability", CASE WHEN "enabled" THEN 'enabled' ELSE 'disabled' END, "target_email");
END;
$$;

ALTER FUNCTION "public"."set_user_capability"(text, text, boolean) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."set_user_capability"(text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."set_user_capability"(text, text, boolean) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."set_user_capability"(text, text, boolean) TO "authenticated";
