-- v0.11: the site's own metadata becomes editable.
--
-- Two things the owner asked for, which look like one thing and are not,
-- because they reach the browser by completely different routes:
--
--   1. data/site_meta.json's version and tagline. Fetched at runtime by
--      js/site_meta.js and written into every .site-subtitle. Changing these
--      is a data change.
--
--   2. The <title> and <meta>/OG block on the three hub pages. These CANNOT be
--      set at runtime. Discord, Twitter and Facebook unfurlers do not execute
--      JavaScript, so a tag injected by js/site_meta.js is never seen by any of
--      them - the same constraint that put v0.9's social tags in the generator
--      rather than in a script. And all three hub pages are hand-authored
--      (NEVER_TOUCH in scripts/generate-pages.js), so they cannot simply be
--      regenerated wholesale either.
--
-- Both live in this one singleton table, and the split happens downstream:
-- scripts/fetch-content.js writes data/site_meta.json (the runtime half plus
-- the hub strings), and scripts/generate-hub-meta.js rewrites a marked region
-- inside each hub page's <head> from that committed file. That two-stage shape
-- - a network fetcher writing an artifact, an offline generator consuming it -
-- is the same one page-previews.json and generate-pages.js already use, and it
-- is what keeps the generator's --check deterministic in CI.
--
-- A singleton rather than a key/value settings table: these are a fixed,
-- small, known set of fields, and explicit columns get type checking, a
-- readable schema, and no "what keys exist?" question. The id/CHECK pair is
-- the standard trick for "exactly one row, enforced by the database".

CREATE TABLE IF NOT EXISTS "public"."site_meta" (
    "id" boolean PRIMARY KEY DEFAULT true,
    "version" text NOT NULL,
    "tagline" text NOT NULL,
    -- Keyed by hub page id: main-hub, character-hub, systems-hub. Each value
    -- is {title, description}. jsonb rather than three sets of columns
    -- because the hubs are a list that could grow, while version/tagline are
    -- genuinely singular.
    "hubs" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "site_meta_singleton" CHECK ("id" = true)
);

ALTER TABLE "public"."site_meta" OWNER TO "postgres";

ALTER TABLE "public"."site_meta" ENABLE ROW LEVEL SECURITY;

-- Already fully public: it ships in data/site_meta.json, which every page on
-- the site downloads, and in the page source of all three hubs. Public read is
-- also what lets the regeneration workflow run on the anon key with no
-- credentials.
CREATE POLICY "Public can read site meta" ON "public"."site_meta"
    FOR SELECT USING (true);

-- Site-wide metadata is structural, so admin-only - matching site_pages and
-- site_posts rather than page_data's looser default.
CREATE POLICY "Admins can manage site meta" ON "public"."site_meta"
    TO "authenticated"
    USING (("public"."get_my_role"() = 'admin'::text))
    WITH CHECK (("public"."get_my_role"() = 'admin'::text));

-- Policies without matching grants return 401 before RLS is consulted. This
-- project has been caught by that twice, so grants are always stated.
GRANT SELECT ON TABLE "public"."site_meta" TO "anon";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."site_meta" TO "authenticated";

-- Seeded from what is committed today, so the first regeneration run produces
-- no diff. version/tagline are copied verbatim from data/site_meta.json; the
-- hub strings are copied verbatim from the three pages' current <head>.
INSERT INTO "public"."site_meta" ("id", "version", "tagline", "hubs") VALUES (
    true,
    'Beta v0.10',
    'The Competitive JJS Wiki',
    '{
        "main-hub": {
            "title": "Dogslamloop Wiki",
            "description": "Frame data, matchups, and strategy guides for Jujutsu Shenanigans - a community-run competitive wiki."
        },
        "character-hub": {
            "title": "Character Dashboard",
            "description": "Every Jujutsu Shenanigans character, with frame data, matchups, and strategy for each."
        },
        "systems-hub": {
            "title": "Systems & Guides Hub",
            "description": "Guides to the systems behind Jujutsu Shenanigans - frame data, HUD, evasion, M1 trading, and more."
        }
    }'::jsonb
) ON CONFLICT ("id") DO NOTHING;
