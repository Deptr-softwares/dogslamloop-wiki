-- v0.11: the three hub dashboards get their prose from the CMS instead of
-- being hardcoded in HTML.
--
-- index.html ("Main Dashboard"), characters/index.html ("Character Dashboard")
-- and systems/index.html ("Side Dashboard") each carry an intro paragraph
-- written directly into the markup, so changing a sentence means a commit and
-- a deploy. Every other body of text on this site stopped working that way
-- some versions ago.
--
-- The original plan for this was a new table plus bespoke owner.html
-- textareas. That was dropped once it became clear the site already has the
-- whole pipeline: page_data holds block arrays, generateHTMLForBlocks renders
-- them, and the editor already authors them. Two consumers already render
-- authored blocks outside a character page - populateTextSection and
-- posts.js's renderPostBody - so this is an established path rather than a new
-- one.
--
-- The one wrinkle is page_type. These rows are stored as 'system', not 'hub',
-- and that is deliberate: page_data.page_type drives the editor and the
-- renderer, while site_pages.page_type drives navigation. Storing 'system'
-- means js/editor-core.js already knows how to edit these rows with no changes
-- at all - it reads ?type= straight off the query string and branches on
-- 'system'. The hubs remain page_type 'hub' in site_pages, where that value
-- means "not a content page in the navigation sense", which is still true.
--
-- Tabs are used as named slots. A hub is not a tabbed page; it has several
-- separate authored regions in fixed positions, and a tab is already exactly
-- "a named bag of sections" in this schema. Reusing it means the editor's
-- existing tab UI becomes the slot picker for free.
--
-- Seeded with the copy currently in the markup, so this migration changes
-- nothing visible on its own. The HTML is deliberately left in place as a
-- fallback - see js/hub_content.js, which only replaces a container when it
-- actually has content to put there, so a database outage degrades to today's
-- text rather than a blank dashboard.

INSERT INTO "public"."page_data" ("page_id", "page_type", "desc_data", "frame_data") VALUES
    ('main-hub', 'system', '{
        "tabs": [{
            "tabId": "about",
            "tabLabel": "About Us",
            "sections": [{
                "sectionTitle": "About Us",
                "layout": "full",
                "width": 100,
                "alignment": "left",
                "blocks": [
                    {"type": "heading", "size": "h2", "align": "left", "content": "About Us"},
                    {"type": "paragraph", "align": "left", "content": "Jujutsu Shenanigans is a casual (shenanigans) battleground game on Roblox. However, this hub provides in-depth frame data, and strategy breakdowns to help all users, Tier 5 and Tier 1, to get better at the game via better understanding of the game."}
                ]
            }]
        }]
    }'::jsonb, NULL),

    ('character-hub', 'system', '{
        "tabs": [{
            "tabId": "intro",
            "tabLabel": "Roster Overview",
            "sections": [{
                "sectionTitle": "Roster Overview",
                "layout": "full",
                "width": 100,
                "alignment": "left",
                "blocks": [
                    {"type": "heading", "size": "h2", "align": "left", "content": "Roster Overview"},
                    {"type": "paragraph", "align": "left", "content": "Welcome to the Character Dashboard. Here you can find general information for every character in the game. Select a character below to view their dedicated wiki page."}
                ]
            }]
        }]
    }'::jsonb, NULL),

    ('systems-hub', 'system', '{
        "tabs": [{
            "tabId": "intro",
            "tabLabel": "Introduction",
            "sections": [{
                "sectionTitle": "Info, Guides & Resources",
                "layout": "full",
                "width": 100,
                "alignment": "left",
                "blocks": [
                    {"type": "heading", "size": "h2", "align": "left", "content": "Info, Guides & Resources"},
                    {"type": "paragraph", "align": "left", "content": "Welcome to the Side Dashboard. This is where the wiki explains itself: how the site works, how to read it, and how to help build it."}
                ]
            }]
        }]
    }'::jsonb, NULL)
ON CONFLICT ("page_id") DO NOTHING;

-- Hub prose is structural site copy, so it is admin-only to submit - matching
-- site_pages and site_posts rather than page_data's looser default.
--
-- 20260731000000_page_permissions.sql explicitly declined to seed
-- 'character_dashboard'/'side_dashboard' on the grounds that they "don't
-- correspond to any real page (navigation.json has no matching id, and neither
-- page ever calls into the edit pipeline)". That was correct then. As of this
-- migration both statements stop being true, under the ids the rest of the
-- system actually uses.
INSERT INTO "public"."page_permissions" ("page_id", "required_role") VALUES
    ('main-hub', 'admin'),
    ('character-hub', 'admin'),
    ('systems-hub', 'admin')
ON CONFLICT ("page_id") DO NOTHING;
