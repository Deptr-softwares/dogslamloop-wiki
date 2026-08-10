-- v0.12: two new page types, so others/ and tools/ can hold something other
-- than an ordinary system page.
--
--   gallery - a *simplified* system page built to hold a large volume of
--             gif/video, with an internal search bar. Emotes is the first.
--             Deliberately not a richer system page: the point is fewer
--             authored blocks and more media per page.
--   tool    - a page hosting one of the site owner's own tools, as opposed to
--             a system page linking out to someone else's.
--
-- The directory a page lives in is already separate from its type (see
-- PAGE_DIRECTORIES in js/owner.js), so this adds render behaviour only. Both
-- get generated stubs rather than following the tierlist precedent of a
-- hand-authored page in NEVER_TOUCH - that does not scale to a gallery per
-- gamemode or a page per tool.
--
-- ADD, not replace: the existing five values keep working untouched, so no
-- row needs migrating and nothing that reads page_type changes meaning.

ALTER TABLE "public"."site_pages"
    DROP CONSTRAINT IF EXISTS "site_pages_page_type_check";

ALTER TABLE "public"."site_pages"
    ADD CONSTRAINT "site_pages_page_type_check"
    CHECK ("page_type" = ANY (ARRAY[
        'character'::text,
        'system'::text,
        'tierlist'::text,
        'hub'::text,
        'external'::text,
        'gallery'::text,
        'tool'::text
    ]));
