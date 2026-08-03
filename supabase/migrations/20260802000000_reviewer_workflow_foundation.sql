-- Phase 0 of the reviewer-workflow/UI redesign (v0.6 item 4, see plan:
-- "v0.6 Item 4: admin.html Reviewer Workflow/UI Redesign"). Schema/RLS
-- foundation for six confirmed gaps found comparing this site's moderation
-- workflow against how real wikis handle review - no user-visible change
-- ships from this migration alone, but it unblocks every later phase.
--
-- Design principle behind all of this: nothing a person is entitled to see
-- should disappear, and nothing should require staff access to find out
-- about. Concretely: rejecting/withdrawing a submission becomes a status
-- change instead of a DELETE (paired JS change in js/admin-actions.js),
-- and a contributor gets RLS access to their own pending_revisions rows so
-- a future self-service page doesn't need staff involvement at all.

-- 1. Author-owned-row RLS on pending_revisions. Today only two policies
-- exist on this table ("Staff can view queue" / "Staff can manage queue"),
-- both gated on admin/reviewer via get_my_role() - there is no policy at
-- all for "the person who submitted this can see/update their own row."
-- SELECT has no status filter: a contributor's full history (pending,
-- ticket_open, approved, rejected, withdrawn) should all be visible to
-- them, not just the still-open ones.
CREATE POLICY "Authors can view own revisions" ON "public"."pending_revisions"
FOR SELECT USING ("auth"."uid"() = "author_id");

-- UPDATE is scoped to non-final statuses only - once a row is approved/
-- rejected/withdrawn it's a closed record, not something the author can
-- keep editing. This same policy covers self-withdraw too (withdrawing is
-- just UPDATE ... SET status = 'withdrawn'), so no separate DELETE policy
-- is needed for authors anywhere on this table. RLS policies are
-- permissive/OR'd together, so this doesn't change what staff can already
-- do via "Staff can manage queue".
CREATE POLICY "Authors can update own pending revisions" ON "public"."pending_revisions"
FOR UPDATE USING (
    "auth"."uid"() = "author_id"
    AND "status" IN ('pending', 'ticket_open')
)
WITH CHECK ("auth"."uid"() = "author_id");

-- 2. Fix page_history's read access - found during this redesign's research,
-- not previously known. RLS is enabled on page_history but zero policies
-- exist, and the table-level GRANT to authenticated/anon excludes SELECT
-- entirely (unlike page_data's grant, which does include it). js/owner.js's
-- garbage-collector scan is the only existing reader and has almost
-- certainly been silently returning an empty result set. Needed regardless
-- for the revert/rollback UI planned in a later phase.
GRANT SELECT ON TABLE "public"."page_history" TO "authenticated";

CREATE POLICY "Staff can view page history" ON "public"."page_history"
FOR SELECT USING ("public"."get_my_role"() = ANY (ARRAY['admin'::"text", 'reviewer'::"text"]));

-- 3. Attribute future page_history snapshots to a real person instead of
-- the trigger's hardcoded 'System Trigger' string. The real approver's
-- name only ever lived in pending_revisions.qa_metadata.reviewed_by, on a
-- different, unlinked table - there was no way to know who actually made a
-- given live change just from page_history itself. This only fixes
-- attribution going forward; existing page_history rows keep the old
-- placeholder string, not worth a backfill.
ALTER TABLE "public"."page_data" ADD COLUMN IF NOT EXISTS "last_editor_name" "text";

CREATE OR REPLACE FUNCTION "public"."archive_page_version"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF (OLD.desc_data IS DISTINCT FROM NEW.desc_data OR OLD.frame_data IS DISTINCT FROM NEW.frame_data) THEN
        INSERT INTO public.page_history (page_id, desc_data, frame_data, updated_by_user)
        VALUES (OLD.page_id, OLD.desc_data, OLD.frame_data, COALESCE(NEW.last_editor_name, 'System Trigger'));
    END IF;
    RETURN NEW;
END;
$$;
