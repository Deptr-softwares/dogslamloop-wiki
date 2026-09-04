-- A character's colour becomes data instead of code.
--
-- Owner: "There is no way to set a character color code there. This ties into a
-- bigger problem where creating a new character page can not account for
-- including but not limited to making new color code, applying that color
-- throughout the site (mainly auto-coloring), and probably more."
--
-- WHERE THE COLOUR LIVES TODAY. window.CHARACTER_COLORS is a hardcoded object
-- literal in js/site_meta.js, keyed by character NAME, and it is read
-- SYNCHRONOUSLY by ten files: pagebuilder.js (roster cards),
-- internalstyling.js (the auto-colouring - character names highlighted in
-- prose), certified-tier-lists.js, tierlist.js, tier-editor.js and
-- tools/free_submit_tier_list.js (tier chips), editor-blocks.js (the colour
-- swatches), editor-core.js and history.js.
--
-- So creating a character page in the owner tools gives it no colour, and
-- getting one takes a code edit, a pull request and a release.
--
-- This column is the source. js/site_meta.js keeps a GENERATED REGION that
-- scripts/fetch-content.js rewrites from these rows, which is what lets the map
-- stay a synchronous literal - the thing all ten consumers depend on - while
-- the owner edits it like any other content. Making it an async fetch instead
-- would mean changing all ten and inventing a load-order problem the site does
-- not currently have.
--
-- TEXT, not a constrained type. The existing values are `hsl(0, 100%, 80%)` and
-- the picker writes `#rrggbb`; both are CSS colours and both must round-trip.
-- The owner tools check the value with CSS.supports() before saving, which
-- understands every form the browser does - a CHECK constraint here would have
-- to reimplement CSS colour parsing in SQL and would be wrong the first time
-- somebody typed a valid colour it had not thought of.
--
-- NULL means "no colour set", which is what every non-character page has and
-- what a new character page starts as. js/pagebuilder.js already falls back to
-- var(--bg-main) for a name it cannot find, so a NULL here renders exactly as
-- an absent dictionary entry does today.

ALTER TABLE "public"."site_pages"
    ADD COLUMN IF NOT EXISTS "color" text;

COMMENT ON COLUMN "public"."site_pages"."color" IS
    'CSS colour for this character, e.g. hsl(0, 100%, 80%) or #ff8080. Generated into window.CHARACTER_COLORS in js/site_meta.js by scripts/fetch-content.js. NULL means no colour set.';

-- No policy or grant change. site_pages already carries an owner-only write
-- policy and the table-level GRANTs that pair with it; a new column on an
-- existing table inherits both, and adding a redundant policy here would be a
-- second gate to keep in sync with the first.
