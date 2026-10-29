-- A submitted revision must arrive pending.
--
-- "Guests can submit revisions" (last written in 20260827000000) checked who
-- the author is, that they are not banned and that the page is not
-- restricted, but not status. So any signed-in account could insert a row
-- that was already 'approved', with any reviewed_by it liked, straight through
-- the REST API, and it appeared in public History, Recent Changes and the
-- approval counts as a staff approval. It changed no live page. Reproduced on a
-- preview by a trusted_editor account on 2026-10-29.
--
-- The site never sets status on a submission (js/editor-core.js), so every real
-- one already arrives as 'pending', and staff insert through "Staff can manage
-- queue", which this does not touch. The owner applied this policy by hand in
-- production on 2026-10-29 and found no past approval by a non-staff account;
-- it is dropped and recreated so the repo states exactly that definition.

DROP POLICY IF EXISTS "Guests can submit revisions" ON "public"."pending_revisions";

CREATE POLICY "Guests can submit revisions" ON "public"."pending_revisions"
FOR INSERT TO "authenticated"
WITH CHECK (
    "auth"."uid"() = "author_id"
    AND "public"."get_my_role"() IS DISTINCT FROM 'viewer'::text
    AND "public"."can_submit_to_page"("page_id")
    AND "status" = 'pending'
);
