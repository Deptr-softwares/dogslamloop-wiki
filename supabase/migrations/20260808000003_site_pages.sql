-- v0.10: site_pages - the page registry, so pages can be created and retired
-- from owner.html instead of by hand-editing data/navigation.json.
--
-- navigation.json is the single source for every list on the site: the global
-- sidebar (buildGlobalSidebarMenu), the character roster grid
-- (renderFilteredRoster) and the systems directory (buildSystemsDirectory).
-- It is a static file, so adding a page has always meant a commit. This table
-- mirrors it exactly, and scripts/generate-pages.js will regenerate both
-- navigation.json and the page stubs from it.
--
-- Column names deliberately match the JSON's field names rather than being
-- "improved" into snake_case equivalents with different words - the generator
-- has to round-trip this into the exact shape the existing JS already reads,
-- and a rename layer is one more place for the two to drift apart.
--
-- RLS is public-read on purpose. Every field here is already public: it ships
-- in navigation.json, which every visitor downloads. Keeping it readable by
-- anon is what lets the regeneration workflow run with the public anon key
-- and hold no credentials at all.

CREATE TABLE IF NOT EXISTS "public"."site_pages" (
    "page_id" text NOT NULL,
    "nav_id" text NOT NULL,
    "name" text NOT NULL,
    "url" text NOT NULL,
    "category" text NOT NULL,
    -- Explicit ordering. navigation.json's order is currently just array
    -- position, which a database has no equivalent of.
    "sort_order" integer NOT NULL DEFAULT 0,
    "page_type" text NOT NULL DEFAULT 'character',
    "edit_role" text NOT NULL DEFAULT 'open',
    "is_wip" boolean NOT NULL DEFAULT false,
    "is_ea" boolean NOT NULL DEFAULT false,
    "is_base_only" boolean NOT NULL DEFAULT false,
    "is_missing_media" boolean NOT NULL DEFAULT false,
    "is_subjective" boolean NOT NULL DEFAULT false,
    "archetype" text,
    "tier" text,
    "release_date" text,
    -- 'live' pages are emitted normally. 'archived' pages get a tombstone
    -- stub - HTTP 200 with a "this page has been archived" body - rather than
    -- being deleted, so existing links and Discord embeds do not start
    -- 404ing. 'draft' pages are not emitted at all yet.
    "status" text NOT NULL DEFAULT 'live',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "site_pages_pkey" PRIMARY KEY ("page_id"),
    CONSTRAINT "site_pages_nav_id_key" UNIQUE ("nav_id"),
    CONSTRAINT "site_pages_url_key" UNIQUE ("url"),
    -- Mirrors scripts/validate-navigation.js's own rules, so a bad row cannot
    -- be created in the first place rather than being caught downstream when
    -- the generator refuses to run.
    CONSTRAINT "site_pages_page_type_check" CHECK ("page_type" = ANY (ARRAY['character'::text, 'system'::text, 'tierlist'::text, 'hub'::text, 'external'::text])),
    CONSTRAINT "site_pages_edit_role_check" CHECK ("edit_role" = ANY (ARRAY['open'::text, 'elevated'::text, 'locked'::text])),
    CONSTRAINT "site_pages_status_check" CHECK ("status" = ANY (ARRAY['live'::text, 'draft'::text, 'archived'::text]))
);

ALTER TABLE "public"."site_pages" OWNER TO "postgres";

ALTER TABLE "public"."site_pages" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read the page registry" ON "public"."site_pages"
    FOR SELECT USING (true);

-- Creating and retiring pages is structural, so admin-only - matching
-- page_permissions and site_posts rather than page_data.
CREATE POLICY "Admins can manage the page registry" ON "public"."site_pages"
    TO "authenticated"
    USING (("public"."get_my_role"() = 'admin'::text))
    WITH CHECK (("public"."get_my_role"() = 'admin'::text));

-- Policies without matching grants return 401 before RLS is consulted. This
-- project has been caught by that twice, so grants are always stated here.
GRANT SELECT ON TABLE "public"."site_pages" TO "anon";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."site_pages" TO "authenticated";

CREATE INDEX IF NOT EXISTS "site_pages_listing_idx"
    ON "public"."site_pages" ("category", "sort_order");

-- Seed: an exact mirror of data/navigation.json as of 2026-08-08, generated
-- from that file rather than typed by hand. The generator will regenerate
-- navigation.json from this table, so the two must start identical - any
-- discrepancy here would show up as a spurious diff on the first run and,
-- worse, would silently change the live navigation.
--
-- sort_order is spaced by 10 so a page can be moved between two others
-- without renumbering the whole category.
INSERT INTO "public"."site_pages" (
    "page_id", "nav_id", "name", "url", "category", "sort_order",
    "page_type", "edit_role",
    "is_wip", "is_ea", "is_base_only", "is_missing_media", "is_subjective",
    "archetype", "tier", "release_date"
) VALUES
    ('honored_one', 'Honored-One', 'Honored One', 'characters/Honored_one/index.html', 'Characters', 0, 'character', 'open', true, false, false, true, false, 'TBD', 'TBD', 'TBD'),
    ('vessel', 'Vessel', 'Vessel', 'characters/Vessel/index.html', 'Characters', 10, 'character', 'open', true, false, false, true, false, 'TBD', 'TBD', 'TBD'),
    ('restless_gambler', 'Restless-Gambler', 'Restless Gambler', 'characters/Restless_gambler/index.html', 'Characters', 20, 'character', 'open', true, false, false, true, false, 'TBD', 'TBD', 'TBD'),
    ('ten_shadows', 'Ten-Shadows', 'Ten Shadows', 'characters/Ten_shadows/index.html', 'Characters', 30, 'character', 'open', true, false, false, true, false, 'TBD', 'TBD', 'TBD'),
    ('perfection', 'Perfection', 'Perfection', 'characters/Perfection/index.html', 'Characters', 40, 'character', 'open', true, false, false, true, false, 'TBD', 'TBD', 'TBD'),
    ('blood_manipulator', 'Blood-Manipulator', 'Blood Manipulator', 'characters/Blood_manipulator/index.html', 'Characters', 50, 'character', 'open', true, false, false, true, false, 'TBD', 'TBD', 'TBD'),
    ('switcher', 'Switcher', 'Switcher', 'characters/Switcher/index.html', 'Characters', 60, 'character', 'open', true, false, false, true, false, 'TBD', 'TBD', 'TBD'),
    ('defense_attorney', 'Defense-Attorney', 'Defense Attorney', 'characters/Defense_attorney/index.html', 'Characters', 70, 'character', 'open', true, false, false, true, false, 'TBD', 'TBD', 'TBD'),
    ('cursed_partners', 'Cursed-Partners', 'Cursed Partners', 'characters/Cursed_partners/index.html', 'Characters', 80, 'character', 'open', true, false, false, true, false, 'TBD', 'TBD', 'TBD'),
    ('puppet_master', 'Puppet-Master', 'Puppet Master', 'characters/Puppet_master/index.html', 'Characters', 90, 'character', 'open', true, false, false, true, false, 'TBD', 'TBD', 'TBD'),
    ('head_hei', 'Head-Hei', 'Head of the Hei', 'characters/Head_hei/index.html', 'Characters', 100, 'character', 'open', true, false, false, true, false, 'TBD', 'TBD', 'TBD'),
    ('salaryman', 'Salaryman', 'Salaryman', 'characters/Salaryman/index.html', 'Characters', 110, 'character', 'open', true, false, false, true, false, 'TBD', 'TBD', 'TBD'),
    ('disaster_plants', 'Disaster-Plants', 'Disaster Plants', 'characters/Disaster_plants/index.html', 'Characters', 120, 'character', 'open', true, true, false, true, false, 'TBD', 'TBD', 'TBD'),
    ('true_cannon', 'True-Cannon', 'True Cannon', 'characters/True_cannon/index.html', 'Characters', 130, 'character', 'open', true, false, false, true, false, 'TBD', 'TBD', 'TBD'),
    ('register', 'Register', 'Register', 'characters/Register/index.html', 'Characters', 140, 'character', 'open', true, true, false, true, false, 'TBD', 'TBD', 'TBD'),
    ('locust_guy', 'Locust', 'Locust Guy', 'characters/Locust_guy/index.html', 'Characters', 150, 'character', 'open', true, false, true, true, false, 'TBD', 'TBD', 'TBD'),
    ('star_rage', 'Star-Rage', 'Star Rage', 'characters/Star_rage/index.html', 'Characters', 160, 'character', 'open', true, false, true, true, false, 'TBD', 'TBD', 'TBD'),
    ('aspiring_mangaka', 'Mangaka', 'Aspiring Mangaka', 'characters/Aspiring_mangaka/index.html', 'Characters', 170, 'character', 'open', true, false, true, true, false, 'TBD', 'TBD', 'TBD'),
    ('lucky_coward', 'Lucky-Coward', 'Lucky Coward', 'characters/Lucky_coward/index.html', 'Characters', 180, 'character', 'open', true, false, true, true, false, 'TBD', 'TBD', 'TBD'),
    ('crow_charmer', 'Sus-Sister', 'Crow Charmer', 'characters/Crow_charmer/index.html', 'Characters', 190, 'character', 'open', true, false, true, true, false, 'TBD', 'TBD', 'TBD'),
    ('black_death', 'Black-Death', 'Black Death', 'characters/Black_death/index.html', 'Characters', 200, 'character', 'open', true, false, true, true, false, 'TBD', 'TBD', 'TBD'),
    ('boomcat', 'Boomcat', 'Boomcat', 'characters/Boomcat/index.html', 'Characters', 210, 'character', 'open', false, false, false, false, false, 'TBD', 'TBD', 'TBD'),
    ('hud', 'hud', 'HUD', 'systems/hud/index.html', 'System Pages', 0, 'system', 'open', true, false, false, false, false, NULL, NULL, NULL),
    ('framedata', 'framedata', 'Frame data', 'systems/framedata/index.html', 'System Pages', 10, 'system', 'open', true, false, false, false, false, NULL, NULL, NULL),
    ('fundamentals', 'fundamentals', 'Fundamentals', 'systems/fundamentals/index.html', 'System Pages', 20, 'system', 'open', true, false, false, false, false, NULL, NULL, NULL),
    ('evasive', 'evasive', 'Evasive', 'systems/evasive/index.html', 'System Pages', 30, 'system', 'open', true, false, false, false, false, NULL, NULL, NULL),
    ('character-hub', 'character-hub', 'Character Hub', 'characters/index.html', 'Site Info', 0, 'hub', 'locked', true, false, false, false, false, NULL, NULL, NULL),
    ('systems-hub', 'systems-hub', 'Systems Hub', 'systems/index.html', 'Site Info', 10, 'hub', 'locked', true, false, false, false, false, NULL, NULL, NULL),
    ('template', 'template', 'Template & Guide', 'characters/Template/index.html', 'Site Info', 20, 'character', 'elevated', false, false, false, false, false, NULL, NULL, NULL),
    ('writing_guide', 'writing_guide', 'Writing Guide', 'systems/writing_guide/index.html', 'Site Info', 30, 'system', 'elevated', true, false, false, false, false, NULL, NULL, NULL),
    ('source-code', 'source-code', 'Source Code', 'https://github.com/Deptr-softwares/dogslamloop-wiki', 'Site Info', 40, 'external', 'locked', false, false, false, false, false, NULL, NULL, NULL),
    ('updatelog', 'updatelog', 'Update Log', 'systems/updatelog/index.html', 'Site Info', 50, 'system', 'locked', false, false, false, false, false, NULL, NULL, NULL),
    ('blog', 'blog', 'Blog', 'blog.html', 'Site Info', 60, 'hub', 'locked', false, false, false, false, false, NULL, NULL, NULL),
    ('recent-changes', 'recent-changes', 'Recent Changes', 'recent-changes.html', 'Site Info', 70, 'hub', 'locked', false, false, false, false, false, NULL, NULL, NULL),
    ('collaborators', 'collaborators', 'Collaborators', 'systems/collaborators/index.html', 'Site Info', 80, 'system', 'locked', false, false, false, false, false, NULL, NULL, NULL),
    ('m1_trading', 'm1-trading', 'M1 Trading', 'systems/m1-trading/index.html', 'Guides', 0, 'system', 'open', true, false, false, false, false, NULL, NULL, NULL),
    ('starter_guide', 'starter-guide', 'Starter Guide', 'systems/starter-guide/index.html', 'Guides', 10, 'system', 'open', true, false, false, false, false, NULL, NULL, NULL),
    ('terminologies', 'terminologies', 'Terminologies', 'systems/terminologies/index.html', 'Guides', 20, 'system', 'open', true, false, false, false, false, NULL, NULL, NULL),
    ('color_codes', 'color-codes', 'Color Codes', 'systems/color-codes/index.html', 'Guides', 30, 'system', 'locked', true, false, false, false, false, NULL, NULL, NULL),
    ('tierlist', 'tierlist', 'Tier List', 'systems/tierlist/index.html', 'Guides', 40, 'tierlist', 'elevated', true, false, false, false, true, NULL, NULL, NULL)
ON CONFLICT ("page_id") DO NOTHING;
