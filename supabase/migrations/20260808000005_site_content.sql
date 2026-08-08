-- v0.10: FAQ and collaborators become editable content.
--
-- Both are static JSON files today (data/faq.json,
-- systems/collaborators/collaborators_data.json), so changing a FAQ answer or
-- adding a contributor means a commit. They move behind tables here, and the
-- regeneration workflow writes the JSON files back out - the runtime keeps
-- fetching plain JSON exactly as it does now, so no page-side code changes.
--
-- Credits additionally has a two-sources-of-truth problem worth fixing while
-- we are here: index.html carries a hardcoded <ul class="credits-list"> that
-- duplicates collaborators_data.json by hand, and the two have already
-- drifted. After this, both render from the same rows.

CREATE TABLE IF NOT EXISTS "public"."site_faq" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "question" text NOT NULL,
    -- Kept as an array to match the existing JSON shape, which
    -- js/home_widgets.js renders as one <p> per entry.
    "paragraphs" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "sort_order" integer NOT NULL DEFAULT 0,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "public"."site_collaborators" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "name" text NOT NULL,
    "role" text,
    "description" text,
    "avatar" text,
    "badge_type" text,
    "is_lead" boolean NOT NULL DEFAULT false,
    -- Mirrors the JSON's [{name, url}] shape.
    "links" jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- 'main' renders as a full contributor card, 'thanks' as a plain
    -- special-thanks line - the two lists the collaborators page already has.
    "section" text NOT NULL DEFAULT 'main',
    "sort_order" integer NOT NULL DEFAULT 0,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "site_collaborators_section_check" CHECK ("section" = ANY (ARRAY['main'::text, 'thanks'::text]))
);

ALTER TABLE "public"."site_faq" OWNER TO "postgres";
ALTER TABLE "public"."site_collaborators" OWNER TO "postgres";

ALTER TABLE "public"."site_faq" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."site_collaborators" ENABLE ROW LEVEL SECURITY;

-- Both are already fully public - they ship as JSON every visitor downloads.
-- Public-read is also what lets the regeneration workflow run on the anon key
-- and hold no credentials.
CREATE POLICY "Public can read the FAQ" ON "public"."site_faq"
    FOR SELECT USING (true);
CREATE POLICY "Public can read collaborators" ON "public"."site_collaborators"
    FOR SELECT USING (true);

CREATE POLICY "Admins can manage the FAQ" ON "public"."site_faq"
    TO "authenticated"
    USING (("public"."get_my_role"() = 'admin'::text))
    WITH CHECK (("public"."get_my_role"() = 'admin'::text));
CREATE POLICY "Admins can manage collaborators" ON "public"."site_collaborators"
    TO "authenticated"
    USING (("public"."get_my_role"() = 'admin'::text))
    WITH CHECK (("public"."get_my_role"() = 'admin'::text));

-- Policies without matching grants return 401 before RLS is consulted.
GRANT SELECT ON TABLE "public"."site_faq" TO "anon";
GRANT SELECT ON TABLE "public"."site_collaborators" TO "anon";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."site_faq" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."site_collaborators" TO "authenticated";

-- Seed, generated from the existing JSON files rather than typed, so the
-- regenerated output starts identical to what is committed.
INSERT INTO "public"."site_faq" ("question", "paragraphs", "sort_order") VALUES
    ('What is "Boomcat"?', '["Boomcat is my spirit animal."]'::jsonb, 0),
    ('How do you measure this frame data?', '["We record the game at a locked 60 FPS and count the video frames one by one in editing software to determine the numbers.","There is a set standard for analyzing these. @Mrt1 please expand on this section."]'::jsonb, 10),
    ('Can I contribute to the wiki?', '["Absolutely! You can reach out directly via Discord.","Contact @.mrt1 for frame data stuff, or contact @deptr4869 for the site and general feedback."]'::jsonb, 20);

INSERT INTO "public"."site_collaborators" (
    "name", "role", "description", "avatar", "badge_type", "is_lead", "links", "section", "sort_order"
) VALUES
    ('Deptr', 'Lead Developer and Owner', 'Pretty much the sole dev of Dogslamloop, worked on almost every feature in the site, and some double checking of frame data.', '/medias/images/DestroymanFront.webp', 'badge-patch', true, '[{"name":"GitHub","url":"https://github.com/Deptr-softwares"}]'::jsonb, 'main', 0),
    ('MrT1', 'Frame Data & Testing', 'Spent countless hours recording 60FPS footage to count frames and such. Contact him via @.mrt1 on Discord.', '/medias/images/Solid Blue.webp', 'badge-site', false, '[]'::jsonb, 'main', 10),
    ('Air Putrifier', 'Strategies and Resource', 'Written a lot of strategy entries for the site (perchance), also allow me to borrow his awesome Medal clips.', '/medias/images/diego2.webp', 'badge-site', false, '[]'::jsonb, 'main', 20),
    ('Nickolas4F', 'Strategies', 'Written a lot of strategy entries for the site, awesome mobile player as well.', '/medias/images/nickpfp.webp', 'badge-site', false, '[{"name":"YouTube","url":"https://www.youtube.com/@CrailsheimTS"}]'::jsonb, 'main', 30),
    ('PositiveHA', 'Testing & Strategies', 'Figured out the 4-frames rule for M1 trading stuff, among other things as well.', '/medias/images/OrochimaruKunfoPop.webp', 'badge-site', false, '[{"name":"YouTube","url":"https://www.youtube.com/@PositiveHA"}]'::jsonb, 'main', 40),
    ('FUNNY_NAME_2', NULL, 'Suggested the color format for the frame data', NULL, NULL, false, '[]'::jsonb, 'thanks', 0),
    ('Kigtus', NULL, 'Owner of the Unofficial JJS wiki who allowed us to borrow their resource', NULL, NULL, false, '[]'::jsonb, 'thanks', 10),
    ('Nova', NULL, 'I think he helped Nickolas4F right?', NULL, NULL, false, '[]'::jsonb, 'thanks', 20),
    ('Demi', NULL, 'I think she helped PositiveHA right?', NULL, NULL, false, '[]'::jsonb, 'thanks', 30),
    ('Boomcat', NULL, 'Everything', NULL, NULL, false, '[]'::jsonb, 'thanks', 40);
