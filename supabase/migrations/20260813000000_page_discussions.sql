-- v0.14 item 1: per-character discussion threads.
--
-- The first feature on this site with an open write path. Everything before
-- it - revisions, tickets, media - reaches the public only after a reviewer
-- agrees. A thread post is live the moment it is submitted, to a page a
-- 1.4M-member Discord is pointed at. So the limits are part of the schema
-- rather than a follow-up: a thread that ships without them is either unusable
-- or unsafe, and both are worse than shipping a week later.
--
-- One table, not two. The devlog describes "one thread per character page,
-- with posts under it", and a threads table would hold nothing but a page_id
-- already on every post - a join to learn something the child row states.
-- The thread is the page.
--
-- Owner decisions, 2026-08-13, so they are not silently reopened later:
--
--   * ONE LEVEL OF REPLIES. Top-level posts, each with a flat list under it.
--     A reply aimed at a reply lands in the same list rather than nesting
--     deeper - enforced below by rewriting the parent, not by refusing the
--     insert, because the reader's intent is fine and only the depth is not.
--   * SEPARATE LIMITS. bypass_cooldown is a wiki-submission perk and is
--     deliberately NOT consulted here. Three minutes between page edits is
--     reasonable; three minutes between replies is not a conversation. This
--     limit is short and applies to everyone, including admins, so no single
--     compromised staff account can flood a page.
--   * DELETE ONLY. An author can remove their own words. They cannot rewrite
--     them after somebody has replied, which is why there is no UPDATE grant
--     for authors at all and removal goes through an RPC.

CREATE TABLE IF NOT EXISTS "public"."page_discussions" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,

    -- Deliberately not a foreign key to site_pages. A thread is keyed to the
    -- page the reader was on, and site_pages rows get archived and recreated
    -- by owner tools; a discussion outliving a page rebuild is correct, and a
    -- cascade quietly deleting a page's conversation is not.
    "page_id" text NOT NULL,

    -- NULL = a top-level post. Otherwise the post this replies to, which the
    -- trigger below guarantees is itself top-level.
    "parent_id" uuid,

    -- Nullable with ON DELETE SET NULL, and this is load bearing.
    -- anonymize_user_by_email hard-deletes the auth.users row, and
    -- pending_revisions.author_id had to drop NOT NULL for exactly this
    -- reason (see 20260808000004). A plain reference here would make deleting
    -- anyone who has ever posted fail with a foreign key violation - the same
    -- trap, one table later.
    "author_id" uuid,

    -- Set server-side by the trigger below from auth.users, never trusted from
    -- the client. pending_revisions takes author_name from the submitting page
    -- because a revision is reviewed by a human before anyone sees it. A post
    -- is public immediately, so a client-supplied name here would be a
    -- one-line impersonation of any staff member.
    "author_name" text NOT NULL DEFAULT '',

    "body" text NOT NULL,

    -- 'removed_by_author' and 'removed_by_staff' keep the row so replies
    -- underneath do not become orphans answering nothing. The body is blanked
    -- at removal time rather than merely hidden: RLS is row-level, so any
    -- policy that lets a reader see the placeholder would also hand them the
    -- text it is standing in for.
    "status" text NOT NULL DEFAULT 'visible',

    "created_at" timestamptz NOT NULL DEFAULT now(),
    "removed_at" timestamptz,
    "removed_by" uuid,

    CONSTRAINT "page_discussions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "page_discussions_parent_fkey" FOREIGN KEY ("parent_id")
        REFERENCES "public"."page_discussions"("id") ON DELETE CASCADE,
    CONSTRAINT "page_discussions_author_fkey" FOREIGN KEY ("author_id")
        REFERENCES "auth"."users"("id") ON DELETE SET NULL,
    CONSTRAINT "page_discussions_removed_by_fkey" FOREIGN KEY ("removed_by")
        REFERENCES "auth"."users"("id") ON DELETE SET NULL,
    CONSTRAINT "page_discussions_status_check" CHECK ("status" = ANY (ARRAY[
        'visible'::text, 'removed_by_author'::text, 'removed_by_staff'::text
    ])),
    -- Enforced here as well as in the textarea. The client limit is a
    -- courtesy; this one is the actual rule, and a 4000-character cap keeps a
    -- single post from being a denial-of-service against the page it renders on.
    CONSTRAINT "page_discussions_body_length" CHECK (char_length("body") <= 4000)
);

ALTER TABLE "public"."page_discussions" OWNER TO "postgres";

ALTER TABLE "public"."page_discussions" ENABLE ROW LEVEL SECURITY;

-- The two queries this table ever serves: one page's thread newest-first, and
-- one post's replies.
CREATE INDEX IF NOT EXISTS "page_discussions_page_idx"
    ON "public"."page_discussions" ("page_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "page_discussions_parent_idx"
    ON "public"."page_discussions" ("parent_id");
-- Read on every insert by the rate-limit trigger.
CREATE INDEX IF NOT EXISTS "page_discussions_author_recent_idx"
    ON "public"."page_discussions" ("author_id", "created_at" DESC);


-- --------------------------------------------------------------------------
-- AUTHORSHIP AND SHAPE
-- --------------------------------------------------------------------------
--
-- Runs before the row lands, and owns three things the client must not: who
-- wrote it, where a reply attaches, and which page it belongs to.
CREATE OR REPLACE FUNCTION "public"."enforce_discussion_shape"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    caller_email text;
    caller_meta jsonb;
    parent_row record;
BEGIN
    -- Authorship is the caller's, always. auth.uid() resolves to the caller
    -- inside a SECURITY DEFINER function, which is what makes this trustworthy
    -- rather than merely tidy.
    NEW.author_id := auth.uid();

    IF NEW.author_id IS NULL THEN
        RAISE EXCEPTION 'You must be signed in to post.' USING ERRCODE = '42501';
    END IF;

    SELECT email, raw_user_meta_data INTO caller_email, caller_meta
    FROM auth.users WHERE id = NEW.author_id;

    -- Mirrors window.getDisplayName (js/site_utils.js) priority for priority:
    -- custom profile name, OAuth full name, the old Discord global_name claim,
    -- user_name, then the email's local part. Deriving it from the address
    -- alone would print a different name in threads than the same person shows
    -- everywhere else on the site, which reads as two accounts.
    --
    -- NULLIF on each, because a metadata key that exists and is empty is not a
    -- name and must fall through rather than winning as ''.
    NEW.author_name := COALESCE(
        NULLIF(caller_meta->>'display_name', ''),
        NULLIF(caller_meta->>'full_name', ''),
        NULLIF(caller_meta->'custom_claims'->>'global_name', ''),
        NULLIF(caller_meta->>'user_name', ''),
        NULLIF(split_part(COALESCE(caller_email, ''), '@', 1), ''),
        'Unknown'
    );

    -- A new post is always visible and never pre-removed.
    NEW.status := 'visible';
    NEW.removed_at := NULL;
    NEW.removed_by := NULL;

    IF btrim(NEW.body) = '' THEN
        RAISE EXCEPTION 'A post cannot be empty.' USING ERRCODE = '22023';
    END IF;

    IF NEW.parent_id IS NOT NULL THEN
        SELECT id, page_id, parent_id INTO parent_row
        FROM public.page_discussions WHERE id = NEW.parent_id;

        IF parent_row.id IS NULL THEN
            RAISE EXCEPTION 'That post no longer exists.' USING ERRCODE = 'P0002';
        END IF;

        -- One level, by flattening rather than refusing. Somebody replying to
        -- a reply means the reply they are answering, and dropping their post
        -- to enforce a layout rule would be hostile. The grandparent is the
        -- thread they are in.
        IF parent_row.parent_id IS NOT NULL THEN
            NEW.parent_id := parent_row.parent_id;
        END IF;

        -- A reply belongs to its parent's page, whatever the client claimed.
        NEW.page_id := parent_row.page_id;
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."enforce_discussion_shape"() OWNER TO "postgres";

CREATE OR REPLACE TRIGGER "trigger_enforce_discussion_shape"
    BEFORE INSERT ON "public"."page_discussions"
    FOR EACH ROW EXECUTE FUNCTION "public"."enforce_discussion_shape"();


-- --------------------------------------------------------------------------
-- RATE LIMIT
-- --------------------------------------------------------------------------
--
-- Its own limit, on purpose. check_revision_rate_limit covers
-- pending_revisions at three minutes, which is a sensible gap between edits to
-- a wiki page and an absurd one between replies in a conversation.
--
-- bypass_cooldown is NOT consulted. The owner's call, 2026-08-13: that flag
-- was written for submissions, and quietly reusing it here would decide by
-- accident that trusted contributors may post without limit. Twenty seconds
-- is invisible to a person typing and fatal to a script.
CREATE OR REPLACE FUNCTION "public"."check_discussion_rate_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.page_discussions
        WHERE author_id = NEW.author_id
        AND created_at > (NOW() - INTERVAL '20 seconds')
    ) THEN
        RAISE EXCEPTION 'Slow down - you can post once every 20 seconds.'
            USING ERRCODE = '53400';
    END IF;
    RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."check_discussion_rate_limit"() OWNER TO "postgres";

-- After the shape trigger, so it reads the author_id that trigger just set
-- rather than whatever arrived from the client. Trigger order within the same
-- timing is alphabetical by name, and 'trigger_check_...' sorts before
-- 'trigger_enforce_...' - so this one is named to sort after it instead.
CREATE OR REPLACE TRIGGER "trigger_zz_discussion_rate_limit"
    BEFORE INSERT ON "public"."page_discussions"
    FOR EACH ROW EXECUTE FUNCTION "public"."check_discussion_rate_limit"();


-- --------------------------------------------------------------------------
-- REPLY NOTIFICATIONS
-- --------------------------------------------------------------------------
--
-- The notification system has existed since v0.8, and threads without it means
-- nobody returns to a conversation they started - the feature looks dead even
-- while it is being used.
--
-- This has to be a definer trigger rather than a client insert:
-- user_notifications carries a "Staff insert notifications" policy limiting
-- INSERT to admin and reviewer. Correct for its original purpose, and it means
-- one contributor cannot write a notification to another - which is exactly
-- what a reply is.
CREATE OR REPLACE FUNCTION "public"."notify_discussion_reply"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    parent_author uuid;
    page_url text;
BEGIN
    IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;

    SELECT author_id INTO parent_author
    FROM public.page_discussions WHERE id = NEW.parent_id;

    -- Nobody to tell: an anonymized author, or someone replying to themselves,
    -- which is a train of thought rather than a conversation.
    IF parent_author IS NULL OR parent_author = NEW.author_id THEN
        RETURN NEW;
    END IF;

    -- site_pages already stores the public URL of every page, so the link is
    -- read rather than reconstructed. Falling back to the hub keeps a
    -- notification useful even if the registry row is missing.
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

CREATE OR REPLACE TRIGGER "trigger_notify_discussion_reply"
    AFTER INSERT ON "public"."page_discussions"
    FOR EACH ROW EXECUTE FUNCTION "public"."notify_discussion_reply"();


-- --------------------------------------------------------------------------
-- POLICIES
-- --------------------------------------------------------------------------

-- Everyone reads, including anonymous visitors. Removed posts are readable
-- too, because their body is already blank and the placeholder is what keeps
-- the replies under it coherent.
CREATE POLICY "Anyone can read discussions" ON "public"."page_discussions"
    FOR SELECT USING (true);

-- Anyone signed in may post, except a viewer.
--
-- IS DISTINCT FROM, never <>: get_my_role() returns NULL for a signed-in user
-- with no role, and `NULL <> 'viewer'` evaluates to NULL rather than true - so
-- the obvious operator would deny every ordinary contributor, which is most of
-- the people this feature exists for.
--
-- The soft ban has to bite here or it stops meaning anything the moment
-- threads ship: 'viewer' is documented as "signed in, can read, cannot
-- submit", and posting is submitting.
CREATE POLICY "Signed-in users can post" ON "public"."page_discussions"
    FOR INSERT TO "authenticated"
    WITH CHECK (
        "auth"."uid"() IS NOT NULL
        AND "public"."get_my_role"() IS DISTINCT FROM 'viewer'
    );

-- Deliberately no UPDATE policy for authors. Removal goes through
-- remove_my_discussion_post below, which can constrain *what* changes; a
-- policy can only constrain which rows, so granting one here would be granting
-- the edit the owner ruled out.
CREATE POLICY "Staff can moderate discussions" ON "public"."page_discussions"
    FOR UPDATE TO "authenticated"
    USING ("public"."get_my_role"() = ANY (ARRAY['admin'::text, 'reviewer'::text]))
    WITH CHECK ("public"."get_my_role"() = ANY (ARRAY['admin'::text, 'reviewer'::text]));

CREATE POLICY "Admins can delete discussions" ON "public"."page_discussions"
    FOR DELETE TO "authenticated"
    USING ("public"."get_my_role"() = 'admin'::text);

-- A policy without a matching table GRANT yields 401, not a denial - the grant
-- is checked before RLS is consulted. This project has been bitten by exactly
-- that twice (page_history's missing SELECT grant, anon's missing grant on
-- pending_revisions), so grants are stated beside the policies rather than
-- assumed.
GRANT SELECT ON TABLE "public"."page_discussions" TO "anon";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."page_discussions" TO "authenticated";


-- --------------------------------------------------------------------------
-- REMOVING YOUR OWN POST
-- --------------------------------------------------------------------------
--
-- An RPC rather than an UPDATE policy, because the rule is about which columns
-- may change and RLS only expresses which rows may change. This blanks the
-- body and marks the row; it can never be used to rewrite a post.
CREATE OR REPLACE FUNCTION "public"."remove_my_discussion_post"("p_post_id" uuid)
RETURNS text
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    post_author uuid;
BEGIN
    -- Caller check first, before reading or writing anything else. This
    -- function has definer rights over the whole table, so the EXECUTE grant
    -- must never be the only thing standing between a contributor and deleting
    -- other people's posts.
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
        status = 'removed_by_author',
        removed_at = now(),
        removed_by = "auth"."uid"()
    WHERE id = "p_post_id";

    RETURN 'Post removed.';
END;
$$;

ALTER FUNCTION "public"."remove_my_discussion_post"(uuid) OWNER TO "postgres";

-- Creating a function grants EXECUTE to PUBLIC by default, so every new RPC
-- starts exposed to anonymous callers. That is precisely how the 2026-08-07
-- privilege escalation happened.
REVOKE ALL ON FUNCTION "public"."remove_my_discussion_post"(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."remove_my_discussion_post"(uuid) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."remove_my_discussion_post"(uuid) TO "authenticated";


-- --------------------------------------------------------------------------
-- ANONYMIZATION
-- --------------------------------------------------------------------------
--
-- ON DELETE SET NULL detaches the id, but author_name is a denormalized string
-- the constraint cannot reach - so without this an anonymized account's
-- display name would stay printed on every post they ever wrote, which is most
-- of what "anonymize" is supposed to remove.
--
-- Same treatment page_data.last_editor_name already gets in this function.
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
    IF "public"."get_my_role"() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Permission denied: only an admin can anonymize an account.'
            USING ERRCODE = '42501';
    END IF;

    SELECT id INTO target_user_id FROM auth.users WHERE email = target_email;

    IF target_user_id IS NULL THEN
        RETURN 'Error: User with this email not found.';
    END IF;

    IF (SELECT role FROM public.user_roles WHERE user_id = target_user_id) = 'admin'
       AND (SELECT count(*) FROM public.user_roles WHERE role = 'admin') <= 1 THEN
        RAISE EXCEPTION 'Refusing to anonymize the only remaining admin.'
            USING ERRCODE = '42501';
    END IF;

    UPDATE public.pending_revisions
    SET author_id = NULL,
        author_name = 'Deleted user'
    WHERE author_id = target_user_id;

    GET DIAGNOSTICS revisions_kept = ROW_COUNT;

    -- Threads keep their posts, re-attributed, for the same reason revisions
    -- do: hard-deleting them would tear holes in conversations other people
    -- are still part of. author_id is nulled explicitly rather than left to
    -- ON DELETE SET NULL so the ordering is visible here.
    UPDATE public.page_discussions
    SET author_id = NULL,
        author_name = 'Deleted user'
    WHERE author_id = target_user_id;

    GET DIAGNOSTICS posts_kept = ROW_COUNT;

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
