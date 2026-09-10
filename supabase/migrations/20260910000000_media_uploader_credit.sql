-- v0.19 F8: Media Library uploader credit.
--
-- Deferred through v0.16, v0.17 and v0.18. The thing it was waiting for -
-- a person record with a display name - shipped in v0.17, so this is now just
-- "record who uploaded a file, and show it".
--
--
-- WHY A NEW TABLE RATHER THAN A COLUMN ON media_moderation
--
-- The owner's call was to record the uploader in a table we write ourselves at
-- upload time, rather than reaching into storage.objects.owner_id with a
-- SECURITY DEFINER function. That is what this does. The column was originally
-- going to be `media_moderation.uploaded_by`, beside `reviewed_by`, and it
-- cannot go there.
--
-- media_moderation is an OVERLAY on the bucket, not a register of it, and its
-- own header says so: **absence of a row means unchecked**. The queue is built
-- client-side as "every object in the bucket, minus the paths listed here" -
-- see js/admin-media-queue.js, where the line is literally
--
--     status: record ? record.status : 'unchecked',
--
-- So writing a row at upload time to hold the uploader would give every new
-- upload a row, and `status` is NOT NULL with CHECK (status IN
-- ('approved','flagged')) - meaning the row would have to claim one of those.
-- Every upload would arrive pre-approved and the moderation queue would be
-- permanently empty. Nobody would notice until something bad got through.
--
-- It also costs the three properties that header lists as the reason for the
-- overlay shape: contributors would need an INSERT policy on the moderation
-- table (the "insert your own row" policy it was designed not to have), the
-- upload path would gain something to remember, and un-approving - which is
-- DELETE - would erase the uploader credit as a side effect.
--
-- Uploader credit is REGISTRY data: it is true of every file. Moderation is
-- JUDGEMENT data: it is true only of files somebody looked at. Two lifetimes,
-- two tables. This one may hold a row for a file nobody has ever reviewed,
-- which is exactly what media_moderation must never do.
--
--
-- WHAT IT CANNOT DO
--
-- Only files uploaded AFTER this migration get a row. The ~198 already in the
-- bucket have no recorded uploader anywhere this project can read, and there is
-- no honest way to invent one - the same reasoning that left reviewed_by NULL
-- on the seed rows in 20260812000002. Absence renders as "Unknown", not as a
-- guess. The owner accepted this trade when choosing this option over reading
-- storage.objects.owner_id.

CREATE TABLE IF NOT EXISTS "public"."media_uploads" (
    -- The object name inside the wiki-media bucket - what storage.objects.name
    -- holds and what every stored URL ends with. Same key as
    -- media_moderation.path, deliberately, so the two join without a mapping.
    "path" text NOT NULL,

    -- ON DELETE SET NULL rather than a bare reference: accounts are removable
    -- (anonymize_user_by_email), and pending_revisions.author_id already taught
    -- this project that a reference to auth.users with no ON DELETE clause
    -- turns account deletion into a constraint violation. A deleted account
    -- leaves the row with the upload time intact and no name, which reads as
    -- "Unknown" - matching what the privacy policy promises about edits.
    "uploaded_by" uuid REFERENCES "auth"."users"("id") ON DELETE SET NULL,

    "uploaded_at" timestamptz DEFAULT now() NOT NULL,

    CONSTRAINT "media_uploads_pkey" PRIMARY KEY ("path")
);

ALTER TABLE "public"."media_uploads" OWNER TO "postgres";

ALTER TABLE "public"."media_uploads" ENABLE ROW LEVEL SECURITY;

-- Visible to anyone signed in, because the Media Library itself is: the bucket's
-- "Auth List Media" policy is SELECT TO authenticated, so nobody who cannot
-- already see the file list can see this. Display names are public throughout
-- the site - a submission carries one into the page history - so this exposes
-- nothing that contributing does not already expose.
--
-- Deliberately NOT granted to anon. The credit is shown inside the editor's
-- Media Library, never on a reader-facing page, and a logged-out visitor has no
-- surface that needs it.
CREATE POLICY "Signed-in users can see who uploaded what" ON "public"."media_uploads"
    FOR SELECT TO "authenticated"
    USING (true);

-- You may record an upload as YOURSELF and no one else. `uploaded_by =
-- auth.uid()` is the whole guard: auth.uid() is NULL for anon, and NULL = NULL
-- is NULL rather than true, so an anonymous caller is denied by the same
-- expression rather than by a separate clause.
--
-- No role check. Uploading is open to any signed-in contributor - that is what
-- the bucket's own INSERT policy allows - so gating the RECORD of an upload
-- more tightly than the upload itself would leave real uploads uncredited and
-- teach the UI to show "Unknown" for perfectly ordinary files.
CREATE POLICY "A user can record their own upload" ON "public"."media_uploads"
    FOR INSERT TO "authenticated"
    WITH CHECK ("uploaded_by" = "auth"."uid"());

-- No UPDATE policy, on purpose. js/editor-media.js refuses an upload that would
-- overwrite an existing filename ("the old name is already live on wiki pages
-- pointing at the old content"), so a path is written once and never changes
-- hands. With no policy there is no UPDATE, and a row therefore cannot be
-- rewritten to credit somebody else.

-- Deletion follows the file. can_delete_media() is the same capability that
-- gates removing the object from the bucket (20260813000003), so the row and
-- the file it describes are removable by exactly the same people - a row
-- outliving its file would be a permanent orphan nothing lists.
CREATE POLICY "Whoever can delete the media can clear its record" ON "public"."media_uploads"
    FOR DELETE TO "authenticated"
    USING ("public"."can_delete_media"());

-- A policy without a matching table GRANT yields a 401 before RLS is ever
-- consulted, so the policy looks broken for a reason the policy cannot explain.
-- This project has been bitten by that twice.
GRANT SELECT, INSERT, DELETE ON TABLE "public"."media_uploads" TO "authenticated";

-- Reading the library by uploader is not a feature, but the join in
-- js/editor-media.js fetches every row for the page of files on screen, and
-- this keeps that a lookup rather than a scan as the bucket grows.
CREATE INDEX IF NOT EXISTS "media_uploads_uploaded_by_idx"
    ON "public"."media_uploads" ("uploaded_by");
