-- Part 1 of the admin/moderation rework (see plan: "v0.6 Detail: Admin/
-- Moderation Rework"). Fixes a latent data-model bug: user_roles has a
-- composite PRIMARY KEY (user_id, role), so the schema allows a user to
-- hold multiple simultaneous role rows, and assign_role_by_email() is a
-- toggle that makes it easy to accidentally create one (e.g. granting
-- reviewer, then separately granting admin, to the same person). The
-- moment that happens, get_my_role() - a scalar SQL function with no
-- LIMIT/ORDER BY, used by every RLS policy on page_data/pending_revisions/
-- user_notifications - throws "more than one row returned by a subquery",
-- breaking that user's access everywhere. Two client-side call sites
-- (js/pagebuilder.js's site-wide role query, js/editor.js's page-permission
-- check) independently make the same single-row assumption and would also
-- silently misbehave; fixing this at the data level (not just in SQL)
-- is what actually closes the gap for all three.
--
-- IMPORTANT - run this dry-run query manually first and eyeball the result
-- before applying this migration. In particular, confirm the site owner's
-- own account keeps 'admin' after the backfill below, not some other role -
-- a mistake here would lock the owner out of their own moderation tooling:
--
-- SELECT user_id, array_agg(role ORDER BY role) AS roles
-- FROM public.user_roles
-- GROUP BY user_id
-- HAVING count(*) > 1;

-- Backfill: for any user_id with multiple role rows, keep exactly one by a
-- fixed priority (admin > reviewer > trusted_editor > contributor > viewer)
-- and delete the rest. This priority order matches get_my_role()'s new
-- tie-break below, so the backfill and the runtime defense-in-depth agree
-- on "who wins" if this data shape is ever produced again before the
-- uniqueness constraint below rejects it.
DELETE FROM "public"."user_roles" "ur"
USING (
    SELECT "user_id", "role",
        ROW_NUMBER() OVER (
            PARTITION BY "user_id"
            ORDER BY CASE "role"
                WHEN 'admin' THEN 1
                WHEN 'reviewer' THEN 2
                WHEN 'trusted_editor' THEN 3
                WHEN 'contributor' THEN 4
                WHEN 'viewer' THEN 5
                ELSE 6
            END
        ) AS "rn"
    FROM "public"."user_roles"
) "ranked"
WHERE "ur"."user_id" = "ranked"."user_id"
    AND "ur"."role" = "ranked"."role"
    AND "ranked"."rn" > 1;

-- Enforce the single-role-per-user invariant at the data level. Kept
-- alongside the existing composite PK (user_id, role) rather than replacing
-- it - a plain additive UNIQUE constraint is a smaller, lower-risk diff than
-- swapping the primary key.
ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_one_role_per_user" UNIQUE ("user_id");

-- Defense in depth: even with the constraint above, make get_my_role()
-- resilient by construction rather than relying solely on the constraint
-- never being bypassed by some future migration. This does NOT fix
-- pagebuilder.js's or editor.js's separate client-side queries on its own -
-- the constraint above is what actually does that, by making the bad data
-- shape impossible to create.
CREATE OR REPLACE FUNCTION "public"."get_my_role"() RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT "role" FROM "public"."user_roles"
  WHERE "user_id" = "auth"."uid"()
  ORDER BY CASE "role"
    WHEN 'admin' THEN 1
    WHEN 'reviewer' THEN 2
    WHEN 'trusted_editor' THEN 3
    WHEN 'contributor' THEN 4
    WHEN 'viewer' THEN 5
    ELSE 6
  END
  LIMIT 1;
$$;

ALTER FUNCTION "public"."get_my_role"() OWNER TO "postgres";

-- Change assign_role_by_email() from a toggle (which is what allowed a user
-- to accumulate more than one role row in the first place) to a "set role"
-- replace operation: unconditionally clear the user's existing role, then
-- assign the new one. assigned_role = NULL means "clear all roles" - the
-- real fix for admin.html's "Revoke Access (Guest)" button, which used to
-- assign role='guest', a value the role_check CHECK constraint has never
-- actually permitted (that button has been silently failing every time it
-- was used).
CREATE OR REPLACE FUNCTION "public"."assign_role_by_email"("target_email" "text", "assigned_role" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    target_user_id UUID;
BEGIN
    SELECT id INTO target_user_id FROM auth.users WHERE email = target_email;

    IF target_user_id IS NULL THEN
        RETURN 'Error: User with this email not found.';
    END IF;

    DELETE FROM public.user_roles WHERE user_id = target_user_id;

    IF assigned_role IS NULL THEN
        RETURN 'Successfully REVOKED all roles from ' || target_email;
    END IF;

    INSERT INTO public.user_roles (user_id, role) VALUES (target_user_id, assigned_role);

    RETURN 'Successfully SET the role of ' || target_email || ' to ' || upper(assigned_role);
END;
$$;

ALTER FUNCTION "public"."assign_role_by_email"("target_email" "text", "assigned_role" "text") OWNER TO "postgres";
