-- v0.14 follow-up: close the storage UPDATE policy too.
--
-- 20260813000003 narrowed "Auth Delete", which was open to any signed-in
-- account. "Auth Update" is the same shape and nearly the same damage:
--
--     Auth Update   UPDATE   authenticated   bucket_id = 'wiki-media'
--
-- UPDATE on storage.objects permits renaming or moving an object. A renamed
-- clip is a broken reference on every page that embeds it - the file is still
-- there, still paid for, and every skill card pointing at it shows nothing.
-- That is not obviously less destructive than deleting it; it is just quieter,
-- because nothing reports an error and the bucket still looks full.
--
-- Owner's call, 2026-08-13: same treatment as Auth Delete.
--
-- VERIFIED SAFE FIRST. Every storage call in the codebase was audited before
-- narrowing this, because getting it wrong breaks uploads for every
-- contributor:
--
--     list()          SELECT   js/editor-media.js, js/admin-media-queue.js, js/owner.js
--     upload()        INSERT   js/editor-media.js  - no upsert option passed
--     getPublicUrl()  none     public bucket, no policy consulted
--     remove()        DELETE   js/admin-media-queue.js, js/owner.js
--
-- Nothing calls move(), copy(), or upload() with { upsert: true }. The
-- uploader refuses a duplicate name outright rather than overwriting - it
-- tells the contributor to append _v2 "so you do not break pages already using
-- the old one" - so the app has never needed UPDATE at all.
--
-- tests/storage-policy-assumptions.spec.js pins that, so a future change that
-- starts needing UPDATE fails a test instead of failing silently in
-- production for everyone but an admin.

COMMENT ON COLUMN "public"."user_roles"."can_delete_media" IS
    'Destructive changes to existing media: deleting a file, and renaming or moving one. Deliberately NOT implied by reviewer - reviewing a revision and destroying a clip are different amounts of trust.';

-- Altered if present, created if absent, for the same reason as the delete
-- policy: production has this policy because it was made in the dashboard, and
-- a preview branch does not because preview databases are built from these
-- migrations. An unconditional ALTER fails on the preview; an unconditional
-- CREATE fails on production.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Auth Update'
    ) THEN
        EXECUTE $q$
            ALTER POLICY "Auth Update" ON "storage"."objects"
            USING ("bucket_id" = 'wiki-media'::text AND "public"."can_delete_media"())
        $q$;
        RAISE NOTICE 'Narrowed the existing "Auth Update" policy to require can_delete_media().';
    ELSE
        EXECUTE $q$
            CREATE POLICY "Auth Update" ON "storage"."objects"
            FOR UPDATE TO "authenticated"
            USING ("bucket_id" = 'wiki-media'::text AND "public"."can_delete_media"())
        $q$;
        RAISE NOTICE 'Created "Auth Update" - this database had no update policy for wiki-media.';
    END IF;
END $$;

-- What is left open, and deliberately: INSERT is how a contributor adds a clip
-- at all, and SELECT is how the editor lists the library to pick from. Both
-- have to stay available to any signed-in user or the wiki stops accepting
-- contributions, which is the entire point of it.
DO $$
DECLARE
    p record;
BEGIN
    FOR p IN
        SELECT policyname, cmd, roles
        FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
        ORDER BY cmd
    LOOP
        RAISE NOTICE 'storage.objects policy: % (%) for %', p.policyname, p.cmd, p.roles;
    END LOOP;
END $$;
