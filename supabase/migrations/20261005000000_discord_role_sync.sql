-- v1.0 batch 4: Discord roles follow the wiki.
--
-- Spec: V1.0-DEVLOG.md, "SPEC 2026-10-05: batch 4", D2. The owner, 2026-10-02:
-- "Synced for users who signed in with Discord, manual discord-side for users
-- who signed in via other methods". One way, wiki to Discord: a Discord role
-- never grants a wiki power.
--
-- The relay (supabase/functions/discord-relay) does the giving. This migration
-- only records what it has to do:
--
--   1. Two tables, service role only: which Discord role each wiki meaning is,
--      and per person what the relay last applied.
--   2. Triggers that mark a person as waiting when their role, Moderate tick
--      or expertise changes.
--   3. The relay's functions, each refusing any caller but the service role.
--
-- Nothing here changes who can do what on the wiki.


-- =========================================================================
-- 1. TABLES
-- =========================================================================

-- key is the wiki's meaning ('admin', 'reviewer', 'trusted_editor',
-- 'moderate', 'expert:<page_id>'); the relay finds each role by name once and
-- keeps it by id after that, so a role renamed on Discord keeps working.
CREATE TABLE IF NOT EXISTS "public"."discord_role_map" (
    "key" text NOT NULL,
    "discord_role_id" text NOT NULL,
    "matched_name" text,
    "mapped_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "discord_role_map_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "discord_role_map_role_key" UNIQUE ("discord_role_id"),
    CONSTRAINT "discord_role_map_role_check" CHECK ("discord_role_id" ~ '^[0-9]{5,20}$')
);

ALTER TABLE "public"."discord_role_map" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."discord_role_map" FROM "anon";
REVOKE ALL ON TABLE "public"."discord_role_map" FROM "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."discord_role_map" TO "service_role";

-- One row per person signed in with Discord, made by the relay the first time
-- it sees them.
--
--   synced       the keys the relay last applied. NULL until the first run
--                reaches them, which is what makes that run add-only.
--   taken        keys a wiki ban took off them that the sync had not given
--                (a role given by hand), handed back when the ban is lifted.
--   dirty_at     set: a change is waiting. The relay clears it only if it is
--                still the value it read, so a change made while it worked
--                is not lost.
--   next_try_at  not on the server yet: tried again then.
CREATE TABLE IF NOT EXISTS "public"."discord_role_members" (
    "user_id" uuid NOT NULL,
    "synced" text[],
    "taken" text[] NOT NULL DEFAULT '{}',
    "dirty_at" timestamptz,
    "next_try_at" timestamptz,
    "attempts" integer NOT NULL DEFAULT 0,
    "last_error" text,
    "synced_at" timestamptz,
    CONSTRAINT "discord_role_members_pkey" PRIMARY KEY ("user_id"),
    -- CASCADE: deleting an account must never be blocked by this table.
    CONSTRAINT "discord_role_members_user_fkey" FOREIGN KEY ("user_id")
        REFERENCES "auth"."users"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "discord_role_members_dirty_idx"
    ON "public"."discord_role_members" ("dirty_at") WHERE "dirty_at" IS NOT NULL;

ALTER TABLE "public"."discord_role_members" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."discord_role_members" FROM "anon";
REVOKE ALL ON TABLE "public"."discord_role_members" FROM "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."discord_role_members" TO "service_role";


-- =========================================================================
-- 2. A CHANGE ON THE WIKI MARKS THE PERSON AS WAITING
-- =========================================================================
--
-- Only a person who already has a row: everyone else is picked up by the
-- relay's first-run pass in discord_relay_role_jobs, so nothing here needs to
-- read the auth schema. clock_timestamp(), not now(), so two changes in two
-- transactions never share a value the relay compares against.
--
-- SECURITY DEFINER: the owner tools run as an ordinary signed-in user, who has
-- no grant on discord_role_members.
CREATE OR REPLACE FUNCTION "public"."discord_role_mark_dirty"() RETURNS trigger
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF TG_OP IS DISTINCT FROM 'INSERT' THEN
        UPDATE public.discord_role_members
        SET dirty_at = clock_timestamp(), next_try_at = NULL, attempts = 0
        WHERE user_id = OLD.user_id;
    END IF;
    IF TG_OP IS DISTINCT FROM 'DELETE' THEN
        UPDATE public.discord_role_members
        SET dirty_at = clock_timestamp(), next_try_at = NULL, attempts = 0
        WHERE user_id = NEW.user_id;
    END IF;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION "public"."discord_role_mark_dirty"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_role_mark_dirty"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_role_mark_dirty"() FROM "authenticated";

DROP TRIGGER IF EXISTS "discord_role_on_role" ON "public"."user_roles";
CREATE TRIGGER "discord_role_on_role"
    AFTER INSERT OR DELETE ON "public"."user_roles"
    FOR EACH ROW EXECUTE FUNCTION "public"."discord_role_mark_dirty"();

-- An update that leaves the role and the Moderate tick alone (bypass_cooldown,
-- say) changes nothing on Discord.
DROP TRIGGER IF EXISTS "discord_role_on_role_change" ON "public"."user_roles";
CREATE TRIGGER "discord_role_on_role_change"
    AFTER UPDATE ON "public"."user_roles"
    FOR EACH ROW
    WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id
          OR OLD.role IS DISTINCT FROM NEW.role
          OR OLD.can_moderate IS DISTINCT FROM NEW.can_moderate)
    EXECUTE FUNCTION "public"."discord_role_mark_dirty"();

-- assign_page_expert re-assigning refreshes granted_by with an UPDATE, which
-- changes nothing on Discord, so only INSERT and DELETE count.
DROP TRIGGER IF EXISTS "discord_role_on_expert" ON "public"."page_experts";
CREATE TRIGGER "discord_role_on_expert"
    AFTER INSERT OR DELETE ON "public"."page_experts"
    FOR EACH ROW EXECUTE FUNCTION "public"."discord_role_mark_dirty"();


-- =========================================================================
-- 3. THE RELAY'S FUNCTIONS
-- =========================================================================

-- The people waiting, oldest change first. Before reading, every Discord
-- sign-in without a row gets one, waiting: the first run, and every person
-- who signs in with Discord after it.
--
-- Every column is qualified: the OUT columns of RETURNS TABLE share their
-- names with the table's, and an unqualified one is ambiguous.
CREATE OR REPLACE FUNCTION "public"."discord_relay_role_jobs"("p_limit" integer)
RETURNS TABLE (
    "user_id" uuid,
    "discord_id" text,
    "role" text,
    "can_moderate" boolean,
    "expert_pages" text[],
    "synced" text[],
    "taken" text[],
    "dirty_at" timestamptz
)
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.discord_role_members (user_id, dirty_at)
    SELECT DISTINCT i.user_id, now()
    FROM auth.identities i
    WHERE i.provider = 'discord'
      AND NOT EXISTS (SELECT 1 FROM public.discord_role_members m WHERE m.user_id = i.user_id)
    ON CONFLICT DO NOTHING;

    RETURN QUERY
    SELECT m.user_id, ident.provider_id, ur.role, COALESCE(ur.can_moderate, false),
           COALESCE((SELECT array_agg(pe.page_id ORDER BY pe.page_id)
                     FROM public.page_experts pe WHERE pe.user_id = m.user_id), '{}'::text[]),
           m.synced, m.taken, m.dirty_at
    FROM public.discord_role_members m
    -- A person who unlinked Discord has no id to give a role to: skipped.
    JOIN LATERAL (
        SELECT i.provider_id FROM auth.identities i
        WHERE i.user_id = m.user_id AND i.provider = 'discord'
        LIMIT 1
    ) ident ON true
    LEFT JOIN public.user_roles ur ON ur.user_id = m.user_id
    WHERE m.dirty_at IS NOT NULL
      AND (m.next_try_at IS NULL OR m.next_try_at <= now())
      AND m.attempts < 5
    ORDER BY m.dirty_at, m.user_id
    LIMIT GREATEST(1, LEAST(COALESCE("p_limit", 25), 100));
END;
$$;

-- A person's job finished. With an error: counted, and left waiting. Not on
-- the server (p_retry_at): recorded, and left waiting until then. Otherwise
-- what was applied is recorded and the wait cleared, unless a newer change
-- arrived while the relay worked.
CREATE OR REPLACE FUNCTION "public"."discord_relay_role_done"(
    "p_user_id" uuid, "p_dirty_at" timestamptz, "p_synced" text[], "p_taken" text[],
    "p_retry_at" timestamptz, "p_error" text
)
RETURNS void
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    IF "p_error" IS NOT NULL THEN
        UPDATE public.discord_role_members m
        SET attempts = m.attempts + 1, last_error = left("p_error", 500)
        WHERE m.user_id = "p_user_id";
        RETURN;
    END IF;

    UPDATE public.discord_role_members m
    SET synced = COALESCE("p_synced", '{}'::text[]),
        taken = COALESCE("p_taken", '{}'::text[]),
        synced_at = now(),
        attempts = 0,
        next_try_at = "p_retry_at",
        last_error = CASE WHEN "p_retry_at" IS NULL THEN NULL ELSE 'Not on the server.' END,
        dirty_at = CASE
            WHEN "p_retry_at" IS NULL AND m.dirty_at IS NOT DISTINCT FROM "p_dirty_at" THEN NULL
            ELSE m.dirty_at
        END
    WHERE m.user_id = "p_user_id";
END;
$$;

CREATE OR REPLACE FUNCTION "public"."discord_relay_role_map"()
RETURNS TABLE ("key" text, "discord_role_id" text)
LANGUAGE "plpgsql" STABLE SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT rm.key, rm.discord_role_id FROM public.discord_role_map rm ORDER BY rm.key;
END;
$$;

-- Every page's name, for finding "<name> Expert". Any page can have experts,
-- so no page type is left out.
CREATE OR REPLACE FUNCTION "public"."discord_relay_role_pages"()
RETURNS TABLE ("page_id" text, "name" text)
LANGUAGE "plpgsql" STABLE SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT sp.page_id, sp.name FROM public.site_pages sp
    WHERE COALESCE(sp.name, '') <> ''
    ORDER BY sp.page_id;
END;
$$;

-- A role found by name. A Discord role means one thing, so any other key
-- holding the same id lets it go first.
CREATE OR REPLACE FUNCTION "public"."discord_relay_map_role"(
    "p_key" text, "p_discord_role_id" text, "p_name" text
)
RETURNS void
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    DELETE FROM public.discord_role_map rm
    WHERE rm.discord_role_id = "p_discord_role_id" AND rm.key IS DISTINCT FROM "p_key";

    INSERT INTO public.discord_role_map AS rm (key, discord_role_id, matched_name)
    VALUES ("p_key", "p_discord_role_id", left("p_name", 100))
    ON CONFLICT ON CONSTRAINT discord_role_map_pkey DO UPDATE
    SET discord_role_id = EXCLUDED.discord_role_id,
        matched_name = EXCLUDED.matched_name,
        mapped_at = now();
END;
$$;

-- A role deleted on Discord: forgotten, so it is found by name again if it
-- comes back.
CREATE OR REPLACE FUNCTION "public"."discord_relay_unmap_role"("p_key" text)
RETURNS void
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    DELETE FROM public.discord_role_map rm WHERE rm.key = "p_key";
END;
$$;

REVOKE ALL ON FUNCTION "public"."discord_relay_role_jobs"(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_role_jobs"(integer) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_role_jobs"(integer) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_role_jobs"(integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."discord_relay_role_done"(uuid, timestamptz, text[], text[], timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_role_done"(uuid, timestamptz, text[], text[], timestamptz, text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_role_done"(uuid, timestamptz, text[], text[], timestamptz, text) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_role_done"(uuid, timestamptz, text[], text[], timestamptz, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."discord_relay_role_map"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_role_map"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_role_map"() FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_role_map"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."discord_relay_role_pages"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_role_pages"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_role_pages"() FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_role_pages"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."discord_relay_map_role"(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_map_role"(text, text, text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_map_role"(text, text, text) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_map_role"(text, text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."discord_relay_unmap_role"(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_unmap_role"(text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_unmap_role"(text) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_unmap_role"(text) TO "service_role";
