-- v0.14 item 5: deleting media from the queue.
--
-- The owner's design, and it is simpler than the quarantine-prefix sketch it
-- replaces: deletion is a deliberate per-item action taken in the media queue,
-- not an automatic consequence of flagging. Flagging still hides; deleting is
-- what makes a file unreachable, and a person decides.
--
-- WHY THIS RESOLVES THE COLLECTOR CONFLICT. The garbage collector deletes only
-- what nothing references, using conservative substring matching precisely so
-- its mistakes fall towards keeping files alive. media_usage() answers the same
-- question by extraction, which is faster and can miss an unusual reference
-- form. Those two disagreeing was a real risk while both were automatic. They
-- no longer race, because this delete is manual and immediate rather than a
-- rule the collector has to agree with - a person looked at the file.
--
-- Which is also why the usage number stays ADVISORY here. It says what was
-- found, never "safe to delete", and the confirmation has to say so in words.

-- --------------------------------------------------------------------------
-- THE CAPABILITY
-- --------------------------------------------------------------------------
--
-- Third capability, same pattern as the first two: a column, never a role.
-- user_roles has UNIQUE(user_id) because a second row broke get_my_role() for
-- that user everywhere.
ALTER TABLE "public"."user_roles"
    ADD COLUMN IF NOT EXISTS "can_delete_media" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "public"."user_roles"."can_delete_media" IS
    'Permanently delete files from the media bucket. Deliberately NOT implied by reviewer: reviewing a revision and destroying a file are different amounts of trust.';

-- Deliberately narrower than can_moderate(). A reviewer moderates revisions
-- and media all day; deleting a file is irreversible and gets its own switch,
-- so this checks admin OR the explicit flag and does not fall back to the role
-- hierarchy the way can_moderate() does.
--
-- Granted to anon as well as authenticated because the storage policy below
-- calls it for every caller, and a policy that errors is a policy that denies
-- for the wrong reason.
CREATE OR REPLACE FUNCTION "public"."can_delete_media"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    SELECT COALESCE(
        (SELECT (ur.role = 'admin') OR ur.can_delete_media
         FROM public.user_roles ur
         WHERE ur.user_id = auth.uid()),
        false
    );
$$;

ALTER FUNCTION "public"."can_delete_media"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."can_delete_media"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."can_delete_media"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."can_delete_media"() TO "authenticated";


-- --------------------------------------------------------------------------
-- THE STORAGE POLICY
-- --------------------------------------------------------------------------
--
-- Storage rules for this project have lived in the Supabase dashboard rather
-- than in migrations, which means they are invisible to code review and absent
-- from any preview branch. This one is declared here so the rule that governs
-- irreversible deletion is at least readable in the repository.
--
-- IMPORTANT, AND THE REASON FOR THE DIAGNOSTIC BELOW: permissive policies are
-- OR'd together. If a broader DELETE policy already exists on storage.objects,
-- adding this one narrows nothing at all. The NOTICE lists whatever else is
-- there so it shows up in the migration output instead of being assumed.
-- Nothing is dropped automatically - an 'ALL' policy on storage.objects is
-- typically what permits uploads and reads too, and dropping it blind would
-- break every contributor's ability to add an image.
DO $$
DECLARE
    other record;
    found_any boolean := false;
BEGIN
    FOR other IN
        SELECT policyname, cmd, roles
        FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND cmd IN ('DELETE', 'ALL')
          AND policyname <> 'Only media deleters can delete wiki media'
    LOOP
        found_any := true;
        RAISE NOTICE 'storage.objects already has a % policy "%" for roles % - permissive policies are OR''d, so it may still allow deletes this migration is trying to restrict.',
            other.cmd, other.policyname, other.roles;
    END LOOP;

    IF NOT found_any THEN
        RAISE NOTICE 'storage.objects has no other DELETE or ALL policy - the new policy is the only delete path.';
    END IF;
END $$;

DROP POLICY IF EXISTS "Only media deleters can delete wiki media" ON "storage"."objects";

CREATE POLICY "Only media deleters can delete wiki media" ON "storage"."objects"
    FOR DELETE TO "authenticated"
    USING (
        "bucket_id" = 'wiki-media'
        AND "public"."can_delete_media"()
    );


-- --------------------------------------------------------------------------
-- THE AUDIT TRAIL
-- --------------------------------------------------------------------------
--
-- moderation_log already exists for post moderation. Deleting a file is the
-- most irreversible action on the site, so it belongs in the same log rather
-- than a second one nobody remembers to read.
--
-- The snapshot column holds the post body for a post; for a file it holds the
-- usage summary at the moment of deletion, which is the only record of what
-- the deleter was told before they decided.
ALTER TABLE "public"."moderation_log"
    DROP CONSTRAINT IF EXISTS "moderation_log_action_check";

ALTER TABLE "public"."moderation_log"
    ADD CONSTRAINT "moderation_log_action_check" CHECK ("action" = ANY (ARRAY[
        'hide'::text, 'remove'::text, 'restore'::text, 'delete_media'::text
    ]));

-- target_id is a uuid and a storage path is not, so the path travels in
-- page_id - which is already a free-text column and already means "where this
-- happened". A second nullable column for the same idea would be worse.
COMMENT ON COLUMN "public"."moderation_log"."page_id" IS
    'The page a moderated post belonged to, or - for a delete_media action - the storage path of the deleted file.';

-- Called after the object is gone, to settle the queue row and write the log.
--
-- Deliberately does NOT delete the object itself: storage deletion happens
-- over the storage API with the caller's own JWT, governed by the policy
-- above. Doing it here would mean this function deciding, and a SECURITY
-- DEFINER function that deletes files is a much larger thing to get right than
-- one that records that a delete happened.
CREATE OR REPLACE FUNCTION "public"."record_media_deletion"(
    "p_path" text,
    "p_note" text DEFAULT NULL
) RETURNS text
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    actor_name text;
BEGIN
    -- Caller check first, before reading or writing anything.
    IF NOT "public"."can_delete_media"() THEN
        RAISE EXCEPTION 'Permission denied: you cannot delete media.'
            USING ERRCODE = '42501';
    END IF;

    IF COALESCE(btrim("p_path"), '') = '' THEN
        RAISE EXCEPTION 'No file named.' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(
        NULLIF(raw_user_meta_data->>'display_name', ''),
        NULLIF(raw_user_meta_data->>'full_name', ''),
        NULLIF(split_part(COALESCE(email, ''), '@', 1), ''),
        'Unknown'
    ) INTO actor_name
    FROM auth.users WHERE id = auth.uid();

    -- The queue must not keep listing a file that is gone.
    DELETE FROM public.media_moderation WHERE path = "p_path";

    INSERT INTO public.moderation_log
        (action, target_type, target_id, page_id, moderator_id, moderator_name, reason, snapshot)
    VALUES
        ('delete_media', 'media', NULL, "p_path", auth.uid(), actor_name,
         NULLIF(btrim(COALESCE("p_note", '')), ''), NULL);

    RETURN 'Deleted ' || "p_path" || '.';
END;
$$;

ALTER FUNCTION "public"."record_media_deletion"(text, text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."record_media_deletion"(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."record_media_deletion"(text, text) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."record_media_deletion"(text, text) TO "authenticated";


-- --------------------------------------------------------------------------
-- OWNER TOOLS
-- --------------------------------------------------------------------------
--
-- Third capability to whitelist. Still one UPDATE per branch rather than a
-- column name interpolated into dynamic SQL - a capability name reaching
-- EXECUTE from the client is how a setter like this becomes an arbitrary-write
-- primitive, and the branches stay cheap.
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
BEGIN
    IF "public"."get_my_role"() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Permission denied: only an administrator may change capabilities.'
            USING ERRCODE = '42501';
    END IF;

    IF "capability" IS DISTINCT FROM 'bypass_cooldown'
       AND "capability" IS DISTINCT FROM 'can_moderate'
       AND "capability" IS DISTINCT FROM 'can_delete_media' THEN
        RAISE EXCEPTION 'Unknown capability: %', "capability" USING ERRCODE = '22023';
    END IF;

    SELECT id INTO target_id FROM "auth"."users" WHERE email = "target_email";
    IF target_id IS NULL THEN
        RAISE EXCEPTION 'No account found for %', "target_email" USING ERRCODE = 'P0002';
    END IF;

    IF "capability" = 'bypass_cooldown' THEN
        UPDATE "public"."user_roles" SET "bypass_cooldown" = "enabled" WHERE "user_id" = target_id;
    ELSIF "capability" = 'can_moderate' THEN
        UPDATE "public"."user_roles" SET "can_moderate" = "enabled" WHERE "user_id" = target_id;
    ELSE
        UPDATE "public"."user_roles" SET "can_delete_media" = "enabled" WHERE "user_id" = target_id;
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No role assigned to % - give them a role before granting a capability.', "target_email"
            USING ERRCODE = 'P0002';
    END IF;

    RETURN format('%s %s for %s.', "capability", CASE WHEN "enabled" THEN 'enabled' ELSE 'disabled' END, "target_email");
END;
$$;

ALTER FUNCTION "public"."set_user_capability"(text, text, boolean) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."set_user_capability"(text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."set_user_capability"(text, text, boolean) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."set_user_capability"(text, text, boolean) TO "authenticated";


-- Seventh column on the roster.
--
-- DROP FIRST. Adding a column changes the return type and CREATE OR REPLACE
-- raises 42P13 on that. This is the third time this function has grown, and
-- the first time it did, the DROP was omitted - the migration failed, rolled
-- back in its transaction, and because the PR was green nobody noticed the
-- database had received nothing at all.
DROP FUNCTION IF EXISTS "public"."list_personnel"();

CREATE OR REPLACE FUNCTION "public"."list_personnel"()
RETURNS TABLE (
    "user_id" uuid,
    "email" text,
    "role" text,
    "joined_at" timestamptz,
    "bypass_cooldown" boolean,
    "can_moderate" boolean,
    "can_delete_media" boolean
)
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF "public"."get_my_role"() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Permission denied: only an administrator may list personnel.'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT ur.user_id, u.email::text, ur.role, ur.created_at,
           ur.bypass_cooldown, ur.can_moderate, ur.can_delete_media
    FROM "public"."user_roles" ur
    JOIN "auth"."users" u ON u.id = ur.user_id
    ORDER BY ur.created_at;
END;
$$;

ALTER FUNCTION "public"."list_personnel"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."list_personnel"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."list_personnel"() FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."list_personnel"() TO "authenticated";
