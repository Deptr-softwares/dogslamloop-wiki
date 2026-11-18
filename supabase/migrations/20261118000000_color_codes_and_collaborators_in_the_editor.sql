-- v1.2: Color Codes and Collaborators open in the editor.
--
-- THE PROBLEM. Both pages were hand-written (systems/color-codes,
-- systems/collaborators) and locked: no Edit button for anyone, and the credits
-- changed only through owner tools, in site_collaborators. The Kanban card
-- "Figure out a way to make the site editing feels less restrictive" asked for
-- both in edit.html. v1.2's code draws both from page_data like any system page
-- (a Color Swatches Block per grid, a Collaborator Block per person), so this
-- does the three things the code cannot, applied with that code at the release:
--
--   1. Admin and above may submit to either page (owner, 2026-11-18: "Both
--      Admin level and above (Admin and Owner)"). Set in the same transaction
--      as 2, so the Edit button never shows without the restriction behind it.
--   2. Both pages go from locked to elevated, which is what shows the button.
--   3. Each page gets its content, which until now lived in its HTML: Color
--      Codes its text and three Color Swatches Blocks, Collaborators every
--      site_collaborators row as a Collaborator Block, in sort_order. A page
--      that already has a row keeps it (ON CONFLICT DO NOTHING).
--
-- site_collaborators is left as it is. Nothing writes it any more, and
-- scripts/fetch-content.js reads it only while the Collaborators page has no
-- row, which after this is never.

INSERT INTO "public"."page_permissions" ("page_id", "required_role")
VALUES ('color_codes', 'admin'), ('collaborators', 'admin')
ON CONFLICT ("page_id") DO UPDATE SET "required_role" = EXCLUDED."required_role";

UPDATE "public"."site_pages"
   SET "edit_role" = 'elevated'
 WHERE "page_id" IN ('color_codes', 'collaborators')
   AND "edit_role" = 'locked';

-- The text is the hand-written page's, with one edit: "Color colors used
-- within the Timeline GUI" lost its repeated word.
INSERT INTO "public"."page_data" ("page_id", "page_type", "desc_data", "frame_data")
VALUES ('color_codes', 'system', '{"tabs": [{"tabId": "overview", "tabLabel": "Overview", "sections": [
    {"sectionTitle": "", "layout": "full", "blocks": [
        {"type": "paragraph", "content": ["The standardized color codes, character colors, frame data colors, and state colors used across the Dogslamloop Wiki."]}]},
    {"sectionTitle": "Character Themes", "layout": "full", "blocks": [
        {"type": "paragraph", "content": ["These color codes define the identity of each character and are used automatically for roster cards, tier lists, highlights, and themes."]},
        {"type": "colorswatches", "set": "characters"}]},
    {"sectionTitle": "Frame Data Types", "layout": "full", "blocks": [
        {"type": "paragraph", "content": ["Colors used within the Timeline GUI to represent frame data types."]},
        {"type": "colorswatches", "set": "frames"}]},
    {"sectionTitle": "Stackable Overlays", "layout": "full", "blocks": [
        {"type": "paragraph", "content": ["Inset shadows and borders used to represent i-frames or special properties layered on top of existing frames."]},
        {"type": "colorswatches", "set": "overlays"}]}
]}]}'::jsonb, '{}'::jsonb)
ON CONFLICT ("page_id") DO NOTHING;

-- Each row becomes the Block that scripts/fetch-content.js turns back into the
-- same collaborators_data.json entry, so the home page's Credits list is the
-- same before and after (tests/collaborators-page.spec.js). The two intro
-- lines are the hand-written page's.
INSERT INTO "public"."page_data" ("page_id", "page_type", "desc_data", "frame_data")
SELECT 'collaborators', 'system', jsonb_build_object('tabs', jsonb_build_array(jsonb_build_object(
    'tabId', 'overview',
    'tabLabel', 'Overview',
    'sections', jsonb_build_array(
        jsonb_build_object('sectionTitle', '', 'layout', 'full', 'blocks', jsonb_build_array(
            jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
                'The awesome, sugoi people who helped and contributed to the development of Dogslamloop Wiki.'))
        )),
        jsonb_build_object('sectionTitle', 'Main Contributors', 'layout', 'full', 'blocks', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'type', 'collaborator',
                'kind', 'card',
                'name', c."name",
                'role', COALESCE(c."role", ''),
                'badge', COALESCE(c."badge_type", ''),
                'avatar', COALESCE(c."avatar", ''),
                'description', COALESCE(c."description", ''),
                'links', CASE WHEN jsonb_typeof(c."links") = 'array' THEN c."links" ELSE '[]'::jsonb END
            ) ORDER BY c."sort_order", c."id")
            FROM "public"."site_collaborators" c
            WHERE c."section" = 'main'
        ), '[]'::jsonb)),
        jsonb_build_object('sectionTitle', 'Special Thanks', 'layout', 'full', 'blocks',
            jsonb_build_array(jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
                'This wiki would not be possible without the testing, data, and feedback from the following community members:')))
            || COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'type', 'collaborator',
                    'kind', 'line',
                    'name', c."name",
                    'description', COALESCE(c."description", '')
                ) ORDER BY c."sort_order", c."id")
                FROM "public"."site_collaborators" c
                WHERE c."section" = 'thanks'
            ), '[]'::jsonb))
    )
))), '{}'::jsonb
ON CONFLICT ("page_id") DO NOTHING;
