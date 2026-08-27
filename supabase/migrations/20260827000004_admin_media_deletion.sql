-- v0.17 F12, correction: media deletion belongs to the ADMIN, not the owner.
--
-- 20260827000003 kept can_delete_media() with the owner, reasoning from how
-- dangerous it is - "the only irreversible action in the panel". The owner
-- corrected that the same day (2026-08-27): "I think media deletion can go to
-- them as well (admin), because it is not in the owner tools."
--
-- That is a better rule than the one it replaces, and it is worth writing down
-- because it decides the next case too:
--
--     THE BOUNDARY IS WHICH PAGE THE TOOL LIVES ON, not how much damage it can
--     do. owner.html is the owner's. admin.html is the review team's. Media
--     deletion is in the media queue on admin.html, so it is the admin's.
--
-- A separate migration rather than an edit to 20260827000003, which has already
-- been pushed. A preview branch records each migration by version and will not
-- run that version again, so editing one it has already applied is verified by
-- nothing - which is how v0.14 shipped two broken migrations behind a green
-- check.
--
-- The per-user can_delete_media flag keeps working exactly as before, and still
-- matters: it is how a REVIEWER, who is below this bar, gets the power one
-- person at a time.
CREATE OR REPLACE FUNCTION "public"."can_delete_media"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    SELECT COALESCE(
        (SELECT "public"."role_rank"(ur.role) >= "public"."role_rank"('admin')
                OR ur.can_delete_media
         FROM public.user_roles ur
         WHERE ur.user_id = auth.uid()),
        false
    );
$$;

ALTER FUNCTION "public"."can_delete_media"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."can_delete_media"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."can_delete_media"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."can_delete_media"() TO "authenticated";

COMMENT ON FUNCTION "public"."can_delete_media"() IS
    'Admin and above, or the per-user can_delete_media flag. Lives with the media queue on admin.html, which is what decides it - not how irreversible it is.';
