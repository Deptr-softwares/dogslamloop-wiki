-- v0.16 bug 6: a reviewer never received the Trusted Editor perks it was
-- decided they have.
--
-- The decision was made a while ago and reached exactly one of three places:
--
--   cooldown bypass          check_revision_rate_limit()   reviewer INCLUDED
--   restricted-page submit   "Guests can submit revisions" reviewer MISSING
--   vote discount            client-side only              reviewer MISSING
--
-- The cause is that every perk in this schema tests a LITERAL role name, so
-- there is no statement anywhere that a reviewer outranks a trusted editor.
-- Granting reviewer one perk therefore granted it none of the others, and the
-- next perk added would have missed it in the same way.
--
-- role_rank() is that statement, in one place (owner's call, 2026-08-25).

CREATE OR REPLACE FUNCTION "public"."role_rank"("role_name" "text")
RETURNS integer
LANGUAGE "sql"
IMMUTABLE
PARALLEL SAFE
SET "search_path" TO 'public'
AS $$
    SELECT CASE "role_name"
        WHEN 'admin'          THEN 4
        WHEN 'reviewer'       THEN 3
        WHEN 'trusted_editor' THEN 2
        -- viewer is a soft ban, and is refused by its own clause in the policy
        -- below rather than by rank. It sits at 1 rather than 0 only so that
        -- "has a role at all" and "has no role" stay distinguishable.
        WHEN 'viewer'         THEN 1
        ELSE 0
    END;
$$;

-- NULL is the signed-in user with no role, and it must rank 0 rather than
-- NULL: `NULL >= anything` is NULL, which is not true, so an unguarded
-- comparison would deny every ordinary contributor. That is the same trap this
-- codebase hits with `<>` against get_my_role(), pointed the harmless way.
-- The CASE above returns 0 for NULL through its ELSE branch, so the comparison
-- below is total.

-- Creating a function grants EXECUTE to PUBLIC. Revoke first, then grant to
-- exactly who needs it: the policy below is TO "authenticated", so anon never
-- evaluates this and must not be able to call it directly either.
REVOKE ALL ON FUNCTION "public"."role_rank"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."role_rank"("text") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."role_rank"("text") TO "authenticated";

COMMENT ON FUNCTION "public"."role_rank"("text") IS
    'Orders the role names so a perk can be expressed as "at least X" instead of a literal list. The one place that states a reviewer outranks a trusted editor.';

-- --- The restricted-page gate, rewritten against the ladder ---
--
-- Previously:
--     get_my_role() = 'admin'
--     OR (pp.required_role = 'trusted_editor' AND get_my_role() = 'trusted_editor')
--
-- which admits admin and trusted_editor and nobody else. The rank form admits
-- anyone who meets the row's own required_role, so:
--
--     required_role = 'trusted_editor' (2) -> admin, reviewer, trusted_editor
--     required_role = 'admin'          (4) -> admin only
--
-- The second line is the one worth checking: a reviewer must NOT gain access to
-- an admin-restricted page out of this, and rank 3 < rank 4 keeps that true.
--
-- Everything else about the policy is carried over unchanged, including the
-- IS DISTINCT FROM 'viewer' clause - `NULL <> 'viewer'` is NULL, so the obvious
-- operator would deny every ordinary contributor.
DROP POLICY IF EXISTS "Guests can submit revisions" ON "public"."pending_revisions";

CREATE POLICY "Guests can submit revisions" ON "public"."pending_revisions"
FOR INSERT TO "authenticated"
WITH CHECK (
    "auth"."uid"() = "author_id"
    AND "public"."get_my_role"() IS DISTINCT FROM 'viewer'::text
    AND (
        NOT EXISTS (
            SELECT 1 FROM "public"."page_permissions" "pp"
            WHERE "pp"."page_id" = "pending_revisions"."page_id"
        )
        OR EXISTS (
            SELECT 1 FROM "public"."page_permissions" "pp"
            WHERE "pp"."page_id" = "pending_revisions"."page_id"
              AND "public"."role_rank"("public"."get_my_role"())
                  >= "public"."role_rank"("pp"."required_role")
        )
    )
);

-- No table-level GRANT is added: pending_revisions already carries
-- GRANT ALL TO "authenticated" (20260727000000_remote_schema.sql), and this
-- migration changes a policy rather than introducing a new table.
