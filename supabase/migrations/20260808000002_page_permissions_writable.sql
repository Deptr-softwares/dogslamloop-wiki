-- v0.10: make page_permissions manageable, and make required_role mean
-- something.
--
-- Two problems with the table as it stood since 20260731000000:
--
-- 1. No write path at all. It had a public-read policy and read grants, but
--    no write policy and no write grant, so the only rows that have ever
--    existed are the three seeded by that migration's INSERT. Adding a
--    restricted page meant writing SQL by hand.
--
-- 2. required_role was decorative. Both gates that consult this table only
--    ask "is this page listed?" and then require admin-or-trusted_editor -
--    the "Guests can submit revisions" policy below, and the client-side
--    check in js/editor-core.js. A column named required_role that nothing
--    reads is worse than no column: it looks like configuration and silently
--    is not.
--
-- Owner-confirmed rollout: required_role becomes real, but every currently
-- restricted page is explicitly (re)set to 'trusted_editor' first, so nobody
-- loses access the day this deploys. Tightening a specific page to 'admin' is
-- then a deliberate action taken through owner.html, not a side effect of
-- this migration.

-- --- 1. Preserve today's effective access, explicitly. ---
-- These three are already 'trusted_editor' (that is the column default), but
-- stating it means the migration cannot quietly change behaviour if any row
-- was ever altered by hand.
UPDATE "public"."page_permissions"
SET "required_role" = 'trusted_editor'
WHERE "page_id" IN ('template', 'tierlist', 'writing_guide');

-- --- 2. Give the table a write path, admin only. ---
-- Deciding who may edit which pages is governance, so it sits with admins
-- rather than with reviewers, matching site_posts rather than page_data.
CREATE POLICY "Admins can manage page permissions" ON "public"."page_permissions"
    TO "authenticated"
    USING (("public"."get_my_role"() = 'admin'::text))
    WITH CHECK (("public"."get_my_role"() = 'admin'::text));

-- The policy alone is not enough: without the table-level grant PostgREST
-- returns 401 before RLS is ever consulted. This project has been caught by
-- that twice (page_history's missing SELECT grant, anon's missing grant on
-- pending_revisions), so grants are always stated alongside policies here.
GRANT INSERT, UPDATE, DELETE ON TABLE "public"."page_permissions" TO "authenticated";

-- --- 3. Make required_role actually gate submissions. ---
-- Replaces the "listed at all?" test with a comparison against the row's own
-- required_role. Admin satisfies every level; trusted_editor satisfies only
-- rows that ask for trusted_editor.
DROP POLICY IF EXISTS "Guests can submit revisions" ON "public"."pending_revisions";

CREATE POLICY "Guests can submit revisions" ON "public"."pending_revisions"
FOR INSERT TO "authenticated"
WITH CHECK (
    "auth"."uid"() = "author_id"
    AND (
        -- Unrestricted page: anyone signed in may submit, as before.
        NOT EXISTS (
            SELECT 1 FROM "public"."page_permissions" "pp"
            WHERE "pp"."page_id" = "pending_revisions"."page_id"
        )
        OR EXISTS (
            SELECT 1 FROM "public"."page_permissions" "pp"
            WHERE "pp"."page_id" = "pending_revisions"."page_id"
              AND (
                  "public"."get_my_role"() = 'admin'::text
                  OR ("pp"."required_role" = 'trusted_editor'::text
                      AND "public"."get_my_role"() = 'trusted_editor'::text)
              )
        )
    )
);
