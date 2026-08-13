-- v0.14 item 2: the moderator capability, and moderation with an audit trail.
--
-- Threads shipped in 20260813000000 with staff able to update a post row
-- directly. That was enough to ship and is not enough to keep: a reviewer with
-- a direct UPDATE grant can rewrite a contributor's words, which is precisely
-- the power the delete-only decision withheld from the *author*. Withholding
-- it from the author and handing it to staff is the wrong way round.
--
-- So the direct UPDATE policy is dropped here and every moderation action goes
-- through one RPC that can only set a status, blank a body, and write a log
-- row. There is now no path in the schema by which anybody edits somebody
-- else's post text.
--
-- Two verbs, not one:
--
--   HIDE    - reversible quarantine. The row stops being returned to the
--             public at all; moderators still see it, body intact. For
--             something that may or may not be a problem.
--   REMOVE  - the body is blanked and the placeholder stays, so replies under
--             it are not orphaned. For something that definitely is.
--
-- Hiding works as a row-level rule (the row is filtered out) where the v0.14
-- item-1 migration could not use one: hiding a *column* from a reader allowed
-- to see the row is not something RLS can express, which is why remove blanks
-- the body instead of relying on a policy.

-- --------------------------------------------------------------------------
-- THE CAPABILITY
-- --------------------------------------------------------------------------
--
-- A column, never a second role. user_roles has UNIQUE(user_id) deliberately
-- (20260801000000): holding two roles broke get_my_role() with "more than one
-- row returned by a subquery", which broke that user's access to everything.
-- The v0.13 capability work established the pattern; this is the second one to
-- use it, which is the point of having established it.
ALTER TABLE "public"."user_roles"
    ADD COLUMN IF NOT EXISTS "can_moderate" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "public"."user_roles"."can_moderate" IS
    'Thread moderation without full reviewer rights. Independent of role: admin and reviewer can always moderate, and this grants it to anyone else.';

-- Reads as one predicate everywhere it is needed, rather than the same three
-- conditions copied into a policy, an RPC and the client.
--
-- Granted to anon as well as authenticated, and that is not an oversight: the
-- SELECT policy below calls this for *every* reader, so an anon visitor who
-- cannot execute it would get an error instead of a thread. get_my_role() was
-- granted to anon in 20260803000002 for exactly this reason.
CREATE OR REPLACE FUNCTION "public"."can_moderate"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    SELECT COALESCE(
        (SELECT (ur.role = ANY (ARRAY['admin'::text, 'reviewer'::text])) OR ur.can_moderate
         FROM public.user_roles ur
         WHERE ur.user_id = auth.uid()),
        false
    );
$$;

ALTER FUNCTION "public"."can_moderate"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."can_moderate"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."can_moderate"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."can_moderate"() TO "authenticated";


-- --------------------------------------------------------------------------
-- 'hidden' AS A STATUS
-- --------------------------------------------------------------------------
ALTER TABLE "public"."page_discussions"
    DROP CONSTRAINT IF EXISTS "page_discussions_status_check";

ALTER TABLE "public"."page_discussions"
    ADD CONSTRAINT "page_discussions_status_check" CHECK ("status" = ANY (ARRAY[
        'visible'::text, 'hidden'::text, 'removed_by_author'::text, 'removed_by_staff'::text
    ]));

-- A hidden row leaves the public result set entirely. Unlike a removed one it
-- keeps its body, so it must never be selectable by the people it is hidden
-- from - and that IS expressible row-level, which is the whole reason hide and
-- remove are different verbs.
DROP POLICY IF EXISTS "Anyone can read discussions" ON "public"."page_discussions";

CREATE POLICY "Anyone can read visible discussions" ON "public"."page_discussions"
    FOR SELECT USING (
        "status" IS DISTINCT FROM 'hidden'
        OR "public"."can_moderate"()
    );

-- Dropped, not narrowed. Every moderation action now goes through the RPC
-- below, which can constrain *what* changes; a policy can only constrain which
-- rows, so leaving this would leave staff able to rewrite post bodies.
DROP POLICY IF EXISTS "Staff can moderate discussions" ON "public"."page_discussions";


-- --------------------------------------------------------------------------
-- THE LOG
-- --------------------------------------------------------------------------
--
-- "Moderation actions are logged, not silent - a removal nobody can audit is
-- indistinguishable from data loss." Once remove blanks a body, this table
-- holds the only remaining copy, which makes it both the audit trail and the
-- undo buffer.
CREATE TABLE IF NOT EXISTS "public"."moderation_log" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "action" text NOT NULL,
    "target_type" text NOT NULL DEFAULT 'discussion_post',
    "target_id" uuid,
    "page_id" text,
    "moderator_id" uuid,
    -- Denormalized for the same reason page_data.last_editor_name is: a log
    -- entry has to stay readable after the account that made it is gone.
    "moderator_name" text NOT NULL DEFAULT '',
    "author_name" text,
    "reason" text,
    -- What the post said. The only copy after a remove.
    "snapshot" text,
    CONSTRAINT "moderation_log_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "moderation_log_moderator_fkey" FOREIGN KEY ("moderator_id")
        REFERENCES "auth"."users"("id") ON DELETE SET NULL,
    CONSTRAINT "moderation_log_action_check" CHECK ("action" = ANY (ARRAY[
        'hide'::text, 'remove'::text, 'restore'::text
    ]))
);

ALTER TABLE "public"."moderation_log" OWNER TO "postgres";
ALTER TABLE "public"."moderation_log" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "moderation_log_recent_idx"
    ON "public"."moderation_log" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "moderation_log_target_idx"
    ON "public"."moderation_log" ("target_id", "created_at" DESC);

CREATE POLICY "Moderators can read the log" ON "public"."moderation_log"
    FOR SELECT TO "authenticated"
    USING ("public"."can_moderate"());

-- SELECT only, and deliberately no write grant to anyone. The definer RPC below
-- owns every insert; a log a moderator can write to by hand is not an audit
-- trail. No grant to anon at all - this is the one table on the site where the
-- contents of removed posts live.
GRANT SELECT ON TABLE "public"."moderation_log" TO "authenticated";


-- --------------------------------------------------------------------------
-- THE ONE MODERATION PATH
-- --------------------------------------------------------------------------
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
    restored_body text;
BEGIN
    -- Caller check first, before reading or writing anything. This function
    -- has definer rights over every post on the site, so the EXECUTE grant
    -- must never be the only thing standing between a contributor and other
    -- people's words.
    IF NOT "public"."can_moderate"() THEN
        RAISE EXCEPTION 'Permission denied: you cannot moderate discussions.'
            USING ERRCODE = '42501';
    END IF;

    IF "p_action" IS DISTINCT FROM 'hide'
       AND "p_action" IS DISTINCT FROM 'remove'
       AND "p_action" IS DISTINCT FROM 'restore' THEN
        RAISE EXCEPTION 'Unknown moderation action: %', "p_action" USING ERRCODE = '22023';
    END IF;

    -- A reason is required for anything destructive. The log exists so a
    -- removal can be audited, and an entry saying only that somebody removed
    -- something is not an audit - it is the same silence with a timestamp.
    -- Restore is exempt: putting something back needs no justification.
    IF "p_action" <> 'restore' AND COALESCE(btrim("p_reason"), '') = '' THEN
        RAISE EXCEPTION 'A reason is required so the action can be audited.'
            USING ERRCODE = '22023';
    END IF;

    SELECT id, page_id, body, status, author_name
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
        -- Body kept. The SELECT policy is what stops the public seeing it, and
        -- keeping it is what makes this reversible.
        UPDATE public.page_discussions
        SET status = 'hidden', removed_at = now(), removed_by = auth.uid()
        WHERE id = "p_post_id";

    ELSIF "p_action" = 'remove' THEN
        UPDATE public.page_discussions
        SET body = '', status = 'removed_by_staff', removed_at = now(), removed_by = auth.uid()
        WHERE id = "p_post_id";

    ELSE
        -- Restore. A hidden post still has its body; a removed one does not,
        -- so the text comes back out of the log. Without this, remove would be
        -- irreversible in practice even though the status is not.
        IF COALESCE(target.body, '') = '' THEN
            SELECT snapshot INTO restored_body
              FROM public.moderation_log
             WHERE target_id = "p_post_id" AND snapshot IS NOT NULL AND snapshot <> ''
             ORDER BY created_at DESC
             LIMIT 1;
        END IF;

        UPDATE public.page_discussions
        SET status = 'visible',
            body = COALESCE(NULLIF(target.body, ''), restored_body, ''),
            removed_at = NULL,
            removed_by = NULL
        WHERE id = "p_post_id";
    END IF;

    INSERT INTO public.moderation_log
        (action, target_type, target_id, page_id, moderator_id, moderator_name, author_name, reason, snapshot)
    VALUES
        ("p_action", 'discussion_post', "p_post_id", target.page_id, auth.uid(), actor_name,
         target.author_name, NULLIF(btrim(COALESCE("p_reason", '')), ''), target.body);

    RETURN 'Post ' || "p_action" || 'd.';
END;
$$;

ALTER FUNCTION "public"."moderate_discussion_post"(uuid, text, text) OWNER TO "postgres";

-- Creating a function grants EXECUTE to PUBLIC, so every new RPC starts
-- exposed to anonymous callers - the 2026-08-07 privilege escalation, exactly.
REVOKE ALL ON FUNCTION "public"."moderate_discussion_post"(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."moderate_discussion_post"(uuid, text, text) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."moderate_discussion_post"(uuid, text, text) TO "authenticated";


-- --------------------------------------------------------------------------
-- OWNER TOOLS
-- --------------------------------------------------------------------------
--
-- set_user_capability rejects unknown capability names on purpose, so the new
-- one has to be whitelisted here or the checkbox does nothing.
--
-- Still a whitelist with one UPDATE per branch rather than a column name
-- interpolated into dynamic SQL. A capability name reaching EXECUTE from the
-- client is how a setter like this becomes an arbitrary-write primitive, and
-- two branches is a small price for that not being possible.
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
       AND "capability" IS DISTINCT FROM 'can_moderate' THEN
        RAISE EXCEPTION 'Unknown capability: %', "capability" USING ERRCODE = '22023';
    END IF;

    SELECT id INTO target_id FROM "auth"."users" WHERE email = "target_email";
    IF target_id IS NULL THEN
        RAISE EXCEPTION 'No account found for %', "target_email" USING ERRCODE = 'P0002';
    END IF;

    IF "capability" = 'bypass_cooldown' THEN
        UPDATE "public"."user_roles" SET "bypass_cooldown" = "enabled" WHERE "user_id" = target_id;
    ELSE
        UPDATE "public"."user_roles" SET "can_moderate" = "enabled" WHERE "user_id" = target_id;
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


-- The roster has to show the new flag, so list_personnel returns a sixth
-- column.
--
-- DROP FIRST, AND THIS IS NOT OPTIONAL. Adding a column changes the function's
-- return type, and CREATE OR REPLACE cannot do that - Postgres raises 42P13
-- "cannot change return type of existing function". The v0.13 version of this
-- exact function omitted the DROP, failed on exactly that, and because
-- migrations run in a transaction it took the whole migration down with it:
-- the merge went through, the PR was green, and nothing reached the database.
-- Dropping also drops the grants, which is why they are restated below.
DROP FUNCTION IF EXISTS "public"."list_personnel"();

CREATE OR REPLACE FUNCTION "public"."list_personnel"()
RETURNS TABLE (
    "user_id" uuid,
    "email" text,
    "role" text,
    "joined_at" timestamptz,
    "bypass_cooldown" boolean,
    "can_moderate" boolean
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
    SELECT ur.user_id, u.email::text, ur.role, ur.created_at, ur.bypass_cooldown, ur.can_moderate
    FROM "public"."user_roles" ur
    JOIN "auth"."users" u ON u.id = ur.user_id
    ORDER BY ur.created_at;
END;
$$;

ALTER FUNCTION "public"."list_personnel"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."list_personnel"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."list_personnel"() FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."list_personnel"() TO "authenticated";
