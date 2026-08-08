-- v0.10: account deletion, by anonymization.
--
-- Owner-confirmed semantics: the account and email go, but past edits stay
-- and are re-attributed to a placeholder. Hard-deleting a contributor would
-- tear holes in page history and revision attribution for everyone else.
--
-- This is not currently possible at all, and not just for want of a UI. Two
-- constraints in the original schema make a plain delete fail outright:
--
--   pending_revisions.author_id  uuid NOT NULL
--     REFERENCES auth.users(id)          -- no ON DELETE clause, so NO ACTION
--   user_notifications.user_id
--     REFERENCES auth.users(id)          -- same
--
-- So deleting anyone who has ever submitted a revision or received a
-- notification raises a foreign key violation. That has been an accidental
-- safety net - it is also why doing this "manually in the Supabase dashboard"
-- does not actually work for any real contributor.
--
-- Dropping NOT NULL on author_id is what lets a revision outlive its author.
-- Checked before doing it:
--   * RLS "Authors can view/update own revisions" compare auth.uid() =
--     author_id, which simply never matches NULL - correct, an anonymized
--     revision is nobody's to edit.
--   * js/submissions.js filters .eq('author_id', session.user.id) - same.
--   * js/admin-actions.js inserts notifications keyed on author_id, which
--     would violate user_notifications.user_id's own FK. Guarded in that file
--     in the same commit.

ALTER TABLE "public"."pending_revisions" ALTER COLUMN "author_id" DROP NOT NULL;

CREATE OR REPLACE FUNCTION "public"."anonymize_user_by_email"("target_email" "text")
RETURNS "text"
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    target_user_id UUID;
    revisions_kept INT := 0;
BEGIN
    -- Admin only, checked before anything is read or written. Same checklist
    -- as the 2026-08-07 privilege-escalation fix: this function has definer
    -- rights over auth.users, so the EXECUTE grant must never be the only
    -- thing standing between a contributor and deleting other people.
    IF "public"."get_my_role"() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Permission denied: only an admin can anonymize an account.'
            USING ERRCODE = '42501';
    END IF;

    SELECT id INTO target_user_id FROM auth.users WHERE email = target_email;

    IF target_user_id IS NULL THEN
        RETURN 'Error: User with this email not found.';
    END IF;

    -- Refuse to anonymize the last admin. Same reasoning as the UI guard on
    -- role changes: losing every admin locks the owner out of their own
    -- tooling with no recovery short of direct database access.
    IF (SELECT role FROM public.user_roles WHERE user_id = target_user_id) = 'admin'
       AND (SELECT count(*) FROM public.user_roles WHERE role = 'admin') <= 1 THEN
        RAISE EXCEPTION 'Refusing to anonymize the only remaining admin.'
            USING ERRCODE = '42501';
    END IF;

    -- 1. Detach the revisions but keep them. This is the whole point: page
    --    history and the public Recent Changes feed stay intact, with the
    --    author shown as a placeholder rather than vanishing.
    UPDATE public.pending_revisions
    SET author_id = NULL,
        author_name = 'Deleted user'
    WHERE author_id = target_user_id;

    GET DIAGNOSTICS revisions_kept = ROW_COUNT;

    -- 2. Notifications are personal and useless once the account is gone -
    --    and their own FK would block the delete below.
    DELETE FROM public.user_notifications WHERE user_id = target_user_id;

    -- 3. Live-page attribution is a denormalized name, not a reference.
    UPDATE public.page_data
    SET last_editor_name = 'Deleted user'
    WHERE last_editor_name = (SELECT email FROM auth.users WHERE id = target_user_id);

    -- 4. user_roles is ON DELETE CASCADE, but deleting explicitly keeps the
    --    order of operations obvious rather than implicit.
    DELETE FROM public.user_roles WHERE user_id = target_user_id;

    -- 5. Finally the account itself, which is what actually removes the email.
    DELETE FROM auth.users WHERE id = target_user_id;

    RETURN 'Anonymized ' || target_email || '. ' || revisions_kept ||
           ' revision(s) kept and re-attributed to "Deleted user".';
END;
$$;

ALTER FUNCTION "public"."anonymize_user_by_email"("text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."anonymize_user_by_email"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."anonymize_user_by_email"("text") FROM "anon";

GRANT EXECUTE ON FUNCTION "public"."anonymize_user_by_email"("text") TO "authenticated";
