-- A revision's page_id must be a page id's characters.
--
-- pending_revisions.page_id is whatever the submitter sends. The INSERT policy
-- checks it only through can_submit_to_page(), which passes any page with no
-- page_permissions row, so a direct REST call could submit a revision for a
-- page_id that is not a page at all. admin.html wrote page_id into innerHTML
-- unescaped, and the queue draws on open, so a page_id written as markup ran
-- in a staff member's browser. The client escapes it as of the same release;
-- this closes the input.
--
-- Every page id is lowercase letters, digits, underscores and hyphens
-- (character-hub, source-code). The owner applied this constraint by hand in
-- production on 2026-10-29, after checking no existing row breaks it, so it is
-- dropped and re-added: that leaves exactly this definition everywhere and
-- re-validates every row. The CHECK applies to the author's own UPDATE too.

ALTER TABLE "public"."pending_revisions"
    DROP CONSTRAINT IF EXISTS "pending_revisions_page_id_format";

ALTER TABLE "public"."pending_revisions"
    ADD CONSTRAINT "pending_revisions_page_id_format" CHECK ("page_id" ~ '^[a-z0-9_-]+$');
