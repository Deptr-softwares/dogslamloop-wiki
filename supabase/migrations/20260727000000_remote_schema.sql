-- Baseline schema, captured via `supabase db dump --linked --schema public`
-- against the production project (gtqswjspxymjdopljmfi) on 2026-07-31.
--
-- This replaces an earlier hand-authored version of this migration that was
-- missing get_my_role(), assign_role_by_email(), check_revision_rate_limit(),
-- archive_page_version(), their triggers, the page_history index, and the
-- table/function GRANTs - all of which existed live in production (created
-- directly via the SQL editor) but were never captured in version control.
-- That gap broke Supabase's PR preview-branch check: replaying the old
-- migration against a fresh database failed on the first RLS policy that
-- references get_my_role(), since the function didn't exist yet.
--
-- Not captured here: rls_auto_enable(), an event-trigger function that also
-- exists live (auto-enables RLS on newly created public-schema tables) - its
-- CREATE EVENT TRIGGER registration isn't schema-scoped and isn't included
-- by `supabase db dump`, even unrestricted. It's a defensive convenience,
-- not required for anything in this repo to function; add it separately if
-- ever needed by pulling it directly from the production database.

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE SCHEMA IF NOT EXISTS "public";

ALTER SCHEMA "public" OWNER TO "pg_database_owner";

COMMENT ON SCHEMA "public" IS 'standard public schema';

CREATE OR REPLACE FUNCTION "public"."archive_page_version"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Only archive if the data actually changed
    IF (OLD.desc_data IS DISTINCT FROM NEW.desc_data OR OLD.frame_data IS DISTINCT FROM NEW.frame_data) THEN
        INSERT INTO public.page_history (page_id, desc_data, frame_data, updated_by_user)
        VALUES (
            OLD.page_id,
            OLD.desc_data,
            OLD.frame_data,
            'System Trigger'
        );
    END IF;
    RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."archive_page_version"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."assign_role_by_email"("target_email" "text", "assigned_role" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    target_user_id UUID;
    role_exists BOOLEAN;
BEGIN
    -- Find the exact user ID from the protected auth schema
    SELECT id INTO target_user_id FROM auth.users WHERE email = target_email;

    -- Failsafe: Did they typo the email?
    IF target_user_id IS NULL THEN
        RETURN 'Error: User with this email not found.';
    END IF;

    -- Check if the user already possesses this exact role
    SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = target_user_id AND role = assigned_role
    ) INTO role_exists;

    -- The Smart Toggle Logic
    IF role_exists THEN
        -- If they have it, REVOKE IT.
        DELETE FROM public.user_roles
        WHERE user_id = target_user_id AND role = assigned_role;

        RETURN 'Successfully REVOKED the ' || upper(assigned_role) || ' role from ' || target_email;
    ELSE
        -- If they don't have it, GRANT IT.
        INSERT INTO public.user_roles (user_id, role)
        VALUES (target_user_id, assigned_role);

        RETURN 'Successfully GRANTED the ' || upper(assigned_role) || ' role to ' || target_email;
    END IF;
END;
$$;

ALTER FUNCTION "public"."assign_role_by_email"("target_email" "text", "assigned_role" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."check_revision_rate_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pending_revisions
    WHERE author_id = NEW.author_id
    AND created_at > (NOW() - INTERVAL '3 minutes')
  ) THEN
    -- If they submitted within the last 3 minutes, outright reject the insertion
    RAISE EXCEPTION 'Server Rate limit exceeded. You can only submit a revision every 3 minutes.';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."check_revision_rate_limit"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."get_my_role"() RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid();
$$;

ALTER FUNCTION "public"."get_my_role"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;

ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";

CREATE TABLE IF NOT EXISTS "public"."page_data" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "page_id" "text",
    "desc_data" "jsonb",
    "frame_data" "jsonb",
    "page_type" "text" DEFAULT 'character'::"text"
);

ALTER TABLE "public"."page_data" OWNER TO "postgres";

ALTER TABLE "public"."page_data" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."character_data_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE IF NOT EXISTS "public"."page_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "page_id" "text" NOT NULL,
    "desc_data" "jsonb" NOT NULL,
    "frame_data" "jsonb" NOT NULL,
    "updated_by_user" "text",
    "version_timestamp" timestamp with time zone DEFAULT "now"(),
    "page_type" "text"
);

ALTER TABLE "public"."page_history" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."pending_revisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "page_id" "text" NOT NULL,
    "desc_data" "jsonb",
    "frame_data" "jsonb",
    "author_id" "uuid" NOT NULL,
    "author_name" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "supporters" "uuid"[] DEFAULT '{}'::"uuid"[],
    "ticket_chat" "jsonb" DEFAULT '[]'::"jsonb",
    "opposers" "uuid"[] DEFAULT '{}'::"uuid"[],
    "qa_metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "page_type" "text" DEFAULT 'character'::"text",
    "target_scope" "text",
    "target_key" "text",
    "is_delta" boolean DEFAULT false,
    "delta_payload" "jsonb"
);

ALTER TABLE "public"."pending_revisions" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."user_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid" NOT NULL,
    "message" "text" NOT NULL,
    "link" "text",
    "is_read" boolean DEFAULT false
);

ALTER TABLE "public"."user_notifications" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    CONSTRAINT "user_roles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'reviewer'::"text", 'trusted_editor'::"text", 'contributor'::"text", 'viewer'::"text"])))
);

ALTER TABLE "public"."user_roles" OWNER TO "postgres";

ALTER TABLE ONLY "public"."page_data"
    ADD CONSTRAINT "character_data_character_id_key" UNIQUE ("page_id");

ALTER TABLE ONLY "public"."page_data"
    ADD CONSTRAINT "character_data_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."page_data"
    ADD CONSTRAINT "character_id_unique" UNIQUE ("page_id");

ALTER TABLE ONLY "public"."page_history"
    ADD CONSTRAINT "page_history_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."pending_revisions"
    ADD CONSTRAINT "pending_revisions_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."user_notifications"
    ADD CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id", "role");

CREATE INDEX "idx_page_history_lookup" ON "public"."page_history" USING "btree" ("page_id", "version_timestamp" DESC);

CREATE OR REPLACE TRIGGER "enforce_rate_limit" BEFORE INSERT ON "public"."pending_revisions" FOR EACH ROW EXECUTE FUNCTION "public"."check_revision_rate_limit"();

CREATE OR REPLACE TRIGGER "trigger_archive_page_before_update" BEFORE UPDATE ON "public"."page_data" FOR EACH ROW EXECUTE FUNCTION "public"."archive_page_version"();

ALTER TABLE ONLY "public"."pending_revisions"
    ADD CONSTRAINT "pending_revisions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id");

ALTER TABLE ONLY "public"."user_notifications"
    ADD CONSTRAINT "user_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");

ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

CREATE POLICY "Admin Write Live Data" ON "public"."page_data" TO "authenticated" USING (("public"."get_my_role"() = ANY (ARRAY['admin'::"text", 'reviewer'::"text"]))) WITH CHECK (("public"."get_my_role"() = ANY (ARRAY['admin'::"text", 'reviewer'::"text"])));

CREATE POLICY "Guests can submit revisions" ON "public"."pending_revisions" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "author_id"));

CREATE POLICY "Public Read Live Data" ON "public"."page_data" FOR SELECT USING (true);

CREATE POLICY "Staff can manage queue" ON "public"."pending_revisions" USING (("public"."get_my_role"() = ANY (ARRAY['admin'::"text", 'reviewer'::"text"])));

CREATE POLICY "Staff can view queue" ON "public"."pending_revisions" FOR SELECT USING (("public"."get_my_role"() = ANY (ARRAY['admin'::"text", 'reviewer'::"text"])));

CREATE POLICY "Staff insert notifications" ON "public"."user_notifications" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_my_role"() = ANY (ARRAY['admin'::"text", 'reviewer'::"text"])));

CREATE POLICY "Users can read own role" ON "public"."user_roles" FOR SELECT USING (("auth"."uid"() = "user_id"));

CREATE POLICY "Users delete own notifications" ON "public"."user_notifications" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));

CREATE POLICY "Users read own notifications" ON "public"."user_notifications" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));

ALTER TABLE "public"."page_data" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."page_history" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."pending_revisions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."user_notifications" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_my_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_role"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM PUBLIC;

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."page_data" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."page_data" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."page_data" TO "service_role";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."page_history" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."page_history" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."page_history" TO "service_role";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pending_revisions" TO "anon";
GRANT ALL ON TABLE "public"."pending_revisions" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."pending_revisions" TO "service_role";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_notifications" TO "anon";
GRANT ALL ON TABLE "public"."user_notifications" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_notifications" TO "service_role";

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_roles" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_roles" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."user_roles" TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";
