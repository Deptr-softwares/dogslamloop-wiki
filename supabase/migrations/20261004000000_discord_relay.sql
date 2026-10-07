-- v1.0 batch 1: the Discord relay, on the character threads.
--
-- Spec: V1.0-DEVLOG.md, "SPEC 2026-10-04: batch 1". The owner, 2026-10-02:
-- each character's thread on the wiki is linked to its own post in a Discord
-- forum channel, and a message written on either side shows on both.
--
-- The relay is an Edge Function (supabase/functions/discord-relay) that Supabase
-- Cron calls every 10 seconds. It runs as the service role and reaches the
-- database ONLY through the functions below, each of which refuses any other
-- caller. Nothing here is reachable from a browser.
--
-- What this migration adds:
--
--   1. page_discussions learns where a post came from: `source`, the Discord
--      author's id and @handle, `edited_at`, and the status
--      `removed_on_discord`.
--   2. The shape trigger gains the relay's own path. A browser can never take
--      it: `source` is forced to 'site' unless the request carries the service
--      role's JWT, which only the relay holds.
--   3. Two link tables and a one-row lease, service role only.
--   4. The relay's functions.
--   5. A `discord-media` bucket for pictures copied off Discord, whose links
--      expire (CLAUDE.md, the media rule).
--   6. The 10-second schedule. With no secrets in Vault it does nothing, which
--      is what every preview branch gets.


-- =========================================================================
-- 1. WHERE A POST CAME FROM
-- =========================================================================

ALTER TABLE "public"."page_discussions"
    ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'site',
    ADD COLUMN IF NOT EXISTS "discord_author_id" text,
    ADD COLUMN IF NOT EXISTS "discord_author_handle" text,
    ADD COLUMN IF NOT EXISTS "edited_at" timestamptz;

-- A Discord post has no wiki account behind it, and a wiki post has no Discord
-- author. Stated as one constraint so neither half can drift from the other.
ALTER TABLE "public"."page_discussions"
    DROP CONSTRAINT IF EXISTS "page_discussions_source_check";

ALTER TABLE "public"."page_discussions"
    ADD CONSTRAINT "page_discussions_source_check" CHECK (
        ("source" = 'site'
            AND "discord_author_id" IS NULL
            AND "discord_author_handle" IS NULL)
        OR
        ("source" = 'discord'
            AND "author_id" IS NULL
            AND "discord_author_id" ~ '^[0-9]{5,20}$'
            AND ("discord_author_handle" IS NULL OR char_length("discord_author_handle") <= 32))
    );

ALTER TABLE "public"."page_discussions"
    DROP CONSTRAINT IF EXISTS "page_discussions_status_check";

ALTER TABLE "public"."page_discussions"
    ADD CONSTRAINT "page_discussions_status_check" CHECK ("status" = ANY (ARRAY[
        'visible'::text, 'hidden'::text, 'removed_by_author'::text, 'removed_by_staff'::text,
        'removed_on_discord'::text
    ]));


-- =========================================================================
-- 2. THE SHAPE TRIGGER, WITH THE RELAY'S PATH
-- =========================================================================
--
-- Body carried from 20260928000001; the site path is unchanged.
--
-- The relay path is chosen by two things together: the row says
-- source = 'discord' AND the request's JWT role is service_role. The second
-- cannot be forged without the project's JWT secret. Every other insert is
-- forced to source = 'site' and goes through the original rules, including
-- `author_id := auth.uid()`, so a service-role insert of a wiki post still
-- fails for want of a signed-in author.
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
        -- A message copied off Discord. The relay supplies the author, from
        -- Discord; there is no wiki account to read it from.
        NEW.author_id := NULL;
        NEW.author_name := left(COALESCE(NULLIF(btrim(NEW.author_name), ''), 'Discord member'), 80);
        NEW.edited_at := NULL;
        NEW.status := 'visible';
        NEW.removed_at := NULL;
        NEW.removed_by := NULL;
        NEW.images := COALESCE(NEW.images, '{}'::text[]);

        -- Copies the relay made into discord-media, named after the message.
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

    RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."enforce_discussion_shape"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."enforce_discussion_shape"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."enforce_discussion_shape"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."enforce_discussion_shape"() FROM "authenticated";


-- =========================================================================
-- 3. THE LINK TABLES
-- =========================================================================
--
-- RLS on and no policy at all: no browser reads or writes these. The relay
-- reaches them through the functions in section 4, as the service role.

-- A wiki thread and the Discord forum post it is linked to. site_key is the
-- page_id for a character thread; forum threads come in batch 2.
CREATE TABLE IF NOT EXISTS "public"."discord_threads" (
    "site_key" text NOT NULL,
    "channel" text NOT NULL,
    "discord_thread_id" text NOT NULL,
    -- Start fresh (owner, 2026-10-02): only posts from this moment are sent.
    "linked_at" timestamptz NOT NULL DEFAULT now(),
    -- The newest Discord message already read. A snowflake, so it orders by time.
    "last_message_id" text,
    "checked_at" timestamptz,
    CONSTRAINT "discord_threads_pkey" PRIMARY KEY ("site_key"),
    CONSTRAINT "discord_threads_thread_key" UNIQUE ("discord_thread_id"),
    CONSTRAINT "discord_threads_channel_check" CHECK ("channel" = ANY (ARRAY['character'::text, 'forum'::text])),
    CONSTRAINT "discord_threads_ids_check" CHECK (
        "discord_thread_id" ~ '^[0-9]{5,20}$'
        AND ("last_message_id" IS NULL OR "last_message_id" ~ '^[0-9]{5,20}$')
    )
);

ALTER TABLE "public"."discord_threads" OWNER TO "postgres";
ALTER TABLE "public"."discord_threads" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."discord_threads" FROM "anon";
REVOKE ALL ON TABLE "public"."discord_threads" FROM "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."discord_threads" TO "service_role";

-- One wiki post and its Discord twin. `direction` says which is the original:
-- 'to_discord' is a wiki post the webhook copied out, 'from_discord' a Discord
-- message copied in. Deleting the post deletes the link.
CREATE TABLE IF NOT EXISTS "public"."discord_messages" (
    "post_id" uuid NOT NULL,
    "discord_thread_id" text NOT NULL,
    -- NULL until a send succeeds, and for a post that is never sent.
    "discord_message_id" text,
    "direction" text NOT NULL,
    "state" text NOT NULL,
    "attempts" integer NOT NULL DEFAULT 0,
    "last_error" text,
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "discord_messages_pkey" PRIMARY KEY ("post_id"),
    CONSTRAINT "discord_messages_message_key" UNIQUE ("discord_message_id"),
    CONSTRAINT "discord_messages_post_fkey" FOREIGN KEY ("post_id")
        REFERENCES "public"."page_discussions"("id") ON DELETE CASCADE,
    CONSTRAINT "discord_messages_direction_check" CHECK ("direction" = ANY (ARRAY['to_discord'::text, 'from_discord'::text])),
    -- sending: claimed by a tick, not yet answered. A crash leaves it here, and
    -- it is never sent again: a missing copy beats a doubled one.
    -- sent: on Discord now. deleted: taken off Discord. skipped: never to be
    -- sent (a banned author). failed: Discord kept refusing it.
    CONSTRAINT "discord_messages_state_check" CHECK ("state" = ANY (ARRAY[
        'sending'::text, 'sent'::text, 'deleted'::text, 'skipped'::text, 'failed'::text
    ])),
    CONSTRAINT "discord_messages_ids_check" CHECK (
        "discord_thread_id" ~ '^[0-9]{5,20}$'
        AND ("discord_message_id" IS NULL OR "discord_message_id" ~ '^[0-9]{5,20}$')
    ),
    CONSTRAINT "discord_messages_error_length" CHECK ("last_error" IS NULL OR char_length("last_error") <= 500)
);

ALTER TABLE "public"."discord_messages" OWNER TO "postgres";
ALTER TABLE "public"."discord_messages" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."discord_messages" FROM "anon";
REVOKE ALL ON TABLE "public"."discord_messages" FROM "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."discord_messages" TO "service_role";

CREATE INDEX IF NOT EXISTS "discord_messages_state_idx"
    ON "public"."discord_messages" ("state", "direction");

-- One row: a lease, so two ticks never run at once. A tick that takes longer
-- than 10 seconds would otherwise meet the next one halfway through a send.
CREATE TABLE IF NOT EXISTS "public"."discord_relay_state" (
    "id" integer NOT NULL DEFAULT 1,
    "running_until" timestamptz,
    "last_sweep_at" timestamptz,
    CONSTRAINT "discord_relay_state_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "discord_relay_state_one_row" CHECK ("id" = 1)
);

ALTER TABLE "public"."discord_relay_state" OWNER TO "postgres";
ALTER TABLE "public"."discord_relay_state" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."discord_relay_state" FROM "anon";
REVOKE ALL ON TABLE "public"."discord_relay_state" FROM "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."discord_relay_state" TO "service_role";

INSERT INTO "public"."discord_relay_state" ("id") VALUES (1)
ON CONFLICT ("id") DO NOTHING;


-- =========================================================================
-- 4. THE RELAY'S FUNCTIONS
-- =========================================================================
--
-- SECURITY DEFINER, because the outbox reads auth.identities (a linked
-- Discord account) and the relay writes rows the shape trigger would refuse
-- from anyone else. Each one refuses any caller but the service role, first
-- thing, and none is granted to anon or authenticated.

-- Take the lease, or learn that another tick holds it. Also says whether the
-- once-a-minute sweep is due, and claims it.
CREATE OR REPLACE FUNCTION "public"."discord_relay_claim"("p_seconds" integer)
RETURNS jsonb
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    claimed boolean := false;
    sweep_due boolean := false;
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.discord_relay_state
    SET running_until = now() + make_interval(secs => GREATEST(5, LEAST(COALESCE("p_seconds", 60), 300)))
    WHERE id = 1 AND (running_until IS NULL OR running_until < now())
    RETURNING true INTO claimed;

    IF COALESCE(claimed, false) THEN
        UPDATE public.discord_relay_state
        SET last_sweep_at = now()
        WHERE id = 1 AND (last_sweep_at IS NULL OR last_sweep_at < now() - interval '60 seconds')
        RETURNING true INTO sweep_due;
    END IF;

    RETURN jsonb_build_object('claimed', COALESCE(claimed, false), 'sweep', COALESCE(sweep_due, false));
END;
$$;

CREATE OR REPLACE FUNCTION "public"."discord_relay_release"()
RETURNS void
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.discord_relay_state SET running_until = NULL WHERE id = 1;
END;
$$;

-- Characters that should have a Discord post and do not yet. Hidden and
-- archived pages are left out (owner default, 2026-10-04).
CREATE OR REPLACE FUNCTION "public"."discord_relay_missing_threads"()
RETURNS TABLE ("page_id" text, "name" text, "url" text)
LANGUAGE "plpgsql" STABLE SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT sp.page_id, sp.name, sp.url
    FROM public.site_pages sp
    WHERE sp.page_type = 'character'
      AND sp.status = 'live'
      AND sp.is_hidden IS NOT TRUE
      AND NOT EXISTS (SELECT 1 FROM public.discord_threads dt WHERE dt.site_key = sp.page_id)
    ORDER BY sp.sort_order, sp.name;
END;
$$;

-- Link a wiki thread to a Discord post. A second link for the same thread is
-- refused rather than replacing the first: replacing would strand every
-- message already copied under the old post.
CREATE OR REPLACE FUNCTION "public"."discord_relay_link_thread"(
    "p_site_key" text, "p_channel" text, "p_discord_thread_id" text, "p_last_message_id" text
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

    INSERT INTO public.discord_threads (site_key, channel, discord_thread_id, last_message_id)
    VALUES ("p_site_key", "p_channel", "p_discord_thread_id", "p_last_message_id")
    ON CONFLICT DO NOTHING
    RETURNING true INTO linked;

    RETURN COALESCE(linked, false);
END;
$$;

-- Every linked thread, for reading Discord: where each one's cursor stands.
CREATE OR REPLACE FUNCTION "public"."discord_relay_threads"()
RETURNS TABLE ("site_key" text, "channel" text, "discord_thread_id" text, "last_message_id" text, "linked_at" timestamptz)
LANGUAGE "plpgsql" STABLE SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT dt.site_key, dt.channel, dt.discord_thread_id, dt.last_message_id, dt.linked_at
    FROM public.discord_threads dt;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."discord_relay_advance"("p_discord_thread_id" text, "p_last_message_id" text)
RETURNS void
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    -- Forward only. Snowflakes compare as numbers, never as text: '9' > '10'.
    UPDATE public.discord_threads
    SET last_message_id = "p_last_message_id", checked_at = now()
    WHERE discord_thread_id = "p_discord_thread_id"
      AND (last_message_id IS NULL OR "p_last_message_id"::numeric > last_message_id::numeric);
END;
$$;

-- What the relay has to do on Discord, oldest first:
--   send            a visible wiki post, never sent, or restored after removal
--   delete          a wiki post's copy, once the post is no longer visible
--   delete_original a Discord message a wiki moderator removed
CREATE OR REPLACE FUNCTION "public"."discord_relay_outbox"("p_limit" integer)
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
    "attempts" integer
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
               dt.channel, dt.discord_thread_id, NULL::text, COALESCE(dm.attempts, 0)
        FROM public.page_discussions p
        JOIN public.discord_threads dt ON dt.site_key = p.page_id
        LEFT JOIN public.discord_messages dm ON dm.post_id = p.id
        LEFT JOIN public.page_discussions pp ON pp.id = p.parent_id
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
        SELECT CASE WHEN dm.direction = 'to_discord' THEN 'delete' ELSE 'delete_original' END,
               p.id, p.page_id, NULL::text, p.parent_id, NULL::text, NULL::text[], NULL::text,
               NULL::text, NULL::text, NULL::text,
               dt.channel, dm.discord_thread_id, dm.discord_message_id, dm.attempts
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

-- Record what happened to one post on Discord. `sending` is claimed BEFORE the
-- request goes out, so a tick that dies mid-send leaves the row there and the
-- post is never sent twice.
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
        -- A deletion keeps the id it deleted, for the log; a resend replaces it.
        discord_message_id = COALESCE(EXCLUDED.discord_message_id,
            CASE WHEN EXCLUDED.state IN ('deleted', 'failed') THEN cur.discord_message_id END),
        attempts = cur.attempts + CASE WHEN EXCLUDED.state = 'failed' THEN 1 ELSE 0 END,
        last_error = EXCLUDED.last_error,
        updated_at = now();
END;
$$;

-- A Discord message, copied in. Returns the new post's id, or NULL when it is
-- not copied: already copied, its thread is not linked, or its author is a
-- linked wiki account under the soft ban (rule 9).
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
         "p_author_name", left(COALESCE("p_body", ''), 4000), COALESCE("p_images", '{}'::text[]))
    RETURNING id INTO new_id;

    INSERT INTO public.discord_messages
        (post_id, discord_thread_id, discord_message_id, direction, state)
    VALUES
        (new_id, "p_discord_thread_id", "p_discord_message_id", 'from_discord', 'sent');

    RETURN new_id;
END;
$$;

-- The last day of copied messages, for the sweep that finds edits and
-- deletions Discord never announces to a poller.
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
    WHERE dm.state = 'sent'
      AND dm.discord_message_id IS NOT NULL
      AND p.status = 'visible'
      AND p.created_at > now() - interval '24 hours';
END;
$$;

-- A Discord message changed. Only a message copied FROM Discord is edited
-- here; a wiki post stays as its author wrote it (the wiki's delete-only rule).
CREATE OR REPLACE FUNCTION "public"."discord_relay_edit"("p_discord_message_id" text, "p_body" text)
RETURNS void
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.page_discussions p
    SET body = left(COALESCE("p_body", ''), 4000), edited_at = now()
    FROM public.discord_messages dm
    WHERE dm.discord_message_id = "p_discord_message_id"
      AND dm.direction = 'from_discord'
      AND dm.post_id = p.id
      AND p.source = 'discord'
      AND p.status = 'visible'
      AND p.body IS DISTINCT FROM left(COALESCE("p_body", ''), 4000);
END;
$$;

-- A Discord message, or the relay's copy of a wiki post, is gone from Discord:
-- the wiki post goes too (rule 2). Returns the images it held, so the relay can
-- delete copies it made; a wiki author's own uploads are left to the page that
-- owns them.
CREATE OR REPLACE FUNCTION "public"."discord_relay_gone"("p_discord_message_id" text)
RETURNS text[]
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    target uuid;
    old_images text[];
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    SELECT dm.post_id, p.images INTO target, old_images
    FROM public.discord_messages dm
    JOIN public.page_discussions p ON p.id = dm.post_id
    WHERE dm.discord_message_id = "p_discord_message_id"
      AND dm.state = 'sent'
      AND p.status = 'visible';

    IF target IS NULL THEN
        RETURN '{}'::text[];
    END IF;

    UPDATE public.page_discussions
    SET body = '', images = '{}'::text[],
        status = 'removed_on_discord', removed_at = now(), removed_by = NULL
    WHERE id = target;

    UPDATE public.discord_messages
    SET state = 'deleted', updated_at = now()
    WHERE post_id = target;

    RETURN COALESCE(old_images, '{}'::text[]);
END;
$$;

-- Every relay function: the service role only. Postgres grants EXECUTE to
-- PUBLIC on creation, so each is revoked from PUBLIC, anon and authenticated
-- by name (tests/definer-rpc-guards.spec.js reads these lines).
REVOKE ALL ON FUNCTION "public"."discord_relay_claim"(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_claim"(integer) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_claim"(integer) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_claim"(integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."discord_relay_release"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_release"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_release"() FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_release"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."discord_relay_missing_threads"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_missing_threads"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_missing_threads"() FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_missing_threads"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."discord_relay_link_thread"(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_link_thread"(text, text, text, text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_link_thread"(text, text, text, text) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_link_thread"(text, text, text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."discord_relay_threads"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_threads"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_threads"() FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_threads"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."discord_relay_advance"(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_advance"(text, text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_advance"(text, text) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_advance"(text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."discord_relay_outbox"(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_outbox"(integer) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_outbox"(integer) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_outbox"(integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."discord_relay_record"(uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_record"(uuid, text, text, text, text, text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_record"(uuid, text, text, text, text, text) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_record"(uuid, text, text, text, text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."discord_relay_take"(text, text, text, text, text, text, text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_take"(text, text, text, text, text, text, text[], text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_take"(text, text, text, text, text, text, text[], text) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_take"(text, text, text, text, text, text, text[], text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."discord_relay_recent"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_recent"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_recent"() FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_recent"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."discord_relay_edit"(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_edit"(text, text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_edit"(text, text) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_edit"(text, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."discord_relay_gone"(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_gone"(text) FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_gone"(text) FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_gone"(text) TO "service_role";


-- =========================================================================
-- 5. THE DISCORD-MEDIA BUCKET
-- =========================================================================
--
-- Public read, like discussion-media. No write policy at all: only the relay,
-- as the service role, puts files here. 8 MB and four still-image types
-- (spec rule 6); anything else stays on Discord and is named in the text.
INSERT INTO "storage"."buckets" ("id", "name", "public", "file_size_limit", "allowed_mime_types")
VALUES ('discord-media', 'discord-media', true, 8388608,
        ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
ON CONFLICT ("id") DO UPDATE
SET "public" = EXCLUDED."public",
    "file_size_limit" = EXCLUDED."file_size_limit",
    "allowed_mime_types" = EXCLUDED."allowed_mime_types";


-- =========================================================================
-- 6. THE SCHEDULE
-- =========================================================================
--
-- pg_cron in pg_catalog: Supabase's own guidance, and the extensions schema
-- has a known grants bug when created from a migration (supabase/cli #1591).
CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";
CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";

-- Called by cron as postgres; not SECURITY DEFINER and granted to nobody else.
-- The function's address and its secret live in Vault, put there by the
-- owner. Without both it returns, so the schedule costs nothing until then,
-- and nothing at all on a preview branch.
CREATE OR REPLACE FUNCTION "public"."discord_relay_tick"()
RETURNS void
LANGUAGE "plpgsql"
SET "search_path" TO 'public'
AS $$
DECLARE
    relay_url text;
    relay_secret text;
BEGIN
    SELECT decrypted_secret INTO relay_url
    FROM vault.decrypted_secrets WHERE name = 'discord_relay_url';

    SELECT decrypted_secret INTO relay_secret
    FROM vault.decrypted_secrets WHERE name = 'discord_relay_secret';

    IF relay_url IS NULL OR relay_secret IS NULL THEN
        RETURN;
    END IF;

    -- pg_net sends after this transaction commits and never waits for the
    -- answer. The timeout only bounds how long pg_net keeps the request open.
    PERFORM net.http_post(
        url := relay_url,
        body := '{}'::jsonb,
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-relay-secret', relay_secret
        ),
        timeout_milliseconds := 30000
    );
END;
$$;

ALTER FUNCTION "public"."discord_relay_tick"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."discord_relay_tick"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_tick"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_tick"() FROM "authenticated";

-- Same name, so applying this again replaces the job rather than adding one.
SELECT cron.schedule('discord-relay', '10 seconds', 'SELECT public.discord_relay_tick()');
