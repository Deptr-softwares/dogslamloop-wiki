-- v1.0 batch 1, found in the live test on the owner's test server (2026-10-04):
-- the relay opened a Discord post for "Template & Guide". That page is a
-- `character` page in the documentation's clothes, filed under "Site Info", so
-- `page_type = 'character'` alone let it through. A character is a page in the
-- Characters category: the same test the sidebar uses to colour a name
-- (js/pagebuilder.js), and tests/discord-relay-core.spec.js holds the two to
-- the same word.
--
-- 20261004000000 is pushed and immutable, so the function is replaced here.

CREATE OR REPLACE FUNCTION "public"."discord_relay_missing_threads"()
RETURNS TABLE ("page_id" text, "name" text, "url" text)
LANGUAGE "plpgsql" STABLE SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    IF "auth"."role"() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: the relay only.' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT sp.page_id, sp.name, sp.url
    FROM public.site_pages sp
    WHERE sp.page_type = 'character'
      AND sp.category = 'Characters'
      AND sp.status = 'live'
      AND sp.is_hidden IS NOT TRUE
      AND NOT EXISTS (SELECT 1 FROM public.discord_threads dt WHERE dt.site_key = sp.page_id)
    ORDER BY sp.sort_order, sp.name;
END;
$$;

REVOKE ALL ON FUNCTION "public"."discord_relay_missing_threads"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."discord_relay_missing_threads"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."discord_relay_missing_threads"() FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."discord_relay_missing_threads"() TO "service_role";
