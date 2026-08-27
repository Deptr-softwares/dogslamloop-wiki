-- v0.17: close three holes in "Authors can update own pending revisions".
--
-- The policy (20260802000000) reads:
--
--   FOR UPDATE USING (auth.uid() = author_id AND status IN ('pending','ticket_open'))
--   WITH CHECK  (auth.uid() = author_id)
--
-- USING decides which rows may be updated. WITH CHECK decides what the row is
-- allowed to BECOME - and it tests ownership and nothing else. Everything
-- below follows from that one omission. Found while scoping F13 (letting a
-- contributor reply in the ticket about their own submission), which needs
-- this policy to be trustworthy before it leans on it.
--
-- 1. STATUS. An author could set status = 'approved' on their own row. That
--    drops it out of the staff queue - js/admin-queue.js:61 selects
--    .in('status', ['pending','ticket_open']) - and makes it world-readable,
--    because "Public can view approved revisions" (20260803000000) is
--    FOR SELECT USING (status = 'approved') and anon holds SELECT on this
--    table (20260803000001). Unreviewed content, publicly visible, gone from
--    moderation. It does NOT reach the live page: merging to live is a
--    separate write to page_data, which this role cannot make.
--
-- 2. PAGE_ID. The INSERT policy checks page_permissions before letting anyone
--    submit to a restricted page. The UPDATE policy never did. So the gate was
--    bypassable in two steps: insert against an open page, then move the row
--    to a restricted one. Together with (1) that lands unreviewed content on a
--    restricted page, flagged approved.
--
-- 3. VIEWER. `viewer` is a soft ban - signed in, can read, cannot submit - and
--    the INSERT policy enforces it. The UPDATE policy did not, so a banned
--    author could keep editing whatever was already in the queue. Withdrawal
--    stays available to them deliberately; see the clause below.
--
-- WHY THE ALLOW-LIST IS STATUSES AND NOT "status IS UNCHANGED": a WITH CHECK
-- expression cannot see the old row - only USING can - so "did not change" is
-- not expressible here without a trigger. The three values an author legitimately
-- produces are enumerable, which makes the allow-list both simpler and stricter.

-- --------------------------------------------------------------------------
-- The page gate, extracted so it has ONE definition
-- --------------------------------------------------------------------------
--
-- This predicate already existed inline in the INSERT policy, most recently
-- rewritten against role_rank() in 20260825000001. The UPDATE policy now needs
-- the same test, and copying it would make a second place for the two to
-- disagree - which is the mistake v0.16 bug 6 was, one table over.
--
-- NOT SECURITY DEFINER, deliberately. It reads page_permissions, which carries
-- "Public read page permissions" USING (true), and get_my_role() is already
-- SECURITY DEFINER on its own. Nothing here crosses an RLS boundary, so
-- nothing here needs to bypass one.
CREATE OR REPLACE FUNCTION "public"."can_submit_to_page"("target_page_id" "text")
RETURNS boolean
LANGUAGE "sql"
STABLE
SET "search_path" TO 'public'
AS $$
    SELECT NOT EXISTS (
        SELECT 1 FROM "public"."page_permissions" "pp"
        WHERE "pp"."page_id" = "target_page_id"
    )
    OR EXISTS (
        SELECT 1 FROM "public"."page_permissions" "pp"
        WHERE "pp"."page_id" = "target_page_id"
          AND "public"."role_rank"("public"."get_my_role"())
              >= "public"."role_rank"("pp"."required_role")
    );
$$;

-- Creating a function grants EXECUTE to PUBLIC. This project has already had
-- one unauthenticated privilege escalation from that default.
--
-- anon is not granted: it holds only SELECT on pending_revisions
-- (20260803000001), so neither policy below is ever evaluated for it.
REVOKE ALL ON FUNCTION "public"."can_submit_to_page"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."can_submit_to_page"("text") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."can_submit_to_page"("text") TO "authenticated";

COMMENT ON FUNCTION "public"."can_submit_to_page"("text") IS
    'Whether the caller may put a revision on this page, per page_permissions and the role ladder. The one definition, shared by the INSERT and UPDATE policies on pending_revisions.';

-- --------------------------------------------------------------------------
-- The INSERT policy, rewritten against the helper - NO behaviour change
-- --------------------------------------------------------------------------
--
-- Identical logic to 20260825000001, with the page_permissions clause moved
-- into can_submit_to_page(). Restated rather than left alone so that the two
-- policies visibly share one predicate.
DROP POLICY IF EXISTS "Guests can submit revisions" ON "public"."pending_revisions";

CREATE POLICY "Guests can submit revisions" ON "public"."pending_revisions"
FOR INSERT TO "authenticated"
WITH CHECK (
    "auth"."uid"() = "author_id"
    AND "public"."get_my_role"() IS DISTINCT FROM 'viewer'::text
    AND "public"."can_submit_to_page"("page_id")
);

-- --------------------------------------------------------------------------
-- The UPDATE policy, with the three holes closed
-- --------------------------------------------------------------------------
--
-- USING is carried over unchanged: a closed record (approved/rejected/
-- withdrawn) is still not something the author may reopen.
DROP POLICY IF EXISTS "Authors can update own pending revisions" ON "public"."pending_revisions";

CREATE POLICY "Authors can update own pending revisions" ON "public"."pending_revisions"
FOR UPDATE USING (
    "auth"."uid"() = "author_id"
    AND "status" IN ('pending', 'ticket_open')
)
WITH CHECK (
    "auth"."uid"() = "author_id"

    -- The three an author legitimately produces:
    --   'pending'     - editing content, status untouched
    --   'ticket_open' - the OPEN TICKET button on your own submission
    --                   (js/admin-queue.js, isOwnSubmission branch)
    --   'withdrawn'   - js/submissions.js:249, the only way an author closes
    --                   their own revision; there is no DELETE policy for it
    -- 'approved' and 'rejected' are a reviewer's verdict and are now refused.
    AND "status" IN ('pending', 'ticket_open', 'withdrawn')

    -- Cannot move the row onto a page the author could not have submitted to.
    AND "public"."can_submit_to_page"("page_id")

    -- The soft ban, matching the INSERT policy - except that withdrawing must
    -- stay possible. Blocking a banned author from retracting their own
    -- pending work would leave it in the queue with nobody able to pull it,
    -- which punishes the reviewers rather than the author.
    AND (
        "public"."get_my_role"() IS DISTINCT FROM 'viewer'::text
        OR "status" = 'withdrawn'
    )
);

-- No table-level GRANT is added: pending_revisions already carries
-- GRANT ALL TO "authenticated" (20260727000000), and this migration changes
-- policies rather than introducing a table.
