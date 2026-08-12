-- v0.13 item 1: media moderation.
--
-- Deliberately light, as the owner scoped it: unchecked media stays fully
-- usable and visible, a queue lists what nobody has looked at yet, and a
-- flagged item stops rendering. Deletion of the file itself is not this
-- table's job and stays where it already is.
--
-- The shape worth explaining: this is an OVERLAY on the bucket, not a
-- register of it. **Absence of a row means unchecked.** Only ever holding a
-- row for media somebody has actually judged buys three things:
--
--   * uploading needs no write permission here at all, so contributors never
--     touch this table and there is no "insert your own row" policy to get
--     wrong. Staff are the only writers.
--   * new uploads are unchecked automatically, with nothing to remember in
--     the upload path and nothing to go stale if that path is bypassed.
--   * un-approving is DELETE, which needs no third status and cannot leave a
--     row saying something nobody meant.
--
-- The queue is therefore "every object in the bucket, minus the paths listed
-- here", assembled client-side. At 198 files that is one storage list and one
-- small select.
--
-- `path` is the object name inside the wiki-media bucket, which is what
-- storage.objects.name holds and what every stored URL ends with.

CREATE TABLE IF NOT EXISTS "public"."media_moderation" (
    "path" text NOT NULL,
    "status" text NOT NULL,
    "reviewed_at" timestamptz DEFAULT now() NOT NULL,
    -- ON DELETE SET NULL rather than a bare reference: accounts are removable
    -- (anonymize_user_by_email), and pending_revisions.author_id already
    -- taught this project that a reference to auth.users with no ON DELETE
    -- clause turns account deletion into a constraint violation.
    "reviewed_by" uuid REFERENCES "auth"."users"("id") ON DELETE SET NULL,
    -- Why it was flagged. NOTE: readable by anyone for flagged rows, because
    -- the public policy below has to expose those rows for the site to know
    -- what to hide. Do not write anything here that should not be public.
    "note" text,
    CONSTRAINT "media_moderation_pkey" PRIMARY KEY ("path"),
    CONSTRAINT "media_moderation_status_check" CHECK ("status" = ANY (ARRAY['approved'::text, 'flagged'::text]))
);

ALTER TABLE "public"."media_moderation" OWNER TO "postgres";

ALTER TABLE "public"."media_moderation" ENABLE ROW LEVEL SECURITY;

-- Readers get flagged rows and nothing else. The live site needs exactly one
-- fact from this table - "is this file blocked" - and approved rows are the
-- overwhelming majority, so exposing only flagged keeps that request tiny and
-- keeps who-approved-what out of public view.
CREATE POLICY "Public can see which media is blocked" ON "public"."media_moderation"
    FOR SELECT USING ("status" = 'flagged');

-- Staff see the whole overlay, which is what makes the queue's "approved"
-- filter possible.
CREATE POLICY "Staff can view all moderation records" ON "public"."media_moderation"
    FOR SELECT TO "authenticated"
    USING (("public"."get_my_role"() = ANY (ARRAY['admin'::text, 'reviewer'::text])));

-- Reviewers and admins are the only writers. Contributors upload media but
-- never judge it, and with absence meaning unchecked they have no reason to
-- write here at all.
--
-- get_my_role() returns NULL for a signed-in user with no role, and
-- `NULL = ANY (...)` is NULL rather than true, so this denies them - which is
-- the intent. The trap that needed IS DISTINCT FROM is the negated form, and
-- there is deliberately none here.
CREATE POLICY "Staff can record a moderation decision" ON "public"."media_moderation"
    FOR INSERT TO "authenticated"
    WITH CHECK (("public"."get_my_role"() = ANY (ARRAY['admin'::text, 'reviewer'::text])));

CREATE POLICY "Staff can change a moderation decision" ON "public"."media_moderation"
    FOR UPDATE TO "authenticated"
    USING (("public"."get_my_role"() = ANY (ARRAY['admin'::text, 'reviewer'::text])))
    WITH CHECK (("public"."get_my_role"() = ANY (ARRAY['admin'::text, 'reviewer'::text])));

-- Deleting a row resets that file to unchecked, which is the un-approve path.
CREATE POLICY "Staff can clear a moderation decision" ON "public"."media_moderation"
    FOR DELETE TO "authenticated"
    USING (("public"."get_my_role"() = ANY (ARRAY['admin'::text, 'reviewer'::text])));

-- A policy without a matching table GRANT yields a 401 before RLS is ever
-- consulted, so the policy looks broken for a reason the policy cannot
-- explain. This project has been bitten by that twice.
GRANT SELECT ON TABLE "public"."media_moderation" TO "anon";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."media_moderation" TO "authenticated";

-- Seed every file already in the bucket as approved.
--
-- The owner reviewed all 198 of them on 2026-08-11 and confirmed they are
-- good, so opening this feature with a 198-item backlog that has already been
-- cleared would be busywork that trains people to click "approve" without
-- looking - the opposite of what a queue is for.
--
-- Explicit rows rather than an implicit "anything older than this timestamp
-- is fine" rule: the implicit version leaves nothing to audit later, and at
-- this size the rows cost nothing.
--
-- reviewed_by is left NULL on purpose. The review really happened, but it
-- happened outside this table and before it existed, and inventing a user id
-- to point at would be a worse record than an honest gap - the note says what
-- actually took place.
--
-- Dot-prefixed entries are skipped: storage keeps placeholder objects like
-- .emptyFolderPlaceholder that are not media and that the library already
-- filters out everywhere else.
INSERT INTO "public"."media_moderation" ("path", "status", "note")
SELECT "name", 'approved', 'Seeded on 2026-08-12: reviewed by the owner on 2026-08-11, before this queue existed.'
FROM "storage"."objects"
WHERE "bucket_id" = 'wiki-media'
  AND "name" IS NOT NULL
  AND "name" NOT LIKE '.%'
ON CONFLICT ("path") DO NOTHING;
