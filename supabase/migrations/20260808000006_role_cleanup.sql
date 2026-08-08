-- v0.11: drop 'contributor', and make 'viewer' mean something.
--
-- The role list had five values but only three of them gated anything.
-- 'contributor' and 'viewer' were legal and assignable, yet no policy or code
-- path checked for either - a 'contributor' and a signed-in user with no role
-- at all had byte-for-byte identical permissions. A role that looks like
-- configuration and silently isn't is worse than no role, because it invites
-- people to believe they have set something.
--
-- Two changes, owner-confirmed:
--   * 'contributor' is removed. It was pure decoration.
--   * 'viewer' becomes a soft ban: signed in, can read and comment on their
--     own tickets, but cannot submit revisions. The site previously had no way
--     to revoke someone's ability to contribute short of deleting their
--     account, which is a blunt and irreversible instrument for what is
--     usually a temporary problem.

-- --- 1. Retire 'contributor' without changing anyone's access. ---
-- Deleting the row leaves those users with no role, which is exactly the
-- permission set 'contributor' already granted - so this is behaviour-
-- preserving by construction rather than by assertion. get_my_role() returns
-- NULL for them, and every policy compares with = ANY(...), which NULL fails.
DELETE FROM "public"."user_roles" WHERE "role" = 'contributor';

ALTER TABLE "public"."user_roles" DROP CONSTRAINT IF EXISTS "user_roles_role_check";

ALTER TABLE "public"."user_roles"
    ADD CONSTRAINT "user_roles_role_check"
    CHECK (("role" = ANY (ARRAY['admin'::text, 'reviewer'::text, 'trusted_editor'::text, 'viewer'::text])));

-- --- 2. 'viewer' can no longer submit revisions. ---
-- Replaces the policy from 20260808000002. The page_permissions logic is
-- carried over unchanged; the only addition is the viewer exclusion, applied
-- to every page rather than only restricted ones - a ban that still let
-- someone edit unrestricted pages would not be a ban.
DROP POLICY IF EXISTS "Guests can submit revisions" ON "public"."pending_revisions";

CREATE POLICY "Guests can submit revisions" ON "public"."pending_revisions"
FOR INSERT TO "authenticated"
WITH CHECK (
    "auth"."uid"() = "author_id"
    -- IS DISTINCT FROM, not <>: get_my_role() is NULL for a signed-in user
    -- with no role, and NULL <> 'viewer' evaluates to NULL, which would deny
    -- every ordinary contributor. This is the whole policy's correctness
    -- hinging on one operator.
    AND "public"."get_my_role"() IS DISTINCT FROM 'viewer'::text
    AND (
        NOT EXISTS (
            SELECT 1 FROM "public"."page_permissions" "pp"
            WHERE "pp"."page_id" = "pending_revisions"."page_id"
        )
        OR EXISTS (
            SELECT 1 FROM "public"."page_permissions" "pp"
            WHERE "pp"."page_id" = "pending_revisions"."page_id"
              AND (
                  "public"."get_my_role"() = 'admin'::text
                  OR ("pp"."required_role" = 'trusted_editor'::text
                      AND "public"."get_my_role"() = 'trusted_editor'::text)
              )
        )
    )
);

-- Note on what a viewer CAN still do, deliberately: read the site, keep their
-- existing pending revisions visible to themselves, and withdraw them. The
-- "Authors can update own pending revisions" policy is left alone - blocking
-- it would also block withdrawal, and distinguishing "withdraw" from "edit"
-- inside a single RLS predicate is not worth the complexity for a surface
-- that is small and staff-visible. Anything already in the queue can be
-- rejected by a reviewer as normal.
