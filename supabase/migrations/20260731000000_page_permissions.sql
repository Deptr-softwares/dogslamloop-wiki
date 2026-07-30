-- Closes a server-side enforcement gap: js/editor.js's `exclusivePages`
-- array (template/tierlist/writing_guide) restricting submissions to
-- admin/trusted_editor was enforced only client-side. The
-- "Guests can submit revisions" policy on pending_revisions only checked
-- auth.uid() = author_id, with no awareness of page_id or role, so any
-- authenticated user could bypass the UI gate by calling the Supabase
-- client directly.

CREATE TABLE IF NOT EXISTS "public"."page_permissions" (
    "page_id" "text" PRIMARY KEY,
    "required_role" "text" NOT NULL DEFAULT 'trusted_editor'
        CHECK ("required_role" = ANY (ARRAY['trusted_editor'::"text", 'admin'::"text"]))
);

ALTER TABLE "public"."page_permissions" OWNER TO "postgres";

ALTER TABLE "public"."page_permissions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read page permissions" ON "public"."page_permissions"
FOR SELECT USING (true);

-- character_dashboard/side_dashboard (present in editor.js's old hardcoded
-- array) are deliberately not seeded here - they don't correspond to any
-- real page (navigation.json has no matching id, and neither page ever
-- calls into the edit pipeline).
INSERT INTO "public"."page_permissions" ("page_id", "required_role") VALUES
    ('template', 'trusted_editor'),
    ('tierlist', 'trusted_editor'),
    ('writing_guide', 'trusted_editor')
ON CONFLICT ("page_id") DO NOTHING;

GRANT SELECT ON TABLE "public"."page_permissions" TO "anon";
GRANT SELECT ON TABLE "public"."page_permissions" TO "authenticated";

DROP POLICY IF EXISTS "Guests can submit revisions" ON "public"."pending_revisions";

CREATE POLICY "Guests can submit revisions" ON "public"."pending_revisions"
FOR INSERT TO "authenticated"
WITH CHECK (
    "auth"."uid"() = "author_id"
    AND (
        NOT EXISTS (
            SELECT 1 FROM "public"."page_permissions" "pp"
            WHERE "pp"."page_id" = "pending_revisions"."page_id"
        )
        OR "public"."get_my_role"() = ANY (ARRAY['admin'::"text", 'trusted_editor'::"text"])
    )
);
