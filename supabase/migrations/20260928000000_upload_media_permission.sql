-- v0.20 batch 3: an "upload media" permission, and images in discussion threads.
--
-- The owner, 2026-09-25: images on threads for "people with 'media perms' and
-- have signed in". That permission comes with Trusted Editor and up, anyone
-- else gets it when the owner ticks it, and it gates the Media Library as well
-- as threads: one permission, not two.
--
-- "Media perms" did not exist. The only media capability was can_delete_media,
-- and uploading was never gated at all. Read from production on 2026-09-28:
--
--     Auth Upload   INSERT   authenticated   WITH CHECK (bucket_id = 'wiki-media')
--
-- So any signed-in account could upload, a banned viewer included. The other
-- two write policies on that bucket were narrowed in v0.14 (20260813000003 and
-- 20260813000004); this is the upload half.
--
-- Spec: V0.20-DEVLOG.md, "SPEC 2026-09-25: images in discussion threads, and
-- an 'upload media' permission".


-- =========================================================================
-- 1. THE CAPABILITY
-- =========================================================================
--
-- Fourth capability, same pattern as the other three: a column, never a role.

ALTER TABLE "public"."user_roles"
    ADD COLUMN IF NOT EXISTS "can_upload_media" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "public"."user_roles"."can_upload_media" IS
    'Upload to the Media Library and attach images to discussion posts, for an account below Trusted Editor. Trusted Editor and up have it by role. Never effective for a viewer.';

-- Trusted Editor and up by role, anyone else by the flag, and never a viewer.
--
-- 'viewer' is tested by NAME, which CLAUDE.md allows for it alone: it is a
-- ban, not a rung. Its rank already keeps it below trusted_editor, so the name
-- test only decides the case of a viewer who still carries the flag. That case
-- is real: assign_role_by_email has kept capabilities across a role change
-- since 20260904000000, so banning somebody whose box was ticked leaves it
-- ticked. A ban has to win over a perk.
--
-- IS DISTINCT FROM, so a roleless account (role NULL) passes the ban test and
-- falls through to its flag. `NULL <> 'viewer'` is NULL, which would deny
-- every roleless account the owner ticks.
--
-- No row at all, which is anon and every roleless account without a
-- capability, is the COALESCE's false.
CREATE OR REPLACE FUNCTION "public"."can_upload_media"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    SELECT COALESCE(
        (SELECT ur.role IS DISTINCT FROM 'viewer'
                AND ("public"."role_rank"(ur.role) >= "public"."role_rank"('trusted_editor')
                     OR ur.can_upload_media)
         FROM public.user_roles ur
         WHERE ur.user_id = auth.uid()),
        false
    );
$$;

ALTER FUNCTION "public"."can_upload_media"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."can_upload_media"() FROM PUBLIC;
-- anon too, like can_delete_media: storage policies call it for whoever is
-- asking, and a page asks it before offering an upload zone. It answers false
-- for anon; an error there would deny for the wrong reason.
GRANT EXECUTE ON FUNCTION "public"."can_upload_media"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."can_upload_media"() TO "authenticated";

COMMENT ON FUNCTION "public"."can_upload_media"() IS
    'Trusted Editor and above, or the per-user can_upload_media flag; never a viewer. Gates wiki-media uploads, discussion-media uploads and attaching images to a post.';


-- =========================================================================
-- 2. OWNER TOOLS
-- =========================================================================
--
-- set_user_capability rejects names it does not know, so the fourth has to be
-- whitelisted or the checkbox controls nothing. Still one branch per name
-- rather than a column name interpolated into dynamic SQL: a capability name
-- reaching EXECUTE from the client is how a setter like this becomes an
-- arbitrary-write primitive.
--
-- Body carried from 20260904000001; the new lines are the fourth name, its
-- branch, and its place in the sweep. Missing it from the sweep would delete
-- a roleless account's row the moment its last OTHER box was cleared, taking
-- a ticked upload permission with it.

CREATE OR REPLACE FUNCTION "public"."set_user_capability"(
    "target_email" text,
    "capability" text,
    "enabled" boolean
) RETURNS text
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    target_id uuid;
    remaining record;
BEGIN
    IF NOT "public"."is_owner"() THEN
        RAISE EXCEPTION 'Permission denied: only the owner may change capabilities.'
            USING ERRCODE = '42501';
    END IF;

    IF "capability" IS DISTINCT FROM 'bypass_cooldown'
       AND "capability" IS DISTINCT FROM 'can_moderate'
       AND "capability" IS DISTINCT FROM 'can_delete_media'
       AND "capability" IS DISTINCT FROM 'can_upload_media' THEN
        RAISE EXCEPTION 'Unknown capability: %', "capability" USING ERRCODE = '22023';
    END IF;

    SELECT id INTO target_id FROM "auth"."users" WHERE email = "target_email";
    IF target_id IS NULL THEN
        RAISE EXCEPTION 'No account found for %', "target_email" USING ERRCODE = 'P0002';
    END IF;

    IF "capability" = 'bypass_cooldown' THEN
        INSERT INTO "public"."user_roles" ("user_id", "bypass_cooldown")
        VALUES (target_id, "enabled")
        ON CONFLICT ("user_id") DO UPDATE SET "bypass_cooldown" = EXCLUDED."bypass_cooldown";
    ELSIF "capability" = 'can_moderate' THEN
        INSERT INTO "public"."user_roles" ("user_id", "can_moderate")
        VALUES (target_id, "enabled")
        ON CONFLICT ("user_id") DO UPDATE SET "can_moderate" = EXCLUDED."can_moderate";
    ELSIF "capability" = 'can_delete_media' THEN
        INSERT INTO "public"."user_roles" ("user_id", "can_delete_media")
        VALUES (target_id, "enabled")
        ON CONFLICT ("user_id") DO UPDATE SET "can_delete_media" = EXCLUDED."can_delete_media";
    ELSE
        INSERT INTO "public"."user_roles" ("user_id", "can_upload_media")
        VALUES (target_id, "enabled")
        ON CONFLICT ("user_id") DO UPDATE SET "can_upload_media" = EXCLUDED."can_upload_media";
    END IF;

    -- Sweep the row away if nothing is left on it. Only ever true for an
    -- account with no role: a role-holder's row stays whatever the flags say.
    SELECT "role", "bypass_cooldown", "can_moderate", "can_delete_media", "can_upload_media"
    INTO remaining
    FROM "public"."user_roles" WHERE "user_id" = target_id;

    IF remaining."role" IS NULL
       AND COALESCE(remaining."bypass_cooldown", false) = false
       AND COALESCE(remaining."can_moderate", false) = false
       AND COALESCE(remaining."can_delete_media", false) = false
       AND COALESCE(remaining."can_upload_media", false) = false THEN
        DELETE FROM "public"."user_roles" WHERE "user_id" = target_id;
    END IF;

    RETURN format('%s %s for %s.', "capability", CASE WHEN "enabled" THEN 'enabled' ELSE 'disabled' END, "target_email");
END;
$$;

ALTER FUNCTION "public"."set_user_capability"(text, text, boolean) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."set_user_capability"(text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."set_user_capability"(text, text, boolean) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."set_user_capability"(text, text, boolean) TO "authenticated";

-- The roster and the account search each gain a column, so the owner tools
-- can draw the fourth box.
--
-- DROP FIRST. A new output column changes the return type, and CREATE OR
-- REPLACE raises 42P13 on that. The first time list_personnel grew, the DROP
-- was left out; the migration rolled back in its transaction, and the PR was
-- green, so nobody noticed the database had received nothing.
--
-- Bodies carried from 20260827000003 (list_personnel) and 20260904000001
-- (search_users). The new column goes LAST so every existing reader, which
-- reads by name, is unaffected.

DROP FUNCTION IF EXISTS "public"."list_personnel"();

CREATE OR REPLACE FUNCTION "public"."list_personnel"()
RETURNS TABLE (
    "user_id" uuid,
    "email" text,
    "role" text,
    "joined_at" timestamptz,
    "bypass_cooldown" boolean,
    "can_moderate" boolean,
    "can_delete_media" boolean,
    "can_upload_media" boolean
)
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF NOT "public"."is_owner"() THEN
        RAISE EXCEPTION 'Permission denied: only the owner may list personnel.'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT ur.user_id, u.email::text, ur.role, u.created_at,
           ur.bypass_cooldown, ur.can_moderate, ur.can_delete_media, ur.can_upload_media
    FROM "public"."user_roles" ur
    JOIN "auth"."users" u ON u.id = ur.user_id
    ORDER BY u.created_at;
END;
$$;

ALTER FUNCTION "public"."list_personnel"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."list_personnel"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."list_personnel"() FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."list_personnel"() TO "authenticated";

DROP FUNCTION IF EXISTS "public"."search_users"(text, integer);

CREATE OR REPLACE FUNCTION "public"."search_users"(
    "search_query" text,
    "max_results" integer DEFAULT 25
)
RETURNS TABLE (
    "user_id" uuid,
    "email" text,
    "display_name" text,
    "role" text,
    "joined_at" timestamptz,
    "bypass_cooldown" boolean,
    "can_moderate" boolean,
    "can_delete_media" boolean,
    "can_upload_media" boolean
)
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    needle text;
BEGIN
    IF NOT "public"."is_owner"() THEN
        RAISE EXCEPTION 'Permission denied: only the owner may search accounts.'
            USING ERRCODE = '42501';
    END IF;

    needle := btrim(COALESCE("search_query", ''));
    IF length(needle) < 2 THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        u.id,
        u.email::text,
        COALESCE(
            NULLIF(u.raw_user_meta_data->>'display_name', ''),
            NULLIF(u.raw_user_meta_data->>'full_name', ''),
            NULLIF(split_part(COALESCE(u.email, ''), '@', 1), ''),
            'Unknown'
        )::text,
        ur."role",
        u.created_at,
        COALESCE(ur."bypass_cooldown", false),
        COALESCE(ur."can_moderate", false),
        COALESCE(ur."can_delete_media", false),
        COALESCE(ur."can_upload_media", false)
    FROM "auth"."users" u
    LEFT JOIN "public"."user_roles" ur ON ur."user_id" = u.id
    WHERE u.email ILIKE '%' || needle || '%'
       OR COALESCE(u.raw_user_meta_data->>'display_name', '') ILIKE '%' || needle || '%'
       OR COALESCE(u.raw_user_meta_data->>'full_name', '') ILIKE '%' || needle || '%'
    ORDER BY (ur."user_id" IS NULL), u.created_at
    LIMIT GREATEST(1, LEAST(COALESCE("max_results", 25), 100));
END;
$$;

ALTER FUNCTION "public"."search_users"(text, integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."search_users"(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."search_users"(text, integer) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."search_users"(text, integer) TO "authenticated";


-- =========================================================================
-- 3. THE MEDIA LIBRARY: uploads need the permission
-- =========================================================================

-- wiki-media, created only where it is missing.
--
-- The bucket was made in the dashboard and no migration has described it, so
-- a preview branch has none. Every upload probe there then fails with "Bucket
-- not found" before any policy is consulted, which is how a storage rule goes
-- unverified. These are production's settings, read 2026-09-28, so a preview
-- behaves like it. DO NOTHING, so production's own row is never touched.
INSERT INTO "storage"."buckets" ("id", "name", "public", "file_size_limit", "allowed_mime_types")
VALUES ('wiki-media', 'wiki-media', true, 15728640, ARRAY['image/*', 'video/mp4', 'video/webm'])
ON CONFLICT ("id") DO NOTHING;

-- "Auth Upload" is REPLACED, not supplemented. Permissive policies are OR'd,
-- so a second, narrower INSERT policy beside the open one would change
-- nothing: exactly the mistake the first draft of 20260813000003 made with
-- DELETE, where can_delete_media would have shipped as a checkbox controlling
-- nothing.
--
-- Altered if present, created if absent, for the reason the v0.14 pair gave:
-- production has the policy from the dashboard, a preview branch does not. An
-- unconditional ALTER fails on the preview; an unconditional CREATE fails on
-- production. ALTER rather than DROP and CREATE on production, so the name
-- stays and there is no moment without an upload rule.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Auth Upload'
    ) THEN
        EXECUTE $q$
            ALTER POLICY "Auth Upload" ON "storage"."objects"
            WITH CHECK ("bucket_id" = 'wiki-media'::text AND "public"."can_upload_media"())
        $q$;
        RAISE NOTICE 'Narrowed the existing "Auth Upload" policy to require can_upload_media().';
    ELSE
        EXECUTE $q$
            CREATE POLICY "Auth Upload" ON "storage"."objects"
            FOR INSERT TO "authenticated"
            WITH CHECK ("bucket_id" = 'wiki-media'::text AND "public"."can_upload_media"())
        $q$;
        RAISE NOTICE 'Created "Auth Upload": this database had no upload policy for wiki-media.';
    END IF;
END $$;

-- The upload's credit record follows the upload. 20260910000000 left it open
-- to any signed-in account on the stated ground that uploading was open too;
-- that ground is gone as of the policy above. Gated the same, a record can
-- only be written by somebody who could have uploaded the file.
DROP POLICY IF EXISTS "A user can record their own upload" ON "public"."media_uploads";

CREATE POLICY "A user can record their own upload" ON "public"."media_uploads"
    FOR INSERT TO "authenticated"
    WITH CHECK ("uploaded_by" = "auth"."uid"() AND "public"."can_upload_media"());


-- =========================================================================
-- 4. discussion-media: a bucket of its own
-- =========================================================================
--
-- Separate from wiki-media so its rules can be narrower than the library's:
-- WebP only and 1 MB, because the page shrinks every image to at most 1600px
-- on its long side and re-encodes it as WebP before upload. Set on the BUCKET,
-- because a limit in the browser is skipped by anyone calling Storage
-- directly. Public read, like wiki-media: a thread is public reading.
--
-- DO UPDATE rather than DO NOTHING: if a bucket of this name was ever made by
-- hand, its limits become these rather than whatever it was made with.
INSERT INTO "storage"."buckets" ("id", "name", "public", "file_size_limit", "allowed_mime_types")
VALUES ('discussion-media', 'discussion-media', true, 1048576, ARRAY['image/webp'])
ON CONFLICT ("id") DO UPDATE SET
    "public" = EXCLUDED."public",
    "file_size_limit" = EXCLUDED."file_size_limit",
    "allowed_mime_types" = EXCLUDED."allowed_mime_types";

-- Upload: with the permission, and only into your own folder, one level deep.
-- The folder is what lets a post prove an image is its author's (section 5).
DROP POLICY IF EXISTS "Discussion Upload" ON "storage"."objects";

CREATE POLICY "Discussion Upload" ON "storage"."objects"
    FOR INSERT TO "authenticated"
    WITH CHECK (
        "bucket_id" = 'discussion-media'::text
        AND "public"."can_upload_media"()
        AND array_length("storage"."foldername"("name"), 1) = 1
        AND ("storage"."foldername"("name"))[1] = ("auth"."uid"())::text
    );

-- Delete: your own files, or anyone's with can_delete_media. An author
-- removing their post takes its images down with it, and a post that failed
-- after its images uploaded (the 20-second limit, a dropped connection) can
-- clean up after itself. Deliberately not gated on can_upload_media: losing
-- the permission to add images is no reason to lose the ability to take your
-- own down.
DROP POLICY IF EXISTS "Discussion Delete" ON "storage"."objects";

CREATE POLICY "Discussion Delete" ON "storage"."objects"
    FOR DELETE TO "authenticated"
    USING (
        "bucket_id" = 'discussion-media'::text
        AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::text
             OR "public"."can_delete_media"())
    );

-- Read through the API: the same people. A public bucket serves files by URL
-- with no policy at all, so this grants nothing a reader lacks. It exists for
-- the delete above: Postgres applies SELECT policies to a DELETE whose WHERE
-- reads the row, and Storage's remove() deletes by bucket and name. Without a
-- SELECT policy the delete matches nothing and reports no error.
DROP POLICY IF EXISTS "Discussion List Own" ON "storage"."objects";

CREATE POLICY "Discussion List Own" ON "storage"."objects"
    FOR SELECT TO "authenticated"
    USING (
        "bucket_id" = 'discussion-media'::text
        AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::text
             OR "public"."can_delete_media"())
    );

-- No UPDATE policy. Nothing may rename or overwrite an image once posted.

-- Any OTHER insert rule on storage.objects is OR'd with the two above and
-- could reopen what they close. Production had none on 2026-09-28; this says
-- so again at the moment it matters.
DO $$
DECLARE
    other record;
    found_any boolean := false;
BEGIN
    FOR other IN
        SELECT policyname, cmd, roles
        FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND cmd IN ('INSERT', 'ALL')
          AND policyname NOT IN ('Auth Upload', 'Discussion Upload')
    LOOP
        found_any := true;
        RAISE WARNING 'storage.objects has another % policy "%" for roles %. Permissive policies are OR''d, so it may still allow uploads this migration restricts.',
            other.cmd, other.policyname, other.roles;
    END LOOP;

    IF NOT found_any THEN
        RAISE NOTICE 'storage.objects has no other INSERT or ALL policy: "Auth Upload" and "Discussion Upload" are the only upload paths.';
    END IF;
END $$;


-- =========================================================================
-- 5. IMAGES ON A POST
-- =========================================================================
--
-- Paths inside discussion-media, never URLs: moving storage later is then
-- moving files, not rewriting posts, and a post cannot point a reader's
-- browser at an arbitrary host.
--
-- The count is a CHECK. The path rule lives in the shape trigger instead,
-- because it depends on who is posting, and a CHECK cannot see the caller.

ALTER TABLE "public"."page_discussions"
    ADD COLUMN IF NOT EXISTS "images" text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE "public"."page_discussions"
    DROP CONSTRAINT IF EXISTS "page_discussions_images_check";

ALTER TABLE "public"."page_discussions"
    ADD CONSTRAINT "page_discussions_images_check" CHECK (
        cardinality("images") <= 4
        AND array_position("images", NULL) IS NULL
    );

-- Body carried from 20260813000000. What is new:
--
--   * images are the caller's to attach only with can_upload_media(), and
--     every path must be `<caller's id>/<name>.webp`. The Discussion Upload
--     policy already keeps a file in its uploader's folder; this keeps a post
--     from borrowing somebody else's file, or naming one that Storage would
--     never have accepted.
--   * a post may be images alone. "A post cannot be empty" becomes "a post
--     needs words or an image", which is how every chat the players use works.
CREATE OR REPLACE FUNCTION "public"."enforce_discussion_shape"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    caller_email text;
    caller_meta jsonb;
    parent_row record;
BEGIN
    NEW.author_id := auth.uid();

    IF NEW.author_id IS NULL THEN
        RAISE EXCEPTION 'You must be signed in to post.' USING ERRCODE = '42501';
    END IF;

    SELECT email, raw_user_meta_data INTO caller_email, caller_meta
    FROM auth.users WHERE id = NEW.author_id;

    NEW.author_name := COALESCE(
        NULLIF(caller_meta->>'display_name', ''),
        NULLIF(caller_meta->>'full_name', ''),
        NULLIF(caller_meta->'custom_claims'->>'global_name', ''),
        NULLIF(caller_meta->>'user_name', ''),
        NULLIF(split_part(COALESCE(caller_email, ''), '@', 1), ''),
        'Unknown'
    );

    NEW.status := 'visible';
    NEW.removed_at := NULL;
    NEW.removed_by := NULL;

    -- NULL from a client that sent `images: null` means none, not an error
    -- about a NOT NULL column the author never heard of.
    NEW.images := COALESCE(NEW.images, '{}'::text[]);

    IF cardinality(NEW.images) > 0 THEN
        IF NOT "public"."can_upload_media"() THEN
            RAISE EXCEPTION 'Attaching images needs the upload media permission.'
                USING ERRCODE = '42501';
        END IF;

        IF EXISTS (
            SELECT 1 FROM unnest(NEW.images) AS img
            WHERE img IS NULL
               OR img !~ ('^' || NEW.author_id::text || '/[A-Za-z0-9_-]{1,64}\.webp$')
        ) THEN
            RAISE EXCEPTION 'An attached image must be one you uploaded to this thread''s storage.'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    IF btrim(NEW.body) = '' AND cardinality(NEW.images) = 0 THEN
        RAISE EXCEPTION 'A post needs words or an image.' USING ERRCODE = '22023';
    END IF;

    IF NEW.parent_id IS NOT NULL THEN
        SELECT id, page_id, parent_id INTO parent_row
        FROM public.page_discussions WHERE id = NEW.parent_id;

        IF parent_row.id IS NULL THEN
            RAISE EXCEPTION 'That post no longer exists.' USING ERRCODE = 'P0002';
        END IF;

        IF parent_row.parent_id IS NOT NULL THEN
            NEW.parent_id := parent_row.parent_id;
        END IF;

        NEW.page_id := parent_row.page_id;
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."enforce_discussion_shape"() OWNER TO "postgres";
-- CREATE OR REPLACE keeps the ACL 20260819000000 set; restated so this file
-- says it rather than relying on it.
REVOKE ALL ON FUNCTION "public"."enforce_discussion_shape"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."enforce_discussion_shape"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."enforce_discussion_shape"() FROM "authenticated";


-- =========================================================================
-- 6. MODERATION REACHES THE IMAGES
-- =========================================================================
--
-- A removed post's body is BLANKED, not hidden, because RLS is row-level: a
-- policy that lets a reader see the placeholder hands them the whole row. The
-- same is true of `images`, so removal empties it too.
--
-- Staff removal is reversible, and restore reads the text back out of the
-- log. The images need the same, so the log keeps them beside the text.

ALTER TABLE "public"."moderation_log"
    ADD COLUMN IF NOT EXISTS "snapshot_images" text[];

COMMENT ON COLUMN "public"."moderation_log"."snapshot_images" IS
    'The image paths a moderated post carried, beside its text in snapshot. What restore puts back after a remove.';

-- Body carried from 20260813000001. What is new: remove empties images,
-- every log row records them, and restore takes text AND images from the
-- same log row, so a post that was images alone comes back too.
CREATE OR REPLACE FUNCTION "public"."moderate_discussion_post"(
    "p_post_id" uuid,
    "p_action" text,
    "p_reason" text DEFAULT NULL
) RETURNS text
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    target record;
    actor_name text;
    -- Scalars, not a record: hide and remove never assign these, and reading
    -- a field of a record that was never assigned raises 55000, where an
    -- unassigned scalar is simply NULL.
    restored_body text;
    restored_images text[];
BEGIN
    IF NOT "public"."can_moderate"() THEN
        RAISE EXCEPTION 'Permission denied: you cannot moderate discussions.'
            USING ERRCODE = '42501';
    END IF;

    IF "p_action" IS DISTINCT FROM 'hide'
       AND "p_action" IS DISTINCT FROM 'remove'
       AND "p_action" IS DISTINCT FROM 'restore' THEN
        RAISE EXCEPTION 'Unknown moderation action: %', "p_action" USING ERRCODE = '22023';
    END IF;

    IF "p_action" <> 'restore' AND COALESCE(btrim("p_reason"), '') = '' THEN
        RAISE EXCEPTION 'A reason is required so the action can be audited.'
            USING ERRCODE = '22023';
    END IF;

    SELECT id, page_id, body, images, status, author_name
      INTO target
      FROM public.page_discussions
     WHERE id = "p_post_id";

    IF target.id IS NULL THEN
        RAISE EXCEPTION 'That post no longer exists.' USING ERRCODE = 'P0002';
    END IF;

    SELECT COALESCE(
        NULLIF(raw_user_meta_data->>'display_name', ''),
        NULLIF(raw_user_meta_data->>'full_name', ''),
        NULLIF(split_part(COALESCE(email, ''), '@', 1), ''),
        'Unknown'
    ) INTO actor_name
    FROM auth.users WHERE id = auth.uid();

    IF "p_action" = 'hide' THEN
        UPDATE public.page_discussions
        SET status = 'hidden', removed_at = now(), removed_by = auth.uid()
        WHERE id = "p_post_id";

    ELSIF "p_action" = 'remove' THEN
        UPDATE public.page_discussions
        SET body = '', images = '{}'::text[],
            status = 'removed_by_staff', removed_at = now(), removed_by = auth.uid()
        WHERE id = "p_post_id";

    ELSE
        -- A hidden post still has its content; a removed one has none, so it
        -- comes back out of the log. Both halves from ONE row: a text from one
        -- entry and images from another would be a post nobody wrote.
        IF COALESCE(target.body, '') = '' AND cardinality(COALESCE(target.images, '{}'::text[])) = 0 THEN
            SELECT snapshot, snapshot_images INTO restored_body, restored_images
              FROM public.moderation_log
             WHERE target_id = "p_post_id"
               AND (COALESCE(snapshot, '') <> '' OR cardinality(COALESCE(snapshot_images, '{}'::text[])) > 0)
             ORDER BY created_at DESC
             LIMIT 1;
        END IF;

        UPDATE public.page_discussions
        SET status = 'visible',
            body = COALESCE(NULLIF(target.body, ''), restored_body, ''),
            images = CASE
                WHEN cardinality(COALESCE(target.images, '{}'::text[])) > 0 THEN target.images
                ELSE COALESCE(restored_images, '{}'::text[])
            END,
            removed_at = NULL,
            removed_by = NULL
        WHERE id = "p_post_id";
    END IF;

    INSERT INTO public.moderation_log
        (action, target_type, target_id, page_id, moderator_id, moderator_name, author_name, reason, snapshot, snapshot_images)
    VALUES
        ("p_action", 'discussion_post', "p_post_id", target.page_id, auth.uid(), actor_name,
         target.author_name, NULLIF(btrim(COALESCE("p_reason", '')), ''), target.body, target.images);

    RETURN 'Post ' || "p_action" || 'd.';
END;
$$;

ALTER FUNCTION "public"."moderate_discussion_post"(uuid, text, text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."moderate_discussion_post"(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."moderate_discussion_post"(uuid, text, text) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."moderate_discussion_post"(uuid, text, text) TO "authenticated";

-- Body carried from 20260813000000; removal now empties images as well. An
-- author's removal is final and logs nothing, so there is nothing to keep:
-- the page deletes the files themselves afterwards, which the Discussion
-- Delete policy allows for your own folder.
CREATE OR REPLACE FUNCTION "public"."remove_my_discussion_post"("p_post_id" uuid)
RETURNS text
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    post_author uuid;
BEGIN
    IF "auth"."uid"() IS NULL THEN
        RAISE EXCEPTION 'You must be signed in.' USING ERRCODE = '42501';
    END IF;

    SELECT author_id INTO post_author
    FROM public.page_discussions WHERE id = "p_post_id";

    IF post_author IS NULL THEN
        RAISE EXCEPTION 'That post no longer exists, or has no author to check.'
            USING ERRCODE = 'P0002';
    END IF;

    IF post_author IS DISTINCT FROM "auth"."uid"() THEN
        RAISE EXCEPTION 'You can only remove your own posts.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.page_discussions
    SET body = '',
        images = '{}'::text[],
        status = 'removed_by_author',
        removed_at = now(),
        removed_by = "auth"."uid"()
    WHERE id = "p_post_id";

    RETURN 'Post removed.';
END;
$$;

ALTER FUNCTION "public"."remove_my_discussion_post"(uuid) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."remove_my_discussion_post"(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."remove_my_discussion_post"(uuid) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."remove_my_discussion_post"(uuid) TO "authenticated";

-- The report queue shows the reported post beside the complaint, and a
-- moderator deciding about an image has to see the image. DROP first: a new
-- output column is a new return type (42P13). Body carried from
-- 20260813000002, post_images appended last.
DROP FUNCTION IF EXISTS "public"."list_content_reports"(text);

CREATE OR REPLACE FUNCTION "public"."list_content_reports"("p_status" text DEFAULT 'open')
RETURNS TABLE (
    "id" uuid,
    "created_at" timestamptz,
    "target_id" uuid,
    "page_id" text,
    "reporter_name" text,
    "reason" text,
    "note" text,
    "status" text,
    "post_body" text,
    "post_status" text,
    "post_author" text,
    "report_count" bigint,
    "post_images" text[]
)
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF NOT "public"."can_moderate"() THEN
        RAISE EXCEPTION 'Permission denied: you cannot read reports.'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT r.id, r.created_at, r.target_id, r.page_id, r.reporter_name,
           r.reason, r.note, r.status,
           d.body, d.status, d.author_name,
           (SELECT count(*) FROM public.content_reports o WHERE o.target_id = r.target_id),
           d.images
    FROM public.content_reports r
    LEFT JOIN public.page_discussions d ON d.id = r.target_id
    WHERE ("p_status" = 'all' OR r.status = "p_status")
    ORDER BY r.created_at DESC
    LIMIT 200;
END;
$$;

ALTER FUNCTION "public"."list_content_reports"(text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."list_content_reports"(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."list_content_reports"(text) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."list_content_reports"(text) TO "authenticated";
