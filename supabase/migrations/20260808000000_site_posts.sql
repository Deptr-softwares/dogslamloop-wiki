-- v0.9 P7: the posts system.
--
-- One table for three things that are the same shape and differ only in
-- intent, rather than parallel infrastructure for each:
--   'blog'      - long-form writing, read on blog.html
--   'hotfix'    - short site-news notes that don't warrant a version bump,
--                 shown in the Update Log beside versioned entries
--   'changelog' - reserved. data/updates.json stays the source of versioned
--                 release notes for now; moving it here is a v0.10 job and
--                 the column exists so that migration is a data move rather
--                 than a schema change.
--
-- `content` holds the same block array format the wiki already uses
-- (js/editor-blocks.js authors it, js/description.js's generateHTMLForBlocks
-- renders it), so posts get paragraphs, headings, images, callouts, tables
-- and the [color=]/[b]/[url=] shortcodes for free, and there is no second
-- content format to maintain.

CREATE TABLE IF NOT EXISTS "public"."site_posts" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL,
    -- Published separately from created_at so a draft written today can be
    -- backdated or scheduled without lying about when it was written.
    "published_at" timestamptz,
    "kind" text NOT NULL DEFAULT 'blog',
    "status" text NOT NULL DEFAULT 'draft',
    "title" text NOT NULL,
    -- URL-facing identifier. Unique so blog.html?post=<slug> is unambiguous.
    "slug" text NOT NULL,
    -- Short teaser for listings and social previews. Optional: listings fall
    -- back to the title alone rather than inventing an excerpt.
    "summary" text,
    "content" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "author_name" text,
    CONSTRAINT "site_posts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "site_posts_slug_key" UNIQUE ("slug"),
    CONSTRAINT "site_posts_kind_check" CHECK ("kind" = ANY (ARRAY['blog'::text, 'hotfix'::text, 'changelog'::text])),
    CONSTRAINT "site_posts_status_check" CHECK ("status" = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text]))
);

ALTER TABLE "public"."site_posts" OWNER TO "postgres";

ALTER TABLE "public"."site_posts" ENABLE ROW LEVEL SECURITY;

-- Readers see published posts only. Drafts and archived posts stay invisible
-- to anon and to logged-in non-staff alike - "draft" has to actually mean
-- draft, or the owner can't write anything ahead of time.
CREATE POLICY "Public can view published posts" ON "public"."site_posts"
    FOR SELECT USING ("status" = 'published');

-- Staff see everything, including drafts.
CREATE POLICY "Staff can view all posts" ON "public"."site_posts"
    FOR SELECT TO "authenticated"
    USING (("public"."get_my_role"() = ANY (ARRAY['admin'::text, 'reviewer'::text])));

-- Only admins write. Posts are site-owner voice, not contributor content, so
-- this is deliberately tighter than page_data (which allows reviewers too).
CREATE POLICY "Admins can write posts" ON "public"."site_posts"
    TO "authenticated"
    USING (("public"."get_my_role"() = 'admin'::text))
    WITH CHECK (("public"."get_my_role"() = 'admin'::text));

-- A policy without a matching table GRANT yields a 401, not a denial - the
-- default privileges give anon only REFERENCES/TRIGGER/TRUNCATE/MAINTAIN.
-- This project has been bitten by exactly that twice (page_history's missing
-- SELECT grant, and anon's missing grant on pending_revisions), so the grants
-- are stated explicitly alongside the policies rather than assumed.
GRANT SELECT ON TABLE "public"."site_posts" TO "anon";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."site_posts" TO "authenticated";

-- Listing queries are always "published, newest first, of one kind".
CREATE INDEX IF NOT EXISTS "site_posts_listing_idx"
    ON "public"."site_posts" ("kind", "status", "published_at" DESC);
