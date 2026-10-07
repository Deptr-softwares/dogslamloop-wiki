-- v1.0 batch 3: replies to replies, and editing.
--
-- Spec: V1.0-DEVLOG.md, "SPEC 2026-10-04: batch 3". The owner, 2026-10-04:
-- "The ability to reply to replied on the wiki" and "The ability to edit
-- post/reply/comment on the wiki". Both reverse v0.14 decisions (one level of
-- replies, flattened; delete-only), and the owner chose:
--   * a reply to a reply stays one step in and quotes what it answers;
--   * the words can be edited, and a forum post's title and category;
--   * moderators, and only moderators, see what a post said before.
--
--   1. page_discussions.reply_to, recorded by the shape trigger.
--   2. Earlier versions: page_discussion_edits and forum_thread_edits.
--   3. edit_my_discussion_post and edit_my_forum_post.
--   4. Notifications for the person a reply answers.
--   5. The relay: wiki edits and renames reach Discord; Discord edits and
--      renames keep the earlier version; a wiki rename is not undone by the
--      sweep before it has reached Discord.


-- =========================================================================
-- 1. WHICH REPLY A REPLY ANSWERS
-- =========================================================================

ALTER TABLE "public"."page_discussions"
    ADD COLUMN IF NOT EXISTS "reply_to" uuid;

ALTER TABLE "public"."page_discussions"
    DROP CONSTRAINT IF EXISTS "page_discussions_reply_to_fkey";
ALTER TABLE "public"."page_discussions"
    ADD CONSTRAINT "page_discussions_reply_to_fkey" FOREIGN KEY ("reply_to")
        REFERENCES "public"."page_discussions"("id") ON DELETE SET NULL;

-- Body carried from 20261004000002. reply_to is the trigger's alone: cleared
-- on the way in, then set when the parent the client named is itself a reply,
-- just before that parent is flattened to the post at the top as it always
-- was. A Discord reply to a reply comes through the same lines.
CREATE OR REPLACE FUNCTION "public"."enforce_discussion_shape"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    caller_email text;
    caller_meta jsonb;
    parent_row record;
BEGIN
    NEW.reply_to := NULL;

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
            NEW.reply_to := parent_row.id;
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
-- 2. EARLIER VERSIONS, FOR MODERATORS
-- =========================================================================
--
-- The report queue reads a post as it is now (list_content_reports). Without
-- these, a post reported for what it said could be edited into something else
-- before a moderator looked.

CREATE TABLE IF NOT EXISTS "public"."page_discussion_edits" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "post_id" uuid NOT NULL,
    -- The words as they were before this edit.
    "body" text NOT NULL,
    "edited_at" timestamptz NOT NULL DEFAULT now(),
    -- NULL for an edit made on Discord.
    "edited_by" uuid,
    CONSTRAINT "page_discussion_edits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "page_discussion_edits_post_fkey" FOREIGN KEY ("post_id")
        REFERENCES "public"."page_discussions"("id") ON DELETE CASCADE,
    CONSTRAINT "page_discussion_edits_by_fkey" FOREIGN KEY ("edited_by")
        REFERENCES "auth"."users"("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "public"."forum_thread_edits" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "thread_id" uuid NOT NULL,
    -- The title and category as they were before this edit.
    "title" text NOT NULL,
    "tag" text NOT NULL,
    "edited_at" timestamptz NOT NULL DEFAULT now(),
    "edited_by" uuid,
    CONSTRAINT "forum_thread_edits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "forum_thread_edits_thread_fkey" FOREIGN KEY ("thread_id")
        REFERENCES "public"."forum_threads"("id") ON DELETE CASCADE,
    CONSTRAINT "forum_thread_edits_by_fkey" FOREIGN KEY ("edited_by")
        REFERENCES "auth"."users"("id") ON DELETE SET NULL
);

ALTER TABLE "public"."page_discussion_edits" OWNER TO "postgres";
ALTER TABLE "public"."forum_thread_edits" OWNER TO "postgres";
ALTER TABLE "public"."page_discussion_edits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."forum_thread_edits" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "page_discussion_edits_post_idx"
    ON "public"."page_discussion_edits" ("post_id", "edited_at" DESC);
CREATE INDEX IF NOT EXISTS "forum_thread_edits_thread_idx"
    ON "public"."forum_thread_edits" ("thread_id", "edited_at" DESC);

CREATE POLICY "Moderators read earlier versions" ON "public"."page_discussion_edits"
    FOR SELECT TO "authenticated" USING ("public"."can_moderate"());
CREATE POLICY "Moderators read earlier titles" ON "public"."forum_thread_edits"
    FOR SELECT TO "authenticated" USING ("public"."can_moderate"());

-- No write policy: rows are written only by the functions below.
REVOKE ALL ON TABLE "public"."page_discussion_edits" FROM "anon";
REVOKE ALL ON TABLE "public"."page_discussion_edits" FROM "authenticated";
REVOKE ALL ON TABLE "public"."forum_thread_edits" FROM "anon";
REVOKE ALL ON TABLE "public"."forum_thread_edits" FROM "authenticated";
GRANT SELECT ON TABLE "public"."page_discussion_edits" TO "authenticated";
GRANT SELECT ON TABLE "public"."forum_thread_edits" TO "authenticated";

-- A message its author deleted, on either side, is gone for good, as the
-- wiki's delete prompt promises: its earlier versions go with it. A
-- moderator's removal keeps them.
CREATE OR REPLACE FUNCTION "public"."forget_discussion_edits"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF NEW.status IN ('removed_by_author', 'removed_on_discord')
       AND OLD.status IS DISTINCT FROM NEW.status THEN
        DELETE FROM public.page_discussion_edits WHERE post_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."forget_discussion_edits"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."forget_discussion_edits"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."forget_discussion_edits"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."forget_discussion_edits"() FROM "authenticated";

CREATE OR REPLACE TRIGGER "trigger_forget_discussion_edits"
    AFTER UPDATE OF "status" ON "public"."page_discussions"
    FOR EACH ROW EXECUTE FUNCTION "public"."forget_discussion_edits"();

CREATE OR REPLACE FUNCTION "public"."forget_forum_thread_edits"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF NEW.status = 'removed_on_discord' AND OLD.status IS DISTINCT FROM NEW.status THEN
        DELETE FROM public.forum_thread_edits WHERE thread_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."forget_forum_thread_edits"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."forget_forum_thread_edits"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."forget_forum_thread_edits"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."forget_forum_thread_edits"() FROM "authenticated";

CREATE OR REPLACE TRIGGER "trigger_forget_forum_thread_edits"
    AFTER UPDATE OF "status" ON "public"."forum_threads"
    FOR EACH ROW EXECUTE FUNCTION "public"."forget_forum_thread_edits"();


-- =========================================================================
-- 3. EDITING
-- =========================================================================

ALTER TABLE "public"."forum_threads"
    ADD COLUMN IF NOT EXISTS "edited_at" timestamptz;

-- An author changes the words of their own post or reply. The words only:
-- the owner chose not pictures. The same body rules as posting. One edit per
-- post every 10 seconds, because each one is also a request to Discord.
CREATE OR REPLACE FUNCTION "public"."edit_my_discussion_post"("p_post_id" uuid, "p_body" text)
RETURNS timestamptz
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    target record;
    new_body text := btrim(COALESCE("p_body", ''));
    stamp timestamptz := now();
BEGIN
    IF "auth"."uid"() IS NULL THEN
        RAISE EXCEPTION 'You must be signed in.' USING ERRCODE = '42501';
    END IF;

    -- viewer is a ban, tested by name (CLAUDE.md, Roles).
    IF "public"."get_my_role"() IS NOT DISTINCT FROM 'viewer' THEN
        RAISE EXCEPTION 'Your account cannot edit posts.' USING ERRCODE = '42501';
    END IF;

    SELECT id, author_id, source, status, body, images, page_id, edited_at INTO target
    FROM public.page_discussions WHERE id = "p_post_id"
    FOR UPDATE;

    IF target.id IS NULL THEN
        RAISE EXCEPTION 'That post no longer exists.' USING ERRCODE = 'P0002';
    END IF;

    IF target.source IS DISTINCT FROM 'site' OR target.author_id IS DISTINCT FROM "auth"."uid"() THEN
        RAISE EXCEPTION 'You can only edit your own posts.' USING ERRCODE = '42501';
    END IF;

    IF target.status IS DISTINCT FROM 'visible' THEN
        RAISE EXCEPTION 'That post can no longer be edited.' USING ERRCODE = '22023';
    END IF;

    IF target.page_id LIKE 'forum:%' AND NOT EXISTS (
        SELECT 1 FROM public.forum_threads ft
        WHERE 'forum:' || ft.id::text = target.page_id AND ft.status = 'visible'
    ) THEN
        RAISE EXCEPTION 'That forum post is closed.' USING ERRCODE = '22023';
    END IF;

    IF char_length(new_body) > 4000 THEN
        RAISE EXCEPTION 'A post can be at most 4,000 characters.' USING ERRCODE = '22023';
    END IF;

    IF new_body = '' AND cardinality(COALESCE(target.images, '{}'::text[])) = 0 THEN
        RAISE EXCEPTION 'A post needs words or an image.' USING ERRCODE = '22023';
    END IF;

    IF new_body = target.body THEN
        RETURN target.edited_at;
    END IF;

    IF target.edited_at > stamp - interval '10 seconds' THEN
        RAISE EXCEPTION 'Slow down - you can edit a post once every 10 seconds.'
            USING ERRCODE = '53400';
    END IF;

    INSERT INTO public.page_discussion_edits (post_id, body, edited_at, edited_by)
    VALUES (target.id, target.body, stamp, "auth"."uid"());

    UPDATE public.page_discussions
    SET body = new_body, edited_at = stamp
    WHERE id = target.id;

    RETURN stamp;
END;
$$;

ALTER FUNCTION "public"."edit_my_discussion_post"(uuid, text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."edit_my_discussion_post"(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."edit_my_discussion_post"(uuid, text) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."edit_my_discussion_post"(uuid, text) TO "authenticated";

-- The person who started a forum post changes its title or category. The same
-- rules as create_forum_post. One rename every 5 minutes: Discord limits how
-- often a channel is renamed.
CREATE OR REPLACE FUNCTION "public"."edit_my_forum_post"("p_thread_id" uuid, "p_title" text, "p_tag" text)
RETURNS timestamptz
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    target record;
    clean_title text := btrim(COALESCE("p_title", ''));
    stamp timestamptz := now();
BEGIN
    IF "auth"."uid"() IS NULL THEN
        RAISE EXCEPTION 'You must be signed in.' USING ERRCODE = '42501';
    END IF;

    IF "public"."get_my_role"() IS NOT DISTINCT FROM 'viewer' THEN
        RAISE EXCEPTION 'Your account cannot edit posts.' USING ERRCODE = '42501';
    END IF;

    SELECT id, author_id, source, status, title, tag, edited_at INTO target
    FROM public.forum_threads WHERE id = "p_thread_id"
    FOR UPDATE;

    IF target.id IS NULL THEN
        RAISE EXCEPTION 'That forum post no longer exists.' USING ERRCODE = 'P0002';
    END IF;

    IF target.source IS DISTINCT FROM 'site' OR target.author_id IS DISTINCT FROM "auth"."uid"() THEN
        RAISE EXCEPTION 'You can only edit a post you started.' USING ERRCODE = '42501';
    END IF;

    IF target.status IS DISTINCT FROM 'visible' THEN
        RAISE EXCEPTION 'That forum post is closed.' USING ERRCODE = '22023';
    END IF;

    IF char_length(clean_title) < 1 OR char_length(clean_title) > 100 OR clean_title ~ '[\r\n]' THEN
        RAISE EXCEPTION 'A post needs a title of up to 100 characters, on one line.' USING ERRCODE = '22023';
    END IF;

    IF "p_tag" IS NULL OR NOT ("p_tag" = ANY (ARRAY['Question', 'Guide', 'Discussion', 'Art', 'Game Update', 'Promotion'])) THEN
        RAISE EXCEPTION 'Pick a category for the post.' USING ERRCODE = '22023';
    END IF;

    IF clean_title = target.title AND "p_tag" = target.tag THEN
        RETURN target.edited_at;
    END IF;

    IF target.edited_at > stamp - interval '5 minutes' THEN
        RAISE EXCEPTION 'Slow down - you can rename a post once every 5 minutes.'
            USING ERRCODE = '53400';
    END IF;

    INSERT INTO public.forum_thread_edits (thread_id, title, tag, edited_at, edited_by)
    VALUES (target.id, target.title, target.tag, stamp, "auth"."uid"());

    UPDATE public.forum_threads
    SET title = clean_title, tag = "p_tag", edited_at = stamp
    WHERE id = target.id;

    RETURN stamp;
END;
$$;

ALTER FUNCTION "public"."edit_my_forum_post"(uuid, text, text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."edit_my_forum_post"(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."edit_my_forum_post"(uuid, text, text) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."edit_my_forum_post"(uuid, text, text) TO "authenticated";


-- =========================================================================
-- 4. NOTIFICATIONS
-- =========================================================================
--
-- Body carried from 20261004000002. A reply to a reply also tells the person
-- answered; the author of the post at the top is still told, unless they are
-- that same person. Nobody is told about their own words.
CREATE OR REPLACE FUNCTION "public"."notify_discussion_reply"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    parent_author uuid;
    answered_author uuid;
    page_url text;
    thread_title text;
    link text;
    where_said text;
BEGIN
    IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;

    SELECT author_id INTO parent_author
    FROM public.page_discussions WHERE id = NEW.parent_id;

    IF NEW.reply_to IS NOT NULL THEN
        SELECT author_id INTO answered_author
        FROM public.page_discussions WHERE id = NEW.reply_to;
    END IF;

    IF NEW.page_id LIKE 'forum:%' THEN
        SELECT title INTO thread_title
        FROM public.forum_threads WHERE id = substring(NEW.page_id FROM 7)::uuid;
        link := 'forum.html?post=' || substring(NEW.page_id FROM 7) || '#post-' || NEW.parent_id;
        where_said := 'in the forum: ' || COALESCE(NULLIF(thread_title, ''), 'a post') || '.';
    ELSE
        SELECT url INTO page_url FROM public.site_pages WHERE page_id = NEW.page_id;
        link := COALESCE(page_url, 'index.html') || '#post-' || NEW.parent_id;
        where_said := 'on ' || upper(NEW.page_id) || '.';
    END IF;

    IF answered_author IS NOT NULL AND answered_author IS DISTINCT FROM NEW.author_id THEN
        INSERT INTO public.user_notifications (user_id, message, link)
        VALUES (answered_author, NEW.author_name || ' replied to you ' || where_said, link);
    END IF;

    IF parent_author IS NOT NULL
       AND parent_author IS DISTINCT FROM NEW.author_id
       AND parent_author IS DISTINCT FROM answered_author THEN
        INSERT INTO public.user_notifications (user_id, message, link)
        VALUES (parent_author, NEW.author_name || ' replied to your post ' || where_said, link);
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."notify_discussion_reply"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."notify_discussion_reply"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."notify_discussion_reply"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."notify_discussion_reply"() FROM "authenticated";


-- =========================================================================
-- 5. THE RELAY
-- =========================================================================

-- The wiki edit last carried to Discord, so a newer one is seen; and how many
-- times an edit has failed, kept apart from `attempts` (sends), because a
-- failed edit must never be read as a failed send and sent again.
ALTER TABLE "public"."discord_messages"
    ADD COLUMN IF NOT EXISTS "synced_edit_at" timestamptz;
ALTER TABLE "public"."discord_messages"
    ADD COLUMN IF NOT EXISTS "edit_attempts" integer NOT NULL DEFAULT 0;

-- The wiki rename last carried to Discord.
ALTER TABLE "public"."discord_threads"
    ADD COLUMN IF NOT EXISTS "renamed_edit_at" timestamptz;

-- Body carried from 20261004000000, with three changes. DROP first: a new
-- output column is a new return type (42P13).
--   * `edit`: a wiki post sent to Discord and edited since, with everything a
--     send needs, so the copy is rebuilt with its quote line.
--   * The quote line is of the reply a reply answers, not the post at the top.
--   * `edited_at` goes out with each row, so a send records which edit it
--     carried and is not edited again for nothing.
DROP FUNCTION IF EXISTS "public"."discord_relay_outbox"(integer);

CREATE FUNCTION "public"."discord_relay_outbox"("p_limit" integer)
RETURNS TABLE (
    "action" text,
    "post_id" uuid,
    "page_id" text,
    "page_url" text,
    "parent_id" uuid,
    "body" text,
    "images" text[],
    "author_name" text,
    "author_discord_id" text,
    "parent_author_name" text,
    "parent_body" text,
    "channel" text,
    "discord_thread_id" text,
    "discord_message_id" text,
    "attempts" integer,
    "edited_at" timestamptz
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
        SELECT 'send'::text, p.id, p.page_id, sp.url, p.parent_id, p.body, p.images, p.author_name,
               ident.provider_id, pp.author_name,
               CASE WHEN pp.status = 'visible' THEN pp.body ELSE '' END,
               dt.channel, dt.discord_thread_id, NULL::text, COALESCE(dm.attempts, 0), p.edited_at
        FROM public.page_discussions p
        JOIN public.discord_threads dt ON dt.site_key = p.page_id
        LEFT JOIN public.discord_messages dm ON dm.post_id = p.id
        LEFT JOIN public.page_discussions pp ON pp.id = COALESCE(p.reply_to, p.parent_id)
        LEFT JOIN public.site_pages sp ON sp.page_id = p.page_id
        LEFT JOIN LATERAL (
            SELECT i.provider_id FROM auth.identities i
            WHERE i.user_id = p.author_id AND i.provider = 'discord'
            LIMIT 1
        ) ident ON true
        WHERE p.source = 'site'
          AND p.status = 'visible'
          AND p.created_at >= dt.linked_at
          AND (dm.post_id IS NULL
               OR dm.state = 'deleted'
               OR (dm.state = 'failed' AND dm.attempts < 5))
        ORDER BY p.created_at, p.id
        LIMIT GREATEST(1, LEAST(COALESCE("p_limit", 10), 50))
    )
    UNION ALL
    (
        SELECT 'edit'::text, p.id, p.page_id, sp.url, p.parent_id, p.body, p.images, p.author_name,
               ident.provider_id, pp.author_name,
               CASE WHEN pp.status = 'visible' THEN pp.body ELSE '' END,
               dt.channel, dm.discord_thread_id, dm.discord_message_id, dm.edit_attempts, p.edited_at
        FROM public.discord_messages dm
        JOIN public.page_discussions p ON p.id = dm.post_id
        JOIN public.discord_threads dt ON dt.discord_thread_id = dm.discord_thread_id
        LEFT JOIN public.page_discussions pp ON pp.id = COALESCE(p.reply_to, p.parent_id)
        LEFT JOIN public.site_pages sp ON sp.page_id = p.page_id
        LEFT JOIN LATERAL (
            SELECT i.provider_id FROM auth.identities i
            WHERE i.user_id = p.author_id AND i.provider = 'discord'
            LIMIT 1
        ) ident ON true
        WHERE dm.direction = 'to_discord'
          AND dm.state = 'sent'
          AND dm.discord_message_id IS NOT NULL
          AND p.source = 'site'
          AND p.status = 'visible'
          AND p.edited_at IS NOT NULL
          AND p.edited_at IS DISTINCT FROM dm.synced_edit_at
          AND dm.edit_attempts < 5
        ORDER BY p.edited_at, p.id
        LIMIT GREATEST(1, LEAST(COALESCE("p_limit", 10), 50))
    )
    UNION ALL
    (
        SELECT CASE WHEN dm.direction = 'to_discord' THEN 'delete' ELSE 'delete_original' END,
               p.id, p.page_id, NULL::text, p.parent_id, NULL::text, NULL::text[], NULL::text,
               NULL::text, NULL::text, NULL::text,
               dt.channel, dm.discord_thread_id, dm.discord_message_id, dm.attempts, NULL::timestamptz
        FROM public.discord_messages dm
        JOIN public.page_discussions p ON p.id = dm.post_id
        JOIN public.discord_threads dt ON dt.discord_thread_id = dm.discord_thread_id
        WHERE dm.state = 'sent'
          AND dm.discord_message_id IS NOT NULL
          AND ((dm.direction = 'to_discord' AND p.status <> 'visible')
               OR (dm.direction = 'from_discord' AND p.status = 'removed_by_staff'))
        ORDER BY dm.updated_at
        LIMIT GREATEST(1, LEAST(COALESCE("p_limit", 10), 50))
    );
END;
$$;

ALTER FUNCTION "public"."discord_relay_outbox"(integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."discord_relay_outbox"(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_outbox"(integer) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_outbox"(integer) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_outbox"(integer) TO "service_role";

-- Which wiki edit a Discord copy now carries (p_error NULL), or that carrying
-- it failed. The message stays `sent` either way.
CREATE OR REPLACE FUNCTION "public"."discord_relay_edit_result"(
    "p_post_id" uuid, "p_edited_at" timestamptz, "p_error" text
)
RETURNS void
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    IF "p_error" IS NULL THEN
        UPDATE public.discord_messages
        SET synced_edit_at = "p_edited_at", edit_attempts = 0, last_error = NULL, updated_at = now()
        WHERE post_id = "p_post_id";
    ELSE
        UPDATE public.discord_messages
        SET edit_attempts = edit_attempts + 1, last_error = left("p_error", 500), updated_at = now()
        WHERE post_id = "p_post_id";
    END IF;
END;
$$;

ALTER FUNCTION "public"."discord_relay_edit_result"(uuid, timestamptz, text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."discord_relay_edit_result"(uuid, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_edit_result"(uuid, timestamptz, text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_edit_result"(uuid, timestamptz, text) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_edit_result"(uuid, timestamptz, text) TO "service_role";

-- Forum posts renamed on the wiki and not yet on Discord, with the starter's
-- Discord id when their account is linked (rule 9 covers a title too).
CREATE OR REPLACE FUNCTION "public"."discord_relay_forum_renames"("p_limit" integer)
RETURNS TABLE ("thread_id" uuid, "title" text, "tag" text, "edited_at" timestamptz, "discord_thread_id" text, "author_discord_id" text)
LANGUAGE "plpgsql" STABLE SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT ft.id, ft.title, ft.tag, ft.edited_at, dt.discord_thread_id, ident.provider_id
    FROM public.forum_threads ft
    JOIN public.discord_threads dt ON dt.site_key = 'forum:' || ft.id::text
    LEFT JOIN LATERAL (
        SELECT i.provider_id FROM auth.identities i
        WHERE i.user_id = ft.author_id AND i.provider = 'discord'
        LIMIT 1
    ) ident ON true
    WHERE ft.status = 'visible'
      AND ft.edited_at IS NOT NULL
      AND ft.edited_at IS DISTINCT FROM dt.renamed_edit_at
    ORDER BY ft.edited_at
    LIMIT GREATEST(1, LEAST(COALESCE("p_limit", 5), 20));
END;
$$;

ALTER FUNCTION "public"."discord_relay_forum_renames"(integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."discord_relay_forum_renames"(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_forum_renames"(integer) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_forum_renames"(integer) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_forum_renames"(integer) TO "service_role";

CREATE OR REPLACE FUNCTION "public"."discord_relay_renamed"("p_discord_thread_id" text, "p_edited_at" timestamptz)
RETURNS void
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.discord_threads SET renamed_edit_at = "p_edited_at"
    WHERE discord_thread_id = "p_discord_thread_id";
END;
$$;

ALTER FUNCTION "public"."discord_relay_renamed"(text, timestamptz) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."discord_relay_renamed"(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_renamed"(text, timestamptz) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_renamed"(text, timestamptz) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_renamed"(text, timestamptz) TO "service_role";

-- Body carried from 20261004000002, with two changes:
--   * a post renamed on the wiki and not yet on Discord is left alone, or the
--     sweep would copy Discord's old name back over the new one;
--   * the title and category it replaces are kept for moderators.
CREATE OR REPLACE FUNCTION "public"."discord_relay_forum_rename"(
    "p_discord_thread_id" text, "p_title" text, "p_tag" text
)
RETURNS void
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    clean_title text := left(btrim(regexp_replace(COALESCE("p_title", ''), '[\r\n]+', ' ', 'g')), 100);
    target record;
    new_title text;
    new_tag text;
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    SELECT ft.id, ft.title, ft.tag INTO target
    FROM public.forum_threads ft
    JOIN public.discord_threads dt ON dt.site_key = 'forum:' || ft.id::text
    WHERE dt.discord_thread_id = "p_discord_thread_id"
      AND ft.status = 'visible'
      AND (ft.edited_at IS NULL OR ft.edited_at IS NOT DISTINCT FROM dt.renamed_edit_at)
    FOR UPDATE OF ft;

    IF target.id IS NULL THEN
        RETURN;
    END IF;

    new_title := CASE WHEN clean_title <> '' THEN clean_title ELSE target.title END;
    new_tag := CASE WHEN "p_tag" = ANY (ARRAY['Question', 'Guide', 'Discussion', 'Art', 'Game Update', 'Promotion'])
                    THEN "p_tag" ELSE target.tag END;

    IF new_title = target.title AND new_tag = target.tag THEN
        RETURN;
    END IF;

    INSERT INTO public.forum_thread_edits (thread_id, title, tag, edited_at, edited_by)
    VALUES (target.id, target.title, target.tag, now(), NULL);

    UPDATE public.forum_threads SET title = new_title, tag = new_tag
    WHERE id = target.id;
END;
$$;

REVOKE ALL ON FUNCTION "public"."discord_relay_forum_rename"(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_forum_rename"(text, text, text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_forum_rename"(text, text, text) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_forum_rename"(text, text, text) TO "service_role";

-- Body carried from 20261004000000, with one change: the words it replaces are
-- kept for moderators, as a wiki edit's are.
CREATE OR REPLACE FUNCTION "public"."discord_relay_edit"("p_discord_message_id" text, "p_body" text)
RETURNS void
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    new_body text := left(COALESCE("p_body", ''), 4000);
    target record;
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    SELECT p.id, p.body INTO target
    FROM public.page_discussions p
    JOIN public.discord_messages dm ON dm.post_id = p.id
    WHERE dm.discord_message_id = "p_discord_message_id"
      AND dm.direction = 'from_discord'
      AND p.source = 'discord'
      AND p.status = 'visible'
    FOR UPDATE OF p;

    IF target.id IS NULL OR target.body IS NOT DISTINCT FROM new_body THEN
        RETURN;
    END IF;

    INSERT INTO public.page_discussion_edits (post_id, body, edited_at, edited_by)
    VALUES (target.id, target.body, now(), NULL);

    UPDATE public.page_discussions SET body = new_body, edited_at = now()
    WHERE id = target.id;
END;
$$;

REVOKE ALL ON FUNCTION "public"."discord_relay_edit"(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_edit"(text, text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_edit"(text, text) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_edit"(text, text) TO "service_role";
