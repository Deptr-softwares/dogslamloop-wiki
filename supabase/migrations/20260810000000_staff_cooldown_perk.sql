-- fix/reviewer-workflow: the 3-minute submission cooldown becomes skippable
-- for staff, under an owner-controlled switch.
--
-- The cooldown exists in two places and only one of them is real:
--
--   * js/editor-core.js keeps a localStorage timestamp. That is UX, and it is
--     bypassed by clearing site data.
--   * check_revision_rate_limit() is a trigger on pending_revisions that
--     RAISEs on any insert within 3 minutes of that author's last one. That
--     is the actual boundary.
--
-- So changing only the client would move a trusted editor from a friendly
-- message to a raw Postgres exception, which is a worse experience than the
-- cooldown it was meant to remove. Both move together; this is the half that
-- matters.
--
-- The trigger had no role awareness at all - it filtered on author_id alone.
-- With ~30 contributors filling in pages for the completeness push, a
-- 3-minute wait between submissions is real friction on exactly the people
-- doing the bulk work, and none of it is spam.
--
-- The owner asked for this as a perk switch rather than a constant, so it
-- lives in a settings row they can toggle from owner.html instead of needing
-- a migration to reverse.

-- A separate singleton from site_meta on purpose. site_meta is *content*:
-- publicly readable, and regenerated into the committed data/site_meta.json
-- that every page on the site downloads. An operational policy flag has no
-- business in that artifact. Same id/CHECK singleton trick, different table,
-- different lifecycle.
CREATE TABLE IF NOT EXISTS "public"."site_settings" (
    "id" boolean PRIMARY KEY DEFAULT true,
    -- Applies to trusted_editor, reviewer and admin. Default true because
    -- that is the behaviour being asked for; the switch exists so it can be
    -- turned off without a migration if it is ever abused.
    "staff_bypass_submission_cooldown" boolean NOT NULL DEFAULT true,
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "site_settings_singleton" CHECK ("id" = true)
);

ALTER TABLE "public"."site_settings" OWNER TO "postgres";

ALTER TABLE "public"."site_settings" ENABLE ROW LEVEL SECURITY;

-- Public read. Two callers need it and neither is privileged: the trigger
-- below reads it while running as the *inserting* user (it is not SECURITY
-- DEFINER, so an admin-only policy would make every staff insert fail), and
-- js/editor-core.js reads it to decide whether to show the cooldown message.
-- Nothing here is sensitive - whether staff skip a rate limit is not a secret,
-- and knowing it grants nothing, since the trigger enforces it regardless.
CREATE POLICY "Public can read site settings" ON "public"."site_settings"
    FOR SELECT USING (true);

-- Operational policy is structural, so admin-only, matching site_meta.
CREATE POLICY "Admins can manage site settings" ON "public"."site_settings"
    TO "authenticated"
    USING (("public"."get_my_role"() = 'admin'::text))
    WITH CHECK (("public"."get_my_role"() = 'admin'::text));

-- Policies without matching grants return 401 before RLS is consulted. This
-- project has been caught by that twice, so grants are always stated.
GRANT SELECT ON TABLE "public"."site_settings" TO "anon";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."site_settings" TO "authenticated";

INSERT INTO "public"."site_settings" ("id") VALUES (true) ON CONFLICT ("id") DO NOTHING;

-- The rate limiter, now role-aware.
--
-- Deliberately not SECURITY DEFINER: it needs no elevated access. It reads
-- site_settings (public SELECT above) and calls get_my_role(), which is
-- already SECURITY DEFINER and resolves auth.uid() to the caller - the
-- inserting user - which is exactly who should be measured here.
CREATE OR REPLACE FUNCTION "public"."check_revision_rate_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  bypass_enabled boolean;
  caller_role text;
BEGIN
  SELECT staff_bypass_submission_cooldown INTO bypass_enabled
    FROM site_settings WHERE id = true;

  caller_role := get_my_role();

  -- Positive IN test, so the NULL case fails safe on its own: get_my_role()
  -- returns NULL for a signed-in user with no role, and `NULL IN (...)` is
  -- NULL rather than true, so an ordinary contributor falls through to the
  -- limit below. This is the same NULL trap the codebase hits with `<>`, just
  -- pointing the harmless way for once. COALESCE guards the settings row
  -- being absent, which must also mean "enforce".
  IF COALESCE(bypass_enabled, false)
     AND caller_role IN ('trusted_editor', 'reviewer', 'admin') THEN
    RETURN NEW;
  END IF;

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
