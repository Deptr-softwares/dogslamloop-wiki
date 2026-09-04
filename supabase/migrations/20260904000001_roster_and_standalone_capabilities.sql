-- The owner tools cannot see anyone who does not already hold a role.
--
-- list_personnel() is FROM user_roles ur JOIN auth.users u - an inner join
-- from the ROLE table. A signed-in account with no role has no user_roles row,
-- so it never appears in the roster at all. One fact, three of the owner's
-- reports:
--
--   * "no way to add moderators perk (or any perks) to a regular
--     authenticated user" - there is no row to tick a box on;
--   * "shifting through people mail address on Supabase Dashboard is
--     extremely inconvenient... a new Vessel Expert come to me... he logged in
--     using a burner mail" - the roster can only ever show people who already
--     have roles, so a new expert is unfindable by construction;
--   * and set_user_capability refusing outright: "No role assigned to % - give
--     them a role before granting a capability."
--
-- The owner's call, 2026-09-04: capabilities stand alone. A knowledgeable
-- player with an account and no role should be able to moderate, the same way
-- a page expert already needs no role at all.
--
-- =========================================================================
-- 1. A role becomes optional
-- =========================================================================
-- role is NOT NULL and half of PRIMARY KEY (user_id, role), so today a row
-- CANNOT exist without one - which is why "grant a capability to a roleless
-- account" was not a small change. There is also no neutral role to borrow:
-- 'viewer' is a ban, not a floor.
--
-- Making role nullable is less invasive than it looks, because a NULL role is
-- ALREADY the documented contract everywhere else:
--
--   * get_my_role() returns NULL for a signed-in user with no role, and every
--     comparison against it uses IS DISTINCT FROM for exactly that reason;
--   * role_rank(NULL) is 0, so every rank test already answers correctly;
--   * user_roles_role_check is `role = ANY (ARRAY[...])`, which evaluates to
--     NULL - not FALSE - for a NULL role, so a CHECK constraint passes it
--     without being touched;
--   * the viewer ban is `IS DISTINCT FROM 'viewer'`, which a NULL passes.
--
-- The composite PK is dropped in favour of user_id alone. That is not a new
-- rule - user_roles_one_role_per_user has enforced UNIQUE(user_id) since
-- 20260801000000, precisely because two rows broke get_my_role() for that user
-- everywhere. The PK is dropped to it rather than alongside it so there is one
-- unique index on user_id and not two: ON CONFLICT ("user_id") has to infer an
-- arbiter index, and leaving two identical candidates is asking for trouble
-- later even where it resolves today.
--
-- One role per user is unchanged. The only thing that changes is that the
-- number of roles a row may carry is now zero or one, rather than exactly one.

ALTER TABLE "public"."user_roles" DROP CONSTRAINT IF EXISTS "user_roles_pkey";
ALTER TABLE "public"."user_roles" DROP CONSTRAINT IF EXISTS "user_roles_one_role_per_user";
ALTER TABLE "public"."user_roles" ALTER COLUMN "role" DROP NOT NULL;
ALTER TABLE "public"."user_roles" ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id");

-- =========================================================================
-- 2. set_user_capability creates the row it needs
-- =========================================================================
-- Was: UPDATE, then RAISE if NOT FOUND. Now an upsert, so the first capability
-- granted to a roleless account creates a row carrying that capability and no
-- role.
--
-- The reverse matters as much: turning the last capability off an account that
-- has no role leaves a row that means nothing - no role, no capabilities - and
-- those would accumulate in the roster forever. It is deleted instead, so the
-- roster keeps showing people rather than residue.
--
-- The capability name is still whitelisted rather than interpolated. A column
-- name reaching a dynamic statement from the client is how a setter like this
-- becomes an arbitrary-write primitive.

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
    remaining record;
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
        INSERT INTO "public"."user_roles" ("user_id", "bypass_cooldown")
        VALUES (target_id, "enabled")
        ON CONFLICT ("user_id") DO UPDATE SET "bypass_cooldown" = EXCLUDED."bypass_cooldown";
    ELSIF "capability" = 'can_moderate' THEN
        INSERT INTO "public"."user_roles" ("user_id", "can_moderate")
        VALUES (target_id, "enabled")
        ON CONFLICT ("user_id") DO UPDATE SET "can_moderate" = EXCLUDED."can_moderate";
    ELSE
        INSERT INTO "public"."user_roles" ("user_id", "can_delete_media")
        VALUES (target_id, "enabled")
        ON CONFLICT ("user_id") DO UPDATE SET "can_delete_media" = EXCLUDED."can_delete_media";
    END IF;

    -- Sweep the row away if nothing is left on it. Only ever true for an
    -- account with no role: a role-holder's row stays whatever the flags say.
    SELECT "role", "bypass_cooldown", "can_moderate", "can_delete_media"
    INTO remaining
    FROM "public"."user_roles" WHERE "user_id" = target_id;

    IF remaining."role" IS NULL
       AND COALESCE(remaining."bypass_cooldown", false) = false
       AND COALESCE(remaining."can_moderate", false) = false
       AND COALESCE(remaining."can_delete_media", false) = false THEN
        DELETE FROM "public"."user_roles" WHERE "user_id" = target_id;
    END IF;

    RETURN format('%s %s for %s.', "capability", CASE WHEN "enabled" THEN 'enabled' ELSE 'disabled' END, "target_email");
END;
$$;

ALTER FUNCTION "public"."set_user_capability"(text, text, boolean) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."set_user_capability"(text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."set_user_capability"(text, text, boolean) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."set_user_capability"(text, text, boolean) TO "authenticated";

-- =========================================================================
-- 3. Finding somebody who is not on the roster yet
-- =========================================================================
-- The owner's actual scenario, quoted because it is the whole design brief:
-- "a new Vessel Expert come to me and show me how good he is and he want the
-- tag on the site, now he logged in using a burner mail expecting that I don't
-- talk about it. Now it is impossible for me to shift through the list just to
-- find the email to assign it to him."
--
-- So the search has to work from the DISPLAY NAME, not only the address - the
-- name is the only thing the owner actually knows. Resolved with the same
-- COALESCE chain the rest of the schema uses (20260813000001 and friends), so
-- the roster shows the person the same way every other surface does.
--
-- LEFT JOIN, deliberately: an account with no user_roles row is exactly who
-- this is for, and an inner join here would reproduce the bug it exists to fix.
--
-- Emails are personal data and this returns them, so: owner only, guarded
-- inside the function rather than by the grant, and never reachable by anon.
-- A blank or one-character query returns nothing rather than the whole user
-- table - this is a lookup, not an export.

CREATE OR REPLACE FUNCTION "public"."search_users"(
    "search_query" text,
    "max_results" integer DEFAULT 25
)
RETURNS TABLE (
    "user_id" uuid,
    "email" text,
    "display_name" text,
    "role" text,
    "joined_at" timestamptz,
    "bypass_cooldown" boolean,
    "can_moderate" boolean,
    "can_delete_media" boolean
)
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    needle text;
BEGIN
    IF NOT "public"."is_owner"() THEN
        RAISE EXCEPTION 'Permission denied: only the owner may search accounts.'
            USING ERRCODE = '42501';
    END IF;

    needle := btrim(COALESCE("search_query", ''));
    IF length(needle) < 2 THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        u.id,
        u.email::text,
        COALESCE(
            NULLIF(u.raw_user_meta_data->>'display_name', ''),
            NULLIF(u.raw_user_meta_data->>'full_name', ''),
            NULLIF(split_part(COALESCE(u.email, ''), '@', 1), ''),
            'Unknown'
        )::text,
        ur."role",
        u.created_at,
        COALESCE(ur."bypass_cooldown", false),
        COALESCE(ur."can_moderate", false),
        COALESCE(ur."can_delete_media", false)
    FROM "auth"."users" u
    LEFT JOIN "public"."user_roles" ur ON ur."user_id" = u.id
    WHERE u.email ILIKE '%' || needle || '%'
       OR COALESCE(u.raw_user_meta_data->>'display_name', '') ILIKE '%' || needle || '%'
       OR COALESCE(u.raw_user_meta_data->>'full_name', '') ILIKE '%' || needle || '%'
    -- People who already hold something first: when the owner searches a name
    -- they half-remember, the staff member is far more likely to be who they
    -- meant than a reader who happens to match.
    ORDER BY (ur."user_id" IS NULL), u.created_at
    LIMIT GREATEST(1, LEAST(COALESCE("max_results", 25), 100));
END;
$$;

ALTER FUNCTION "public"."search_users"(text, integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."search_users"(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."search_users"(text, integer) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."search_users"(text, integer) TO "authenticated";

-- =========================================================================
-- 4. list_personnel needs no join change
-- =========================================================================
-- Worth stating so the next reader does not "fix" it: once a capability can
-- exist without a role, a roleless moderator HAS a user_roles row, so the
-- existing inner join finds them. What changes is that ur.role may now be
-- NULL in the result, which js/owner.js must render as something other than
-- undefined. That is a client change, not a SQL one.
