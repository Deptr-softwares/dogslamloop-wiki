-- v0.17 F13: contributors can answer the discussion on their own submission.
--
-- The owner: "There should be no reason why they get a notification of 'Staff
-- are discussing your submission'" without being able to reply.
--
-- The notification is real (js/admin-actions.js) and js/submissions.js already
-- renders ticket_chat to the author. They could read the conversation and not
-- answer it.
--
-- WHY AN RPC RATHER THAN A POLICY
--
-- "Authors can update own pending revisions" (20260802000000, tightened by
-- 20260827000000) already permits an author to UPDATE their own row while it is
-- pending or ticket_open, so appending to ticket_chat needs no new policy at
-- all. That is exactly the problem: **RLS cannot restrict WHICH COLUMNS an
-- update touches**, and pending_revisions carries GRANT ALL TO authenticated, so
-- an author writing to ticket_chat through the table is an author who can write
-- to every other column in the same statement.
--
-- This is the same reasoning that made thread moderation an RPC in
-- 20260813000001: "There is now no path in the schema by which anybody edits
-- somebody else's post text." Here it is one's own row rather than somebody
-- else's, and the conclusion is the same.
--
-- IT REPLACES THE STAFF PATH TOO, and that is not scope creep.
--
-- js/admin-tickets.js posted by SELECTing ticket_chat, appending in JavaScript
-- and writing the whole array back. Two people replying at once lose one of the
-- two messages, silently - the second write is built on an array read before
-- the first landed. Appending in SQL with `||` cannot lose a message, and one
-- path for both parties means the author's name is derived the same way for
-- everybody.
--
-- THE NAME IS SERVER-SIDE, always. The old client sent
-- window.currentUsername, so the display name on a ticket message was whatever
-- the caller said it was. page_discussions solved this with a BEFORE INSERT
-- trigger that overwrites author_name; this is the same rule in the shape this
-- table needs.

CREATE OR REPLACE FUNCTION "public"."post_ticket_message"(
    "target_revision_id" uuid,
    "message_text" "text"
) RETURNS "jsonb"
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    "rev_author_id" uuid;
    "rev_page_id" text;
    "rev_status" text;
    "poster_name" text;
    "is_author" boolean;
    "new_message" jsonb;
    "clean_text" text;
BEGIN
    -- Caller check first, before anything is read, and never left to the grant.
    IF "auth"."uid"() IS NULL THEN
        RAISE EXCEPTION 'Permission denied: sign in to post a message.'
            USING ERRCODE = '42501';
    END IF;

    "clean_text" := btrim(COALESCE("message_text", ''));
    IF "clean_text" = '' THEN
        RAISE EXCEPTION 'A message cannot be empty.' USING ERRCODE = '22023';
    END IF;
    -- Capped in the database as well as the form. The form is a courtesy;
    -- PostgREST is the actual entry point.
    IF char_length("clean_text") > 2000 THEN
        RAISE EXCEPTION 'A message is limited to 2000 characters.' USING ERRCODE = '22023';
    END IF;

    SELECT pr."author_id", pr."page_id", pr."status"
      INTO "rev_author_id", "rev_page_id", "rev_status"
    FROM "public"."pending_revisions" pr
    WHERE pr."id" = "target_revision_id";

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No such submission.' USING ERRCODE = 'P0002';
    END IF;

    "is_author" := "rev_author_id" IS NOT DISTINCT FROM "auth"."uid"();

    -- Two parties, one door. can_review_page() rather than is_staff(), so an
    -- expert can answer on their own pages and only their own - the same gate
    -- the queue itself uses, rather than a second opinion about who may review.
    IF NOT ("is_author" OR "public"."can_review_page"("rev_page_id")) THEN
        RAISE EXCEPTION 'Permission denied: this is not your submission.'
            USING ERRCODE = '42501';
    END IF;

    -- Only while the submission is actually open. A closed ticket that still
    -- accepts messages is a conversation nobody is reading, and it would let an
    -- author append to a row that has already been approved and made public.
    IF "rev_status" IS DISTINCT FROM 'pending' AND "rev_status" IS DISTINCT FROM 'ticket_open' THEN
        RAISE EXCEPTION 'This submission is closed to new messages.'
            USING ERRCODE = '42501';
    END IF;

    -- The soft ban. 'viewer' means signed in, can read, cannot put content on
    -- the site, and a ticket message is content. IS NOT DISTINCT FROM, never =:
    -- get_my_role() is NULL for an ordinary contributor, and NULL = 'viewer' is
    -- NULL, which would let the ban through rather than deny it.
    IF "public"."get_my_role"() IS NOT DISTINCT FROM 'viewer' THEN
        RAISE EXCEPTION 'Permission denied: your account cannot post.'
            USING ERRCODE = '42501';
    END IF;

    -- Resolved here, never accepted from the caller. Same fall-back chain as
    -- get_public_profile(), and the same refusal to end at the email prefix.
    SELECT COALESCE(
        NULLIF(au."raw_user_meta_data"->>'display_name', ''),
        NULLIF(au."raw_user_meta_data"->>'full_name', ''),
        NULLIF(au."raw_user_meta_data"->'custom_claims'->>'global_name', ''),
        NULLIF(au."raw_user_meta_data"->>'user_name', ''),
        'Anonymous'
    ) INTO "poster_name"
    FROM "auth"."users" au WHERE au."id" = "auth"."uid"();

    -- `type` is additive, the way requestChanges established with
    -- 'changes_requested': older messages carry no type at all and every
    -- renderer falls through to the plain shape. 'author' is the new one, and
    -- it is what lets both views tell a contributor's reply from a reviewer's.
    -- A staff message is left untyped so existing rendering is untouched.
    "new_message" := jsonb_build_object(
        'author', "poster_name",
        'text', "clean_text",
        'timestamp', (extract(epoch from now()) * 1000)::bigint
    );
    IF "is_author" THEN
        "new_message" := "new_message" || jsonb_build_object('type', 'author');
    END IF;

    -- Appended in SQL. The client used to read the array, append, and write the
    -- whole thing back, so two replies at once lost one of them.
    UPDATE "public"."pending_revisions"
       SET "ticket_chat" = COALESCE("ticket_chat", '[]'::jsonb) || jsonb_build_array("new_message")
     WHERE "id" = "target_revision_id";

    RETURN "new_message";
END;
$$;

ALTER FUNCTION "public"."post_ticket_message"(uuid, "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."post_ticket_message"(uuid, "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."post_ticket_message"(uuid, "text") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."post_ticket_message"(uuid, "text") TO "authenticated";
