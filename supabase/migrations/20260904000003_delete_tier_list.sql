-- Deleting a tier list outright, which archiving deliberately did not do.
--
-- 20260904000002 added set_tier_list_status, and archiving was offered as the
-- answer to "there is no way to remove a certified tier list contributor"
-- because it achieves the visible outcome - the public read policy is
-- status = 'published', so an archived list is off the site - without
-- destroying anything.
--
-- The owner still wants real deletion (2026-09-04), as a separate action rather
-- than instead of archiving. Both now exist and they are not the same button.
--
-- WHAT DELETION ACTUALLY COSTS. tier_list_changes references tier_lists
-- ON DELETE CASCADE, so this does not merely unassign somebody: every note
-- explaining every tier move goes with it. That history is the point of the
-- feature - a named list is a claim somebody is accountable for - and none of
-- it is recoverable. So the function counts what it is about to destroy and
-- says so in its return value, rather than reporting a bare success.
--
-- ARCHIVE FIRST, ENFORCED HERE AND NOT ONLY IN THE UI (owner's call). A live
-- list cannot be deleted in one step; it has to be archived, which is
-- reversible, and only then removed. owner.html hides DELETE on a published row
-- for the same reason, but that gate is a courtesy - this is the boundary. The
-- REST endpoint is reachable directly by anybody with a token, and "the button
-- was not on screen" has never been a permission check.
--
-- The trusted_editor role assign_tier_list may have granted is NOT revoked
-- here, matching set_tier_list_status. Roles are managed in the roster, and
-- silently demoting somebody as a side effect of deleting a page is the kind of
-- surprise this project has been bitten by before.

CREATE OR REPLACE FUNCTION "public"."delete_tier_list"("p_slug" text)
RETURNS text
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    target_id uuid;
    target_name text;
    target_status text;
    lost_changes integer;
BEGIN
    IF NOT "public"."is_owner"() THEN
        RAISE EXCEPTION 'Permission denied: only the owner may delete a tier list.'
            USING ERRCODE = '42501';
    END IF;

    SELECT "id", "author_name", "status"
      INTO target_id, target_name, target_status
      FROM "public"."tier_lists"
     WHERE "slug" = btrim("p_slug");

    IF target_id IS NULL THEN
        RAISE EXCEPTION 'No tier list at ?list=%', btrim("p_slug") USING ERRCODE = 'P0002';
    END IF;

    IF target_status IS DISTINCT FROM 'archived' THEN
        RAISE EXCEPTION 'Archive ?list=% before deleting it. Archiving already takes it off the site, and it can be undone.', btrim("p_slug")
            USING ERRCODE = '22023';
    END IF;

    -- Counted before the delete, because after it there is nothing to count.
    SELECT count(*) INTO lost_changes
      FROM "public"."tier_list_changes" WHERE "list_id" = target_id;

    DELETE FROM "public"."tier_lists" WHERE "id" = target_id;

    RETURN format('Deleted %s''s list at ?list=%s, and %s change note(s) with it.',
        target_name, btrim("p_slug"), lost_changes);
END;
$$;

ALTER FUNCTION "public"."delete_tier_list"(text) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."delete_tier_list"(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."delete_tier_list"(text) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."delete_tier_list"(text) TO "authenticated";
