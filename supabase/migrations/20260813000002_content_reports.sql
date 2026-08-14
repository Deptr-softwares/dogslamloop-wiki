-- v0.14 item 6: reporting.
--
-- Moderators removing posts they happen to see does not scale to 1.4M people.
-- A report button is what turns moderation from patrolling into a queue - the
-- same shape as the media queue already built, and the reason the moderation
-- verbs from 20260813000001 are worth having at all.
--
-- ON CATEGORIES, because this is a wiki about a competitive fighting game and
-- the obvious category list is wrong for it:
--
--   There is deliberately NO "incorrect" or "misinformation" reason. On a
--   frame-data wiki, "this is wrong" is the most common complaint and the
--   least actionable by moderation - a thread is exactly where being wrong
--   should be argued with, not reported. Offering the category would fill the
--   queue with "this guy is wrong about Sukuna's DP" and train moderators to
--   ignore it, which is how a real harassment report gets missed.
--
-- Reports are about CONDUCT. Corrections belong in a reply, or in a revision
-- to the page itself, which is what the rest of the site is for.

CREATE TABLE IF NOT EXISTS "public"."content_reports" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),

    -- Generic from the start, because the media queue will want this too and a
    -- second reports table would mean a second queue to remember to check.
    "target_type" text NOT NULL DEFAULT 'discussion_post',
    "target_id" uuid NOT NULL,
    "page_id" text,

    -- Nullable with ON DELETE SET NULL, same reasoning as page_discussions:
    -- anonymize_user_by_email hard-deletes the auth.users row, and a plain
    -- reference would make deleting anyone who had ever filed a report fail.
    "reporter_id" uuid,
    "reporter_name" text NOT NULL DEFAULT '',

    "reason" text NOT NULL,
    "note" text,

    "status" text NOT NULL DEFAULT 'open',
    "resolved_at" timestamptz,
    "resolved_by" uuid,
    "resolution_note" text,

    CONSTRAINT "content_reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "content_reports_reporter_fkey" FOREIGN KEY ("reporter_id")
        REFERENCES "auth"."users"("id") ON DELETE SET NULL,
    CONSTRAINT "content_reports_resolver_fkey" FOREIGN KEY ("resolved_by")
        REFERENCES "auth"."users"("id") ON DELETE SET NULL,
    CONSTRAINT "content_reports_reason_check" CHECK ("reason" = ANY (ARRAY[
        'spam'::text, 'harassment'::text, 'off_topic'::text, 'other'::text
    ])),
    CONSTRAINT "content_reports_status_check" CHECK ("status" = ANY (ARRAY[
        'open'::text, 'actioned'::text, 'dismissed'::text
    ])),
    CONSTRAINT "content_reports_note_length" CHECK (char_length(COALESCE("note", '')) <= 500)
);

ALTER TABLE "public"."content_reports" OWNER TO "postgres";
ALTER TABLE "public"."content_reports" ENABLE ROW LEVEL SECURITY;

-- One report per person per item, enforced in the database rather than by a
-- client check. This is the primary defence against report-brigading: twenty
-- people organising to report one post produces twenty rows a moderator can
-- see the shape of, while one person with a script produces exactly one.
--
-- Partial, on reporter_id IS NOT NULL, so anonymized reporters do not collide
-- with each other on a NULL id once their account is gone.
CREATE UNIQUE INDEX IF NOT EXISTS "content_reports_one_per_reporter_idx"
    ON "public"."content_reports" ("target_id", "reporter_id")
    WHERE "reporter_id" IS NOT NULL;

-- The queue's own query: open reports, newest first.
CREATE INDEX IF NOT EXISTS "content_reports_queue_idx"
    ON "public"."content_reports" ("status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "content_reports_target_idx"
    ON "public"."content_reports" ("target_id");


-- --------------------------------------------------------------------------
-- FILING A REPORT
-- --------------------------------------------------------------------------
--
-- An RPC rather than an INSERT policy, for the same reason posting a reply is
-- not: the reporter's identity has to be the caller's, and the target has to
-- be checked to exist. A client-supplied reporter_name would let somebody file
-- reports under another person's name, which is a way to get someone banned.
CREATE OR REPLACE FUNCTION "public"."report_discussion_post"(
    "p_post_id" uuid,
    "p_reason" text,
    "p_note" text DEFAULT NULL
) RETURNS text
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    caller uuid;
    caller_meta jsonb;
    caller_email text;
    caller_role text;
    caller_name text;
    target record;
    recent_count int;
BEGIN
    caller := auth.uid();
    IF caller IS NULL THEN
        RAISE EXCEPTION 'You must be signed in to report a post.' USING ERRCODE = '42501';
    END IF;

    -- The soft ban covers reporting too. 'viewer' means "signed in, can read,
    -- cannot submit", and a report is a submission that costs a moderator
    -- attention - which is exactly the resource a banned account would spend
    -- maliciously.
    caller_role := "public"."get_my_role"();
    IF caller_role = 'viewer' THEN
        RAISE EXCEPTION 'Your account cannot file reports.' USING ERRCODE = '42501';
    END IF;

    SELECT id, page_id, author_id INTO target
      FROM public.page_discussions WHERE id = "p_post_id";

    IF target.id IS NULL THEN
        RAISE EXCEPTION 'That post no longer exists.' USING ERRCODE = 'P0002';
    END IF;

    IF target.author_id = caller THEN
        RAISE EXCEPTION 'You cannot report your own post.' USING ERRCODE = '22023';
    END IF;

    -- The UNIQUE index stops repeat reports of the SAME post. This stops one
    -- person walking a thread reporting everything in it, which the index
    -- cannot see because each row is against a different target.
    SELECT count(*) INTO recent_count
      FROM public.content_reports
     WHERE reporter_id = caller
       AND created_at > (NOW() - INTERVAL '10 minutes');

    IF recent_count >= 5 THEN
        RAISE EXCEPTION 'You have filed several reports just now - give the moderators a moment.'
            USING ERRCODE = '53400';
    END IF;

    SELECT email, raw_user_meta_data INTO caller_email, caller_meta
      FROM auth.users WHERE id = caller;

    caller_name := COALESCE(
        NULLIF(caller_meta->>'display_name', ''),
        NULLIF(caller_meta->>'full_name', ''),
        NULLIF(caller_meta->'custom_claims'->>'global_name', ''),
        NULLIF(caller_meta->>'user_name', ''),
        NULLIF(split_part(COALESCE(caller_email, ''), '@', 1), ''),
        'Unknown'
    );

    INSERT INTO public.content_reports
        (target_type, target_id, page_id, reporter_id, reporter_name, reason, note)
    VALUES
        ('discussion_post', "p_post_id", target.page_id, caller, caller_name,
         "p_reason", NULLIF(btrim(COALESCE("p_note", '')), ''))
    ON CONFLICT ("target_id", "reporter_id") WHERE "reporter_id" IS NOT NULL
    DO NOTHING;

    -- Says the same thing whether the row was new or a duplicate. Telling
    -- somebody "you already reported this" leaks that their earlier report
    -- exists and has not been actioned, which invites them to try again from
    -- another account.
    RETURN 'Thanks - a moderator will take a look.';
END;
$$;

ALTER FUNCTION "public"."report_discussion_post"(uuid, text, text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."report_discussion_post"(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."report_discussion_post"(uuid, text, text) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."report_discussion_post"(uuid, text, text) TO "authenticated";


-- --------------------------------------------------------------------------
-- THE QUEUE
-- --------------------------------------------------------------------------
--
-- Reports carry a reporter's name and their complaint about another person, so
-- only moderators read them. Deliberately NOT readable by the reporter either:
-- there is nothing in the row they did not write, and a reporter who can watch
-- their report's status learns exactly when a moderator looked - which is
-- useful for evading one.
CREATE POLICY "Moderators can read reports" ON "public"."content_reports"
    FOR SELECT TO "authenticated"
    USING ("public"."can_moderate"());

-- SELECT only. Filing goes through the RPC above and resolving through the one
-- below, so there is no direct write path for anybody.
GRANT SELECT ON TABLE "public"."content_reports" TO "authenticated";

-- The queue needs the post it is about, and page_discussions is publicly
-- readable, so no extra grant is needed for that join - only for hidden posts,
-- which can_moderate() already covers in that table's own SELECT policy.
CREATE OR REPLACE FUNCTION "public"."resolve_content_report"(
    "p_report_id" uuid,
    "p_status" text,
    "p_note" text DEFAULT NULL
) RETURNS text
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF NOT "public"."can_moderate"() THEN
        RAISE EXCEPTION 'Permission denied: you cannot resolve reports.'
            USING ERRCODE = '42501';
    END IF;

    IF "p_status" IS DISTINCT FROM 'actioned' AND "p_status" IS DISTINCT FROM 'dismissed' THEN
        RAISE EXCEPTION 'A report is resolved as actioned or dismissed, not %.', "p_status"
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.content_reports
    SET status = "p_status",
        resolved_at = now(),
        resolved_by = auth.uid(),
        resolution_note = NULLIF(btrim(COALESCE("p_note", '')), '')
    WHERE id = "p_report_id";

    IF NOT FOUND THEN
        RAISE EXCEPTION 'That report no longer exists.' USING ERRCODE = 'P0002';
    END IF;

    RETURN 'Report ' || "p_status" || '.';
END;
$$;

ALTER FUNCTION "public"."resolve_content_report"(uuid, text, text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."resolve_content_report"(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."resolve_content_report"(uuid, text, text) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."resolve_content_report"(uuid, text, text) TO "authenticated";


-- --------------------------------------------------------------------------
-- THE QUEUE'S ONE QUERY
-- --------------------------------------------------------------------------
--
-- A moderator triaging reports needs the post's text beside the complaint, and
-- how many other people reported the same thing - three reports on one post is
-- a different situation from one, and it is the single most useful signal in
-- the queue. Doing that client-side would be a query per row.
--
-- SECURITY DEFINER so it can read a hidden post's body: a post already hidden
-- can still be reported, and the moderator deciding whether to escalate to
-- remove has to see what they are deciding about.
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
    "report_count" bigint
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
           (SELECT count(*) FROM public.content_reports o WHERE o.target_id = r.target_id)
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
