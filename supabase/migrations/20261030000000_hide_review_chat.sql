-- The review chat and the votes on an approved submission are no longer public
-- (owner, 2026-10-30: "I think we should hide ticket_chat history", and "hide
-- the vote as well").
--
-- "Public can view approved revisions" (20260803000000) opened every column of
-- an approved row to every role, so that History could read it. That included
-- ticket_chat, the conversation between the contributor and the reviewers, and
-- supporters / opposers, the account ids of who voted which way. Checked
-- logged out on 2026-10-30: 767 approved rows readable, 77 of them with a chat
-- (200 messages), 90 with votes.
--
-- WHY A VIEW, AND NOT A COLUMN REVOKE
--
-- A column grant is per role, and both the people who should still read the
-- chat (its author, its reviewers) and the people who should not (every other
-- signed-in account) are "authenticated". Revoking the column from anon alone
-- would leave it to anyone who signs in. So the public read moves off the
-- table: the policy goes, and this view serves approved rows with only the
-- columns History, Recent Changes and the dashboards read. The author and the
-- reviewers keep reading the table through their own policies ("Authors can
-- view own revisions", "Staff can view queue"), chat included.
--
-- The view runs as its owner, on purpose. That is how it reaches rows the
-- caller's own policies no longer show, so the column list and the WHERE are
-- the whole rule: a column added here is published to everyone. Supabase's
-- advisor lists such a view as a "Security Definer View"; this one is meant.
-- security_barrier keeps a caller's filter from being evaluated on a row the
-- WHERE would have hidden.
--
-- qa_metadata stays: History and Recent Changes show the reviewer's name and
-- the edit note from it. author_id and status are left out because nothing
-- public reads them (every row here is approved).

DROP POLICY IF EXISTS "Public can view approved revisions" ON "public"."pending_revisions";

-- Granted in 20260803000001 for that policy alone. Without it a logged-out
-- read of the table is refused before RLS runs, which is the point.
REVOKE SELECT ON TABLE "public"."pending_revisions" FROM "anon";

CREATE OR REPLACE VIEW "public"."approved_revisions"
WITH (security_barrier = on) AS
SELECT
    "id",
    "page_id",
    "page_type",
    "author_name",
    "created_at",
    "approved_at",
    "qa_metadata",
    "is_delta",
    "target_scope",
    "target_key",
    "delta_payload",
    "desc_data",
    "frame_data"
FROM "public"."pending_revisions"
WHERE "status" = 'approved';

ALTER VIEW "public"."approved_revisions" OWNER TO "postgres";

-- Read only, and stated rather than inherited. A one-table view is
-- automatically updatable, and production's default privileges grant ALL on
-- every new relation in public to anon and authenticated. Left at that, an
-- UPDATE through this view would run as its owner, past every policy on
-- pending_revisions, and anyone could rewrite an approved submission.
REVOKE ALL ON "public"."approved_revisions" FROM PUBLIC;
REVOKE ALL ON "public"."approved_revisions" FROM "anon";
REVOKE ALL ON "public"."approved_revisions" FROM "authenticated";
GRANT SELECT ON "public"."approved_revisions" TO "anon";
GRANT SELECT ON "public"."approved_revisions" TO "authenticated";

COMMENT ON VIEW "public"."approved_revisions" IS
    'Approved submissions without their review chat or votes, for History, Recent Changes and the dashboards. Runs as its owner: every column listed here is public.';
