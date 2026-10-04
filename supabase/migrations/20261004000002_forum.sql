-- v1.0 batch 2: the Forum, on the wiki and on Discord.
--
-- Spec: V1.0-DEVLOG.md, "SPEC 2026-10-04: batch 2, the Forum". The owner,
-- 2026-10-02: "The forum should be a new site-wide page", linked to
-- #dogslamloop-forum so a post made on either side shows on both; 2026-10-04:
-- "Anyone signed in" starts one, in one of six categories.
--
-- A forum post is a row here (title, category, who started it) and its
-- conversation is page_discussions under page_id 'forum:<id>'. So everything a
-- character thread already has (replies, reports, moderation, images, KLIPY,
-- the 20-second limit, notifications, the Discord relay) works on it unchanged.
--
--   1. forum_threads, readable by anyone, written only through functions.
--   2. The shape trigger refuses a 'forum:' key that is not a visible post.
--   3. A post's activity (last message, count) kept by a trigger.
--   4. create_forum_post and moderate_forum_thread, for the site.
--   5. Reply notifications that link into the forum.
--   6. Account deletion re-attributes forum posts too.
--   7. The relay's forum functions, service role only, and two fixes to batch
--      1's: a deleted Discord post can be unlinked, and the sweep reads only
--      threads still linked.


-- =========================================================================
-- 1. FORUM POSTS
-- =========================================================================

CREATE TABLE IF NOT EXISTS "public"."forum_threads" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "title" text NOT NULL,
    "tag" text NOT NULL,
    "source" text NOT NULL DEFAULT 'site',
    -- ON DELETE SET NULL: anonymize_user_by_email hard-deletes the auth.users
    -- row, and a forum post must not block that (page_discussions learned the
    -- same in 20260813000000).
    "author_id" uuid,
    "author_name" text NOT NULL DEFAULT '',
    "discord_author_id" text,
    "discord_author_handle" text,
    "status" text NOT NULL DEFAULT 'visible',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "last_post_at" timestamptz NOT NULL DEFAULT now(),
    "post_count" integer NOT NULL DEFAULT 0,
    "removed_at" timestamptz,
    "removed_by" uuid,
    CONSTRAINT "forum_threads_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "forum_threads_author_fkey" FOREIGN KEY ("author_id")
        REFERENCES "auth"."users"("id") ON DELETE SET NULL,
    CONSTRAINT "forum_threads_removed_by_fkey" FOREIGN KEY ("removed_by")
        REFERENCES "auth"."users"("id") ON DELETE SET NULL,
    -- The owner's six, 2026-10-04. The same names are the tags on Discord.
    CONSTRAINT "forum_threads_tag_check" CHECK ("tag" = ANY (ARRAY[
        'Question'::text, 'Guide'::text, 'Discussion'::text, 'Art'::text,
        'Game Update'::text, 'Promotion'::text
    ])),
    CONSTRAINT "forum_threads_status_check" CHECK ("status" = ANY (ARRAY[
        'visible'::text, 'hidden'::text, 'removed'::text, 'removed_on_discord'::text
    ])),
    -- 100 characters is Discord's limit for a post's title. A removed post's
    -- title is blanked: RLS is row-level, so a policy that shows the
    -- placeholder would show the title it stands in for.
    CONSTRAINT "forum_threads_title_check" CHECK (
        ("status" = ANY (ARRAY['removed'::text, 'removed_on_discord'::text]) AND "title" = '')
        OR (char_length(btrim("title")) BETWEEN 1 AND 100 AND "title" !~ '[\r\n]')
    ),
    -- The same rule as page_discussions_source_check.
    CONSTRAINT "forum_threads_source_check" CHECK (
        ("source" = 'site'
            AND "discord_author_id" IS NULL
            AND "discord_author_handle" IS NULL)
        OR
        ("source" = 'discord'
            AND "author_id" IS NULL
            AND "discord_author_id" ~ '^[0-9]{5,20}$'
            AND ("discord_author_handle" IS NULL OR char_length("discord_author_handle") <= 32))
    )
);

ALTER TABLE "public"."forum_threads" OWNER TO "postgres";
ALTER TABLE "public"."forum_threads" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "forum_threads_activity_idx"
    ON "public"."forum_threads" ("last_post_at" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "forum_threads_tag_activity_idx"
    ON "public"."forum_threads" ("tag", "last_post_at" DESC);
-- Read by create_forum_post's limit on every new post.
CREATE INDEX IF NOT EXISTS "forum_threads_author_recent_idx"
    ON "public"."forum_threads" ("author_id", "created_at" DESC);

-- Everyone reads, except a hidden post, which only a moderator sees. Same rule
-- as page_discussions ("Anyone can read visible discussions").
CREATE POLICY "Anyone can read visible forum posts" ON "public"."forum_threads"
    FOR SELECT USING (
        "status" IS DISTINCT FROM 'hidden'
        OR "public"."can_moderate"()
    );

-- No write policy at all: a post is started through create_forum_post and
-- moderated through moderate_forum_thread, which constrain WHAT changes.
REVOKE ALL ON TABLE "public"."forum_threads" FROM "anon";
REVOKE ALL ON TABLE "public"."forum_threads" FROM "authenticated";
GRANT SELECT ON TABLE "public"."forum_threads" TO "anon";
GRANT SELECT ON TABLE "public"."forum_threads" TO "authenticated";
GRANT SELECT ON TABLE "public"."forum_threads" TO "service_role";


-- =========================================================================
-- 2. THE SHAPE TRIGGER: A FORUM KEY MUST BE A VISIBLE POST
-- =========================================================================
--
-- Body carried from 20261004000000; the only addition is the forum check at
-- the end, after a reply has taken its parent's page. Without it a client
-- could post into 'forum:<anything>', or into a post a moderator hid.
CREATE OR REPLACE FUNCTION "public"."enforce_discussion_shape"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    caller_email text;
    caller_meta jsonb;
    parent_row record;
BEGIN
    IF NEW.source = 'discord' AND "auth"."role"() = 'service_role' THEN
        NEW.author_id := NULL;
        NEW.author_name := left(COALESCE(NULLIF(btrim(NEW.author_name), ''), 'Discord member'), 80);
        NEW.edited_at := NULL;
        NEW.status := 'visible';
        NEW.removed_at := NULL;
        NEW.removed_by := NULL;
        NEW.images := COALESCE(NEW.images, '{}'::text[]);

        IF EXISTS (
            SELECT 1 FROM unnest(NEW.images) AS img
            WHERE img IS NULL
               OR img !~ '^discord/[0-9]{5,20}-[0-3]\.(png|jpg|webp|gif)$'
        ) THEN
            RAISE EXCEPTION 'A copied image must be one the relay stored.'
                USING ERRCODE = '22023';
        END IF;
    ELSE
        NEW.source := 'site';
        NEW.discord_author_id := NULL;
        NEW.discord_author_handle := NULL;
        NEW.edited_at := NULL;

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

        NEW.images := COALESCE(NEW.images, '{}'::text[]);

        IF cardinality(NEW.images) > 0 THEN
            IF NOT "public"."can_upload_media"() THEN
                RAISE EXCEPTION 'Attaching images needs the upload media permission.'
                    USING ERRCODE = '42501';
            END IF;

            IF EXISTS (
                SELECT 1 FROM unnest(NEW.images) AS img
                WHERE img IS NULL
                   OR img !~ ('^' || NEW.author_id::text || '/[A-Za-z0-9_-]{1,64}\.(webp|jpg)$')
            ) THEN
                RAISE EXCEPTION 'An attached image must be one you uploaded to this thread''s storage.'
                    USING ERRCODE = '22023';
            END IF;
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

    IF NEW.page_id LIKE 'forum:%' THEN
        IF NEW.page_id !~ '^forum:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           OR NOT EXISTS (
               SELECT 1 FROM public.forum_threads ft
               WHERE ft.id = substring(NEW.page_id FROM 7)::uuid
                 AND ft.status = 'visible'
           ) THEN
            RAISE EXCEPTION 'That forum post is not open for replies.' USING ERRCODE = 'P0002';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."enforce_discussion_shape"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."enforce_discussion_shape"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."enforce_discussion_shape"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."enforce_discussion_shape"() FROM "authenticated";


-- =========================================================================
-- 3. A POST'S ACTIVITY
-- =========================================================================
--
-- The forum lists posts by their latest message, so every message into a
-- 'forum:' key moves its post up. Definer: forum_threads has no client write.
CREATE OR REPLACE FUNCTION "public"."touch_forum_thread"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF NEW.page_id LIKE 'forum:%' THEN
        UPDATE public.forum_threads
        SET last_post_at = GREATEST(last_post_at, NEW.created_at),
            post_count = post_count + 1
        WHERE id = substring(NEW.page_id FROM 7)::uuid;
    END IF;
    RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."touch_forum_thread"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."touch_forum_thread"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."touch_forum_thread"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."touch_forum_thread"() FROM "authenticated";

CREATE OR REPLACE TRIGGER "trigger_touch_forum_thread"
    AFTER INSERT ON "public"."page_discussions"
    FOR EACH ROW EXECUTE FUNCTION "public"."touch_forum_thread"();


-- =========================================================================
-- 4. STARTING AND MODERATING A POST
-- =========================================================================

-- A post and its opening message, together. The message goes through the shape
-- trigger like any other, so it gets the name, image and rate rules every
-- message gets, and the post takes its author's name from it: one rule for
-- names, the trigger's.
CREATE OR REPLACE FUNCTION "public"."create_forum_post"(
    "p_title" text, "p_tag" text, "p_body" text, "p_images" text[]
)
RETURNS uuid
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    new_id uuid;
    opener_name text;
    clean_title text := btrim(COALESCE("p_title", ''));
BEGIN
    IF "auth"."uid"() IS NULL THEN
        RAISE EXCEPTION 'You must be signed in to post.' USING ERRCODE = '42501';
    END IF;

    -- viewer is a ban, tested by name (CLAUDE.md, Roles).
    IF "public"."get_my_role"() IS NOT DISTINCT FROM 'viewer' THEN
        RAISE EXCEPTION 'Your account cannot post.' USING ERRCODE = '42501';
    END IF;

    IF char_length(clean_title) < 1 OR char_length(clean_title) > 100 OR clean_title ~ '[\r\n]' THEN
        RAISE EXCEPTION 'A post needs a title of up to 100 characters, on one line.' USING ERRCODE = '22023';
    END IF;

    IF "p_tag" IS NULL OR NOT ("p_tag" = ANY (ARRAY['Question', 'Guide', 'Discussion', 'Art', 'Game Update', 'Promotion'])) THEN
        RAISE EXCEPTION 'Pick a category for the post.' USING ERRCODE = '22023';
    END IF;

    -- A forum post also opens a Discord post, so a burst costs twice.
    IF EXISTS (
        SELECT 1 FROM public.forum_threads
        WHERE author_id = "auth"."uid"()
          AND created_at > now() - interval '2 minutes'
    ) THEN
        RAISE EXCEPTION 'Slow down - you can start a new post once every 2 minutes.'
            USING ERRCODE = '53400';
    END IF;

    INSERT INTO public.forum_threads (title, tag, author_id)
    VALUES (clean_title, "p_tag", "auth"."uid"())
    RETURNING id INTO new_id;

    INSERT INTO public.page_discussions (page_id, body, images)
    VALUES ('forum:' || new_id::text, COALESCE("p_body", ''), COALESCE("p_images", '{}'::text[]))
    RETURNING author_name INTO opener_name;

    UPDATE public.forum_threads SET author_name = opener_name WHERE id = new_id;

    RETURN new_id;
END;
$$;

ALTER FUNCTION "public"."create_forum_post"(text, text, text, text[]) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."create_forum_post"(text, text, text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."create_forum_post"(text, text, text, text[]) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."create_forum_post"(text, text, text, text[]) TO "authenticated";

-- Hide (reversible quarantine), remove (title blanked, kept in the log), or
-- restore. The same three verbs as moderate_discussion_post, logged the same
-- way under target_type 'forum_thread'.
CREATE OR REPLACE FUNCTION "public"."moderate_forum_thread"(
    "p_thread_id" uuid, "p_action" text, "p_reason" text
)
RETURNS text
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    target record;
    actor_name text;
    restored_title text;
BEGIN
    IF NOT "public"."can_moderate"() THEN
        RAISE EXCEPTION 'Permission denied: you cannot moderate the forum.'
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

    SELECT id, title, status, author_name INTO target
    FROM public.forum_threads WHERE id = "p_thread_id";

    IF target.id IS NULL THEN
        RAISE EXCEPTION 'That forum post no longer exists.' USING ERRCODE = 'P0002';
    END IF;

    -- A post Discord deleted has nothing left to restore.
    IF target.status = 'removed_on_discord' THEN
        RAISE EXCEPTION 'That post was deleted on Discord.' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(
        NULLIF(raw_user_meta_data->>'display_name', ''),
        NULLIF(raw_user_meta_data->>'full_name', ''),
        NULLIF(split_part(COALESCE(email, ''), '@', 1), ''),
        'Unknown'
    ) INTO actor_name
    FROM auth.users WHERE id = auth.uid();

    IF "p_action" = 'hide' THEN
        UPDATE public.forum_threads
        SET status = 'hidden', removed_at = now(), removed_by = auth.uid()
        WHERE id = "p_thread_id";
    ELSIF "p_action" = 'remove' THEN
        UPDATE public.forum_threads
        SET title = '', status = 'removed', removed_at = now(), removed_by = auth.uid()
        WHERE id = "p_thread_id";
    ELSE
        IF COALESCE(target.title, '') = '' THEN
            SELECT snapshot INTO restored_title
            FROM public.moderation_log
            WHERE target_id = "p_thread_id" AND target_type = 'forum_thread'
              AND COALESCE(snapshot, '') <> ''
            ORDER BY created_at DESC
            LIMIT 1;
        END IF;

        UPDATE public.forum_threads
        SET status = 'visible',
            title = COALESCE(NULLIF(target.title, ''), restored_title, 'Restored post'),
            removed_at = NULL,
            removed_by = NULL
        WHERE id = "p_thread_id";
    END IF;

    INSERT INTO public.moderation_log
        (action, target_type, target_id, page_id, moderator_id, moderator_name, author_name, reason, snapshot)
    VALUES
        ("p_action", 'forum_thread', "p_thread_id", 'forum:' || "p_thread_id"::text, auth.uid(), actor_name,
         target.author_name, NULLIF(btrim(COALESCE("p_reason", '')), ''), target.title);

    RETURN 'Post ' || "p_action" || 'd.';
END;
$$;

ALTER FUNCTION "public"."moderate_forum_thread"(uuid, text, text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."moderate_forum_thread"(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."moderate_forum_thread"(uuid, text, text) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."moderate_forum_thread"(uuid, text, text) TO "authenticated";


-- =========================================================================
-- 5. REPLY NOTIFICATIONS THAT LINK INTO THE FORUM
-- =========================================================================
--
-- Body carried from 20260813000000. A forum reply names the post's title and
-- links to forum.html, where a character reply names the page and links to it.
CREATE OR REPLACE FUNCTION "public"."notify_discussion_reply"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    parent_author uuid;
    page_url text;
    thread_title text;
BEGIN
    IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;

    SELECT author_id INTO parent_author
    FROM public.page_discussions WHERE id = NEW.parent_id;

    IF parent_author IS NULL OR parent_author = NEW.author_id THEN
        RETURN NEW;
    END IF;

    IF NEW.page_id LIKE 'forum:%' THEN
        SELECT title INTO thread_title
        FROM public.forum_threads WHERE id = substring(NEW.page_id FROM 7)::uuid;

        INSERT INTO public.user_notifications (user_id, message, link)
        VALUES (
            parent_author,
            NEW.author_name || ' replied to your post in the forum: ' || COALESCE(NULLIF(thread_title, ''), 'a post') || '.',
            'forum.html?post=' || substring(NEW.page_id FROM 7) || '#post-' || NEW.parent_id
        );
        RETURN NEW;
    END IF;

    SELECT url INTO page_url FROM public.site_pages WHERE page_id = NEW.page_id;

    INSERT INTO public.user_notifications (user_id, message, link)
    VALUES (
        parent_author,
        NEW.author_name || ' replied to your post on ' || upper(NEW.page_id) || '.',
        COALESCE(page_url, 'index.html') || '#post-' || NEW.parent_id
    );

    RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."notify_discussion_reply"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."notify_discussion_reply"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."notify_discussion_reply"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."notify_discussion_reply"() FROM "authenticated";


-- =========================================================================
-- 6. ACCOUNT DELETION REACHES THE FORUM
-- =========================================================================
--
-- Body carried from 20260827000003; forum posts are re-attributed alongside
-- thread messages, for the same reason: other people's replies hang off them.
CREATE OR REPLACE FUNCTION "public"."anonymize_user_by_email"("target_email" "text")
RETURNS "text"
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    target_user_id UUID;
    revisions_kept INT := 0;
    posts_kept INT := 0;
BEGIN
    IF NOT "public"."is_owner"() THEN
        RAISE EXCEPTION 'Permission denied: only the owner may anonymize an account.'
            USING ERRCODE = '42501';
    END IF;

    SELECT id INTO target_user_id FROM auth.users WHERE email = target_email;

    IF target_user_id IS NULL THEN
        RETURN 'Error: User with this email not found.';
    END IF;

    IF (SELECT role FROM public.user_roles WHERE user_id = target_user_id) = 'owner'
       AND (SELECT count(*) FROM public.user_roles WHERE role = 'owner') <= 1 THEN
        RAISE EXCEPTION 'Refusing to anonymize the only remaining admin.'
            USING ERRCODE = '42501';
    END IF;

    UPDATE public.pending_revisions
    SET author_id = NULL,
        author_name = 'Deleted user'
    WHERE author_id = target_user_id;

    GET DIAGNOSTICS revisions_kept = ROW_COUNT;

    UPDATE public.page_discussions
    SET author_id = NULL,
        author_name = 'Deleted user'
    WHERE author_id = target_user_id;

    GET DIAGNOSTICS posts_kept = ROW_COUNT;

    UPDATE public.forum_threads
    SET author_id = NULL,
        author_name = 'Deleted user'
    WHERE author_id = target_user_id;

    DELETE FROM public.user_notifications WHERE user_id = target_user_id;

    UPDATE public.page_data
    SET last_editor_name = 'Deleted user'
    WHERE last_editor_name = (SELECT email FROM auth.users WHERE id = target_user_id);

    DELETE FROM public.user_roles WHERE user_id = target_user_id;

    DELETE FROM auth.users WHERE id = target_user_id;

    RETURN 'Anonymized ' || target_email || '. ' || revisions_kept ||
           ' revision(s) and ' || posts_kept ||
           ' post(s) kept and re-attributed to "Deleted user".';
END;
$$;

ALTER FUNCTION "public"."anonymize_user_by_email"("text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."anonymize_user_by_email"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."anonymize_user_by_email"("text") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."anonymize_user_by_email"("text") TO "authenticated";


-- =========================================================================
-- 7. THE RELAY'S FORUM FUNCTIONS
-- =========================================================================
--
-- Service role only, each refusing any other caller first, as in
-- 20261004000000.

-- A Discord post can be locked by the relay (spec: a post a wiki moderator
-- hides or removes is locked and archived on Discord).
ALTER TABLE "public"."discord_threads"
    ADD COLUMN IF NOT EXISTS "locked" boolean NOT NULL DEFAULT false;

-- When the forum was first connected. Start fresh: Discord posts begun before
-- this are never copied in.
ALTER TABLE "public"."discord_relay_state"
    ADD COLUMN IF NOT EXISTS "forum_since" timestamptz;

CREATE OR REPLACE FUNCTION "public"."discord_relay_forum_since"()
RETURNS timestamptz
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    since timestamptz;
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.discord_relay_state
    SET forum_since = COALESCE(forum_since, now())
    WHERE id = 1
    RETURNING forum_since INTO since;

    RETURN since;
END;
$$;

-- What the relay has to do to forum posts on Discord:
--   open    a wiki post not yet on Discord: its opening message, title and tag
--   lock    a linked post a wiki moderator hid or removed
--   unlock  a linked post restored
CREATE OR REPLACE FUNCTION "public"."discord_relay_forum_outbox"("p_limit" integer)
RETURNS TABLE (
    "action" text,
    "thread_id" uuid,
    "title" text,
    "tag" text,
    "opening_post_id" uuid,
    "body" text,
    "images" text[],
    "author_name" text,
    "author_discord_id" text,
    "discord_thread_id" text
)
LANGUAGE "plpgsql" STABLE SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    (
        SELECT 'open'::text, ft.id, ft.title, ft.tag, op.id, op.body, op.images, op.author_name,
               ident.provider_id, NULL::text
        FROM public.forum_threads ft
        JOIN LATERAL (
            SELECT p.id, p.body, p.images, p.author_name, p.author_id, p.status
            FROM public.page_discussions p
            WHERE p.page_id = 'forum:' || ft.id::text AND p.parent_id IS NULL
            ORDER BY p.created_at, p.id
            LIMIT 1
        ) op ON true
        LEFT JOIN public.discord_messages dm ON dm.post_id = op.id
        LEFT JOIN LATERAL (
            SELECT i.provider_id FROM auth.identities i
            WHERE i.user_id = op.author_id AND i.provider = 'discord'
            LIMIT 1
        ) ident ON true
        WHERE ft.source = 'site'
          AND ft.status = 'visible'
          AND op.status = 'visible'
          AND NOT EXISTS (SELECT 1 FROM public.discord_threads dt WHERE dt.site_key = 'forum:' || ft.id::text)
          AND (dm.post_id IS NULL OR (dm.state = 'failed' AND dm.attempts < 5))
        ORDER BY ft.created_at
        LIMIT GREATEST(1, LEAST(COALESCE("p_limit", 5), 20))
    )
    UNION ALL
    (
        SELECT CASE WHEN ft.status = 'visible' THEN 'unlock' ELSE 'lock' END,
               ft.id, NULL::text, NULL::text, NULL::uuid, NULL::text, NULL::text[], NULL::text,
               NULL::text, dt.discord_thread_id
        FROM public.forum_threads ft
        JOIN public.discord_threads dt ON dt.site_key = 'forum:' || ft.id::text
        WHERE (ft.status IN ('hidden', 'removed') AND dt.locked = false)
           OR (ft.status = 'visible' AND dt.locked = true)
        LIMIT GREATEST(1, LEAST(COALESCE("p_limit", 5), 20))
    );
END;
$$;

-- Link a forum post to its Discord post. linked_at is the post's own creation,
-- not now: a reply written on the wiki in the seconds before the Discord post
-- opened is still sent.
CREATE OR REPLACE FUNCTION "public"."discord_relay_link_forum"(
    "p_thread_id" uuid, "p_discord_thread_id" text, "p_last_message_id" text
)
RETURNS boolean
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    linked boolean := false;
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.discord_threads (site_key, channel, discord_thread_id, last_message_id, linked_at)
    SELECT 'forum:' || ft.id::text, 'forum', "p_discord_thread_id", "p_last_message_id", ft.created_at
    FROM public.forum_threads ft WHERE ft.id = "p_thread_id"
    ON CONFLICT DO NOTHING
    RETURNING true INTO linked;

    RETURN COALESCE(linked, false);
END;
$$;

CREATE OR REPLACE FUNCTION "public"."discord_relay_set_locked"("p_discord_thread_id" text, "p_locked" boolean)
RETURNS void
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.discord_threads SET locked = "p_locked"
    WHERE discord_thread_id = "p_discord_thread_id";
END;
$$;

-- A post started on Discord, copied in: the forum post, its link, and its
-- starter message as the opening message (the starter shares the post's id).
-- Returns the new forum post's id, or NULL when it is not copied: already
-- linked, or its author is a linked wiki account under the soft ban.
CREATE OR REPLACE FUNCTION "public"."discord_relay_take_forum"(
    "p_discord_thread_id" text, "p_title" text, "p_tag" text,
    "p_author_discord_id" text, "p_author_name" text, "p_author_handle" text,
    "p_body" text, "p_images" text[]
)
RETURNS uuid
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    new_id uuid;
    clean_title text := left(btrim(regexp_replace(COALESCE("p_title", ''), '[\r\n]+', ' ', 'g')), 100);
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    IF EXISTS (SELECT 1 FROM public.discord_threads WHERE discord_thread_id = "p_discord_thread_id") THEN
        RETURN NULL;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM auth.identities i
        JOIN public.user_roles ur ON ur.user_id = i.user_id
        WHERE i.provider = 'discord'
          AND i.provider_id = "p_author_discord_id"
          AND ur.role = 'viewer'
    ) THEN
        RETURN NULL;
    END IF;

    INSERT INTO public.forum_threads
        (title, tag, source, discord_author_id, discord_author_handle, author_name)
    VALUES
        (COALESCE(NULLIF(clean_title, ''), 'Untitled'),
         CASE WHEN "p_tag" = ANY (ARRAY['Question', 'Guide', 'Discussion', 'Art', 'Game Update', 'Promotion'])
              THEN "p_tag" ELSE 'Discussion' END,
         'discord', "p_author_discord_id", NULLIF(left("p_author_handle", 32), ''),
         left(COALESCE(NULLIF(btrim("p_author_name"), ''), 'Discord member'), 80))
    RETURNING id INTO new_id;

    -- Linked from the moment the post was started on Discord, which its id
    -- records (a snowflake's top bits are milliseconds since 2015). Linked
    -- from now, a reply written in the seconds before this run would be older
    -- than the link, and skipped.
    INSERT INTO public.discord_threads (site_key, channel, discord_thread_id, last_message_id, linked_at)
    VALUES ('forum:' || new_id::text, 'forum', "p_discord_thread_id", "p_discord_thread_id",
            to_timestamp((floor("p_discord_thread_id"::numeric / 4194304) + 1420070400000) / 1000.0));

    PERFORM public.discord_relay_take(
        "p_discord_thread_id", "p_discord_thread_id",
        "p_author_discord_id", "p_author_name", "p_author_handle",
        "p_body", "p_images", NULL
    );

    RETURN new_id;
END;
$$;

-- Body carried from 20261004000000, with two additions, both so that a message
-- the wiki cannot take is skipped rather than refused. A refusal stops the
-- relay at that message on every tick, for good.
--   * A message into a forum post that is not visible (a moderator hid it) is
--     not copied; the shape trigger would refuse it.
--   * A message with no words and no picture (a poll, say) is copied with a
--     line saying so; the shape trigger refuses an empty post.
CREATE OR REPLACE FUNCTION "public"."discord_relay_take"(
    "p_discord_thread_id" text, "p_discord_message_id" text,
    "p_author_discord_id" text, "p_author_name" text, "p_author_handle" text,
    "p_body" text, "p_images" text[], "p_reply_to_discord_id" text
)
RETURNS uuid
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    thread_key text;
    parent uuid;
    new_id uuid;
    words text := COALESCE("p_body", '');
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    IF EXISTS (SELECT 1 FROM public.discord_messages WHERE discord_message_id = "p_discord_message_id") THEN
        RETURN NULL;
    END IF;

    SELECT site_key INTO thread_key
    FROM public.discord_threads WHERE discord_thread_id = "p_discord_thread_id";
    IF thread_key IS NULL THEN
        RETURN NULL;
    END IF;

    IF thread_key LIKE 'forum:%' AND NOT EXISTS (
        SELECT 1 FROM public.forum_threads ft
        WHERE ft.id = substring(thread_key FROM 7)::uuid AND ft.status = 'visible'
    ) THEN
        RETURN NULL;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM auth.identities i
        JOIN public.user_roles ur ON ur.user_id = i.user_id
        WHERE i.provider = 'discord'
          AND i.provider_id = "p_author_discord_id"
          AND ur.role = 'viewer'
    ) THEN
        RETURN NULL;
    END IF;

    IF btrim(words) = '' AND cardinality(COALESCE("p_images", '{}'::text[])) = 0 THEN
        words := '[a message the wiki cannot show]';
    END IF;

    IF "p_reply_to_discord_id" IS NOT NULL THEN
        SELECT dm.post_id INTO parent
        FROM public.discord_messages dm
        JOIN public.page_discussions p ON p.id = dm.post_id
        WHERE dm.discord_message_id = "p_reply_to_discord_id"
          AND p.page_id = thread_key;
    END IF;

    INSERT INTO public.page_discussions
        (page_id, parent_id, source, discord_author_id, discord_author_handle, author_name, body, images)
    VALUES
        (thread_key, parent, 'discord', "p_author_discord_id", NULLIF(left("p_author_handle", 32), ''),
         "p_author_name", left(words, 4000), COALESCE("p_images", '{}'::text[]))
    RETURNING id INTO new_id;

    INSERT INTO public.discord_messages
        (post_id, discord_thread_id, discord_message_id, direction, state)
    VALUES
        (new_id, "p_discord_thread_id", "p_discord_message_id", 'from_discord', 'sent');

    RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION "public"."discord_relay_take"(text, text, text, text, text, text, text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_take"(text, text, text, text, text, text, text[], text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_take"(text, text, text, text, text, text, text[], text) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_take"(text, text, text, text, text, text, text[], text) TO "service_role";

-- Body carried from 20261004000000, with one change: the thread is updated
-- too. A forum post's opening message is claimed under the forum channel
-- before its Discord post exists, then recorded as sent under the post; kept
-- under the channel, deleting it later would never reach Discord.
CREATE OR REPLACE FUNCTION "public"."discord_relay_record"(
    "p_post_id" uuid, "p_discord_thread_id" text, "p_direction" text,
    "p_state" text, "p_discord_message_id" text, "p_error" text
)
RETURNS void
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.discord_messages AS cur
        (post_id, discord_thread_id, direction, state, discord_message_id, attempts, last_error, updated_at)
    VALUES
        ("p_post_id", "p_discord_thread_id", "p_direction", "p_state", "p_discord_message_id",
         CASE WHEN "p_state" = 'failed' THEN 1 ELSE 0 END, left("p_error", 500), now())
    ON CONFLICT (post_id) DO UPDATE
    SET state = EXCLUDED.state,
        discord_thread_id = EXCLUDED.discord_thread_id,
        discord_message_id = COALESCE(EXCLUDED.discord_message_id,
            CASE WHEN EXCLUDED.state IN ('deleted', 'failed') THEN cur.discord_message_id END),
        attempts = cur.attempts + CASE WHEN EXCLUDED.state = 'failed' THEN 1 ELSE 0 END,
        last_error = EXCLUDED.last_error,
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION "public"."discord_relay_record"(uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_record"(uuid, text, text, text, text, text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_record"(uuid, text, text, text, text, text) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_record"(uuid, text, text, text, text, text) TO "service_role";

-- A Discord post renamed or re-tagged: the wiki follows, while the post is
-- visible. A tag that is not one of the six leaves the category as it was.
CREATE OR REPLACE FUNCTION "public"."discord_relay_forum_rename"(
    "p_discord_thread_id" text, "p_title" text, "p_tag" text
)
RETURNS void
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    clean_title text := left(btrim(regexp_replace(COALESCE("p_title", ''), '[\r\n]+', ' ', 'g')), 100);
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.forum_threads ft
    SET title = CASE WHEN clean_title <> '' THEN clean_title ELSE ft.title END,
        tag = CASE WHEN "p_tag" = ANY (ARRAY['Question', 'Guide', 'Discussion', 'Art', 'Game Update', 'Promotion'])
                   THEN "p_tag" ELSE ft.tag END
    FROM public.discord_threads dt
    WHERE dt.discord_thread_id = "p_discord_thread_id"
      AND dt.site_key = 'forum:' || ft.id::text
      AND ft.status = 'visible'
      AND (ft.title IS DISTINCT FROM clean_title OR ft.tag IS DISTINCT FROM "p_tag");
END;
$$;

-- A Discord post that no longer exists. A forum post is removed with every
-- message in it, as Discord removed them; a character post is unlinked, so the
-- next sweep opens a fresh one. Returns the relay's own copied images to
-- delete from storage.
CREATE OR REPLACE FUNCTION "public"."discord_relay_thread_gone"("p_discord_thread_id" text)
RETURNS text[]
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    link record;
    copies text[];
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    SELECT site_key, channel INTO link
    FROM public.discord_threads WHERE discord_thread_id = "p_discord_thread_id";

    IF link.site_key IS NULL THEN
        RETURN '{}'::text[];
    END IF;

    IF link.channel = 'forum' THEN
        SELECT COALESCE(array_agg(img), '{}'::text[]) INTO copies
        FROM public.page_discussions p, unnest(p.images) AS img
        WHERE p.page_id = link.site_key AND p.status = 'visible' AND img LIKE 'discord/%';

        UPDATE public.page_discussions
        SET body = '', images = '{}'::text[],
            status = 'removed_on_discord', removed_at = now(), removed_by = NULL
        WHERE page_id = link.site_key AND status = 'visible';

        UPDATE public.forum_threads
        SET title = '', status = 'removed_on_discord', removed_at = now(), removed_by = NULL
        WHERE id = substring(link.site_key FROM 7)::uuid;
    END IF;

    UPDATE public.discord_messages SET state = 'deleted', updated_at = now()
    WHERE discord_thread_id = "p_discord_thread_id" AND state IN ('sent', 'sending');

    DELETE FROM public.discord_threads WHERE discord_thread_id = "p_discord_thread_id";

    RETURN COALESCE(copies, '{}'::text[]);
END;
$$;

-- Body carried from 20261004000000, with one change: only threads still linked.
-- A Discord post that is gone and unlinked is no longer read every minute.
CREATE OR REPLACE FUNCTION "public"."discord_relay_recent"()
RETURNS TABLE ("post_id" uuid, "direction" text, "discord_thread_id" text, "discord_message_id" text, "body" text)
LANGUAGE "plpgsql" STABLE SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT dm.post_id, dm.direction, dm.discord_thread_id, dm.discord_message_id, p.body
    FROM public.discord_messages dm
    JOIN public.page_discussions p ON p.id = dm.post_id
    JOIN public.discord_threads dt ON dt.discord_thread_id = dm.discord_thread_id
    WHERE dm.state = 'sent'
      AND dm.discord_message_id IS NOT NULL
      AND p.status = 'visible'
      AND p.created_at > now() - interval '24 hours';
END;
$$;

REVOKE ALL ON FUNCTION "public"."discord_relay_forum_since"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_forum_since"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_forum_since"() FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_forum_since"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."discord_relay_forum_outbox"(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_forum_outbox"(integer) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_forum_outbox"(integer) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_forum_outbox"(integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."discord_relay_link_forum"(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_link_forum"(uuid, text, text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_link_forum"(uuid, text, text) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_link_forum"(uuid, text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."discord_relay_set_locked"(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_set_locked"(text, boolean) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_set_locked"(text, boolean) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_set_locked"(text, boolean) TO "service_role";

REVOKE ALL ON FUNCTION "public"."discord_relay_take_forum"(text, text, text, text, text, text, text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_take_forum"(text, text, text, text, text, text, text, text[]) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_take_forum"(text, text, text, text, text, text, text, text[]) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_take_forum"(text, text, text, text, text, text, text, text[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."discord_relay_forum_rename"(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_forum_rename"(text, text, text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_forum_rename"(text, text, text) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_forum_rename"(text, text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."discord_relay_thread_gone"(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_thread_gone"(text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_thread_gone"(text) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_thread_gone"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."discord_relay_recent"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_recent"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_recent"() FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_recent"() TO "service_role";
