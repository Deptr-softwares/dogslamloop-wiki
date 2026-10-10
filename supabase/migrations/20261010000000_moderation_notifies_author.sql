-- v1.0 Part 3: hiding or removing a post tells its author why.
--
-- The owner, 2026-10-10, on the Terms of Service's strikes: "I think it is
-- best the site send a notification with the reason when their post is hidden
-- or removed."
--
-- Before this, a moderator had to give a reason (both functions refuse an
-- empty one), but the reason went into moderation_log alone. The author was
-- never told, so a strike from a hidden post was invisible to the person it
-- was given to. A rejected submission has always notified its author with the
-- staff note (js/admin-actions.js); this does the same for posts, in the same
-- words: 'Staff Note: "..."'.
--
-- Who is told:
--   * the post's author_id, on hide and on remove;
--   * nobody on restore (not asked for);
--   * nobody when author_id is NULL: a post copied from Discord by someone
--     with no wiki account, or an anonymized author. user_notifications.user_id
--     references auth.users, so a NULL would fail the insert anyway;
--   * nobody when the moderator is the author.
--
-- Also fixed, since both bodies are replaced here: the reply read
-- 'Post hided.' ('Post ' || action || 'd.'). Nothing on the site reads it
-- (js/discussions.js, js/forum.js and js/admin-reports.js check only the
-- error), so the wording changes nothing else.
--
-- Bodies carried from 20260928000000 (moderate_discussion_post) and
-- 20261004000002 (moderate_forum_thread). What is new is marked NEW.


-- =========================================================================
-- 1. A POST ON A PAGE OR IN THE FORUM (page_discussions)
-- =========================================================================

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
    -- NEW: the notification's parts.
    thread_title text;
    page_url text;
    notice_where text;
    notice_link text;
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

    -- NEW: author_id, for the notification.
    SELECT id, page_id, body, images, status, author_name, author_id
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

    -- NEW: tell the author. The links are the ones reply notifications build
    -- (20261004000002, section 5), so a click lands on the post.
    --
    -- The thread is matched on id::text rather than by casting the page_id to
    -- uuid: a cast that fails would raise and undo the moderation itself.
    IF "p_action" <> 'restore'
       AND target.author_id IS NOT NULL
       AND target.author_id IS DISTINCT FROM auth.uid() THEN
        IF target.page_id LIKE 'forum:%' THEN
            SELECT title INTO thread_title
              FROM public.forum_threads
             WHERE id::text = substring(target.page_id FROM 7);
            notice_where := 'in the forum post "' || COALESCE(NULLIF(thread_title, ''), 'a post') || '"';
            notice_link := 'forum.html?post=' || substring(target.page_id FROM 7) || '#post-' || target.id::text;
        ELSE
            SELECT url INTO page_url FROM public.site_pages WHERE page_id = target.page_id;
            notice_where := 'on ' || upper(target.page_id);
            notice_link := COALESCE(page_url, 'index.html') || '#post-' || target.id::text;
        END IF;

        INSERT INTO public.user_notifications (user_id, message, link)
        VALUES (
            target.author_id,
            'Your post ' || notice_where || ' was '
                || CASE WHEN "p_action" = 'hide' THEN 'hidden' ELSE 'removed' END
                || '. Staff Note: "' || btrim("p_reason") || '"',
            notice_link
        );
    END IF;

    -- NEW: 'Post hidden.', not 'Post hided.'.
    RETURN CASE "p_action"
        WHEN 'hide' THEN 'Post hidden.'
        WHEN 'remove' THEN 'Post removed.'
        ELSE 'Post restored.'
    END;
END;
$$;

ALTER FUNCTION "public"."moderate_discussion_post"(uuid, text, text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."moderate_discussion_post"(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."moderate_discussion_post"(uuid, text, text) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."moderate_discussion_post"(uuid, text, text) TO "authenticated";


-- =========================================================================
-- 2. A FORUM POST ITSELF (forum_threads)
-- =========================================================================

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

    -- NEW: author_id, for the notification. The title is read here, before a
    -- remove blanks it, so the notification can still name the post.
    SELECT id, title, status, author_name, author_id INTO target
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

    -- NEW: tell the author, as above. A post copied from Discord has no
    -- author_id, so its writer is not told here.
    IF "p_action" <> 'restore'
       AND target.author_id IS NOT NULL
       AND target.author_id IS DISTINCT FROM auth.uid() THEN
        INSERT INTO public.user_notifications (user_id, message, link)
        VALUES (
            target.author_id,
            'Your forum post "' || COALESCE(NULLIF(target.title, ''), 'a post') || '" was '
                || CASE WHEN "p_action" = 'hide' THEN 'hidden' ELSE 'removed' END
                || '. Staff Note: "' || btrim("p_reason") || '"',
            'forum.html?post=' || target.id::text
        );
    END IF;

    -- NEW: 'Post hidden.', not 'Post hided.'.
    RETURN CASE "p_action"
        WHEN 'hide' THEN 'Post hidden.'
        WHEN 'remove' THEN 'Post removed.'
        ELSE 'Post restored.'
    END;
END;
$$;

ALTER FUNCTION "public"."moderate_forum_thread"(uuid, text, text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."moderate_forum_thread"(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."moderate_forum_thread"(uuid, text, text) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."moderate_forum_thread"(uuid, text, text) TO "authenticated";
