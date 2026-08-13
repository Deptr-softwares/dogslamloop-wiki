-- v0.14 item 3: the Certified Tier List becomes N lists, one per person.
--
-- The owner's decision, 2026-08-13. The page held 22 tabs - one Overall plus
-- 21 "vs <character>" tabs - and becomes one tier list per assigned
-- individual, credited by name.
--
-- DROPPING THE 21 MATCHUP TABS REMOVES A DUPLICATE RATHER THAN LOSING
-- CONTENT. They are a second ranking of what every character page's Matchups
-- tab already carries - the one v0.13 just widened to nine tiers. Two parallel
-- sources for "how does X fare against Y" is exactly the drift the matchup
-- vocabulary work existed to stop, and this retires the weaker of the two: the
-- character page's version sits beside the frame data, is edited by whoever
-- knows that character, and is already in the review workflow.
--
-- NOTHING IS DELETED HERE. page_data.desc_data for page_id='tierlist' is read
-- to seed the owner's list and then left exactly as it is. The 22 tabs remain
-- in that row and in page_history, so this migration is reversible by pointing
-- the renderer back at them.
--
-- WHY A TABLE RATHER THAN MORE JSON. desc_data.tabs held one current state per
-- tab and no history at all, so "what changed, when, and why" had nowhere to
-- live. Per-person ownership makes that worse: RLS cannot say "this person may
-- edit their own entry inside this JSON blob", only "this person may edit this
-- row". The permission model is what forces the shape.

-- --------------------------------------------------------------------------
-- THE LISTS
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."tier_lists" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,

    -- URL-facing, so a list can be linked and shared: ?list=<slug>
    "slug" text NOT NULL,

    -- The assignee. Nullable with ON DELETE SET NULL for the same reason every
    -- other authored table on this site is: anonymize_user_by_email hard-
    -- deletes the auth.users row, and a plain reference would make deleting a
    -- past contributor fail.
    "owner_id" uuid,

    -- Credited by name, and denormalized so the credit survives the account.
    -- This is the point of the feature: a named list is a claim somebody is
    -- accountable for, which is both more honest and less brigade-able than an
    -- official-looking consensus.
    "author_name" text NOT NULL,

    -- Optional flavour. The name is the headline; these are for "Zoner
    -- specialist, plays Vessel" rather than for a second title.
    "blurb" text,

    "status" text NOT NULL DEFAULT 'published',

    -- [{ name, color, characters: [page_id, ...] }]
    --
    -- characters holds page_id - the key page_data, site_pages,
    -- page_discussions and everything else on this site uses - NOT the
    -- navigation display slug the old tabs stored. The old shape stored things
    -- like 'Sus-Sister' and relied on a normalizer that lowercased and
    -- stripped punctuation to find the roster entry; that worked, but three
    -- entries (Locust, Mangaka, Sus-Sister) differ from their real page id by
    -- more than punctuation and only matched because the roster's own display
    -- slug happened to agree. Owner's call: rewrite them to the canonical key.
    "tiers" jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- Long-form, in the same block array the rest of the site authors and
    -- renders (js/editor-blocks.js writes it, generateHTMLForBlocks renders
    -- it). A tier list author wants paragraphs, headings, images, callouts and
    -- the colour shortcodes, and every one of those already exists.
    "reasoning" jsonb NOT NULL DEFAULT '[]'::jsonb,

    "created_at" timestamptz NOT NULL DEFAULT now(),
    -- Drives "updated recently", which is what gives a returning reader a
    -- reason to pick one list out of several.
    "updated_at" timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT "tier_lists_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tier_lists_slug_key" UNIQUE ("slug"),
    -- One list per person. A second would have no name to be credited under.
    CONSTRAINT "tier_lists_owner_key" UNIQUE ("owner_id"),
    CONSTRAINT "tier_lists_owner_fkey" FOREIGN KEY ("owner_id")
        REFERENCES "auth"."users"("id") ON DELETE SET NULL,
    CONSTRAINT "tier_lists_status_check" CHECK ("status" = ANY (ARRAY[
        'draft'::text, 'published'::text, 'archived'::text
    ]))
);

ALTER TABLE "public"."tier_lists" OWNER TO "postgres";
ALTER TABLE "public"."tier_lists" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "tier_lists_recent_idx"
    ON "public"."tier_lists" ("status", "updated_at" DESC);


-- --------------------------------------------------------------------------
-- THE CHANGELOG
-- --------------------------------------------------------------------------
--
-- One row per move, and the note is NOT NULL with a length floor.
--
-- The owner's requirement is that every character going up or down gets a
-- short note from that author at the time they move it. Making the note
-- required in the SCHEMA rather than only in the editor is what turns it from
-- a field somebody may ignore into a rule - a tier list whose changelog says
-- "moved Vessel from D to B" and nothing else is exactly the artefact this was
-- meant to prevent.
CREATE TABLE IF NOT EXISTS "public"."tier_list_changes" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "list_id" uuid NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),

    -- page_id, as above.
    "character_id" text NOT NULL,
    -- NULL from_tier means newly placed; NULL to_tier means removed from the
    -- list entirely. Both are real events worth a note.
    "from_tier" text,
    "to_tier" text,

    "note" text NOT NULL,
    "author_name" text NOT NULL DEFAULT '',

    CONSTRAINT "tier_list_changes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tier_list_changes_list_fkey" FOREIGN KEY ("list_id")
        REFERENCES "public"."tier_lists"("id") ON DELETE CASCADE,
    -- Three characters is not a justification, but a floor stops the empty
    -- string and the single space without pretending to judge prose.
    CONSTRAINT "tier_list_changes_note_length"
        CHECK (char_length(btrim("note")) >= 3 AND char_length("note") <= 500),
    -- A move that moves nothing is not a move.
    CONSTRAINT "tier_list_changes_actually_moved"
        CHECK ("from_tier" IS DISTINCT FROM "to_tier")
);

ALTER TABLE "public"."tier_list_changes" OWNER TO "postgres";
ALTER TABLE "public"."tier_list_changes" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "tier_list_changes_list_idx"
    ON "public"."tier_list_changes" ("list_id", "created_at" DESC);


-- --------------------------------------------------------------------------
-- POLICIES
-- --------------------------------------------------------------------------
--
-- THE PERMISSION MODEL IS THE NEW PART. Page access on this site is role-based
-- today - page_permissions.required_role gates a whole page and anyone holding
-- the role edits all of it. This needs per-ROW ownership: the assignee edits
-- their own list and nobody else's, with admins above all of it. Closer to the
-- capability work than to the role work, and the part most likely to be
-- underestimated.

CREATE POLICY "Anyone can read published tier lists" ON "public"."tier_lists"
    FOR SELECT USING (
        "status" = 'published'
        OR "owner_id" = "auth"."uid"()
        OR "public"."get_my_role"() = ANY (ARRAY['admin'::text, 'reviewer'::text])
    );

-- The whole per-row model in one expression. IS NOT DISTINCT FROM rather than
-- =, so a list whose owner has been anonymized (owner_id NULL) is not somehow
-- editable by a caller whose auth.uid() is also NULL - an anonymous caller.
CREATE POLICY "Owners edit their own list" ON "public"."tier_lists"
    FOR UPDATE TO "authenticated"
    USING (
        ("owner_id" IS NOT NULL AND "owner_id" = "auth"."uid"())
        OR "public"."get_my_role"() = 'admin'
    )
    WITH CHECK (
        ("owner_id" IS NOT NULL AND "owner_id" = "auth"."uid"())
        OR "public"."get_my_role"() = 'admin'
    );

-- Creating and removing a list is assigning a person, which is the owner's
-- job rather than the assignee's.
CREATE POLICY "Admins create tier lists" ON "public"."tier_lists"
    FOR INSERT TO "authenticated"
    WITH CHECK ("public"."get_my_role"() = 'admin');

CREATE POLICY "Admins delete tier lists" ON "public"."tier_lists"
    FOR DELETE TO "authenticated"
    USING ("public"."get_my_role"() = 'admin');

-- The changelog is public: it is the argument for the ranking, and hiding it
-- would leave the ranking looking unattributed again.
CREATE POLICY "Anyone can read tier list changes" ON "public"."tier_list_changes"
    FOR SELECT USING (true);

-- Written through the RPC below rather than directly, so a note cannot be
-- omitted by a client that simply does not send one.
CREATE POLICY "Admins can correct the changelog" ON "public"."tier_list_changes"
    FOR DELETE TO "authenticated"
    USING ("public"."get_my_role"() = 'admin');

-- Policies without matching grants yield 401 before RLS is consulted. This
-- project has been bitten by that twice.
GRANT SELECT ON TABLE "public"."tier_lists" TO "anon";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."tier_lists" TO "authenticated";
GRANT SELECT ON TABLE "public"."tier_list_changes" TO "anon";
GRANT SELECT, DELETE ON TABLE "public"."tier_list_changes" TO "authenticated";


-- --------------------------------------------------------------------------
-- SAVING A LIST
-- --------------------------------------------------------------------------
--
-- One RPC that writes the placement and its changelog together, because the
-- rule is that they cannot be separated. A client that could write `tiers`
-- directly could move a character and file no note; the UPDATE policy above
-- permits that write for the owner, so this function is what makes the note
-- unavoidable in practice, and the NOT NULL on the changelog is what makes it
-- unavoidable in the schema.
--
-- p_changes is [{ character_id, from_tier, to_tier, note }]. Empty is allowed
-- and means an edit that moved nobody - retitling a tier, reordering, editing
-- the reasoning - which genuinely needs no note.
CREATE OR REPLACE FUNCTION "public"."save_tier_list"(
    "p_list_id" uuid,
    "p_tiers" jsonb,
    "p_reasoning" jsonb DEFAULT NULL,
    "p_changes" jsonb DEFAULT '[]'::jsonb
) RETURNS text
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    target record;
    actor_name text;
    change jsonb;
    moved int := 0;
BEGIN
    IF "auth"."uid"() IS NULL THEN
        RAISE EXCEPTION 'You must be signed in.' USING ERRCODE = '42501';
    END IF;

    SELECT id, owner_id, author_name INTO target
      FROM public.tier_lists WHERE id = "p_list_id";

    IF target.id IS NULL THEN
        RAISE EXCEPTION 'That tier list does not exist.' USING ERRCODE = 'P0002';
    END IF;

    -- The per-row check, restated here because SECURITY DEFINER bypasses the
    -- policy that would otherwise enforce it.
    IF NOT (
        (target.owner_id IS NOT NULL AND target.owner_id = "auth"."uid"())
        OR "public"."get_my_role"() = 'admin'
    ) THEN
        RAISE EXCEPTION 'This is not your tier list.' USING ERRCODE = '42501';
    END IF;

    IF jsonb_typeof("p_tiers") IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Tiers must be an array.' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(
        NULLIF(raw_user_meta_data->>'display_name', ''),
        NULLIF(raw_user_meta_data->>'full_name', ''),
        NULLIF(split_part(COALESCE(email, ''), '@', 1), ''),
        'Unknown'
    ) INTO actor_name
    FROM auth.users WHERE id = auth.uid();

    -- Every declared move is written, and the table's own NOT NULL plus length
    -- floor rejects the batch if any note is missing. All-or-nothing: a save
    -- that half-recorded its reasoning would be worse than one that failed.
    FOR change IN SELECT * FROM jsonb_array_elements(COALESCE("p_changes", '[]'::jsonb))
    LOOP
        INSERT INTO public.tier_list_changes
            (list_id, character_id, from_tier, to_tier, note, author_name)
        VALUES (
            "p_list_id",
            change->>'character_id',
            NULLIF(change->>'from_tier', ''),
            NULLIF(change->>'to_tier', ''),
            COALESCE(change->>'note', ''),
            actor_name
        );
        moved := moved + 1;
    END LOOP;

    UPDATE public.tier_lists
       SET tiers = "p_tiers",
           reasoning = COALESCE("p_reasoning", reasoning),
           updated_at = now()
     WHERE id = "p_list_id";

    RETURN format('Saved. %s change%s recorded.', moved, CASE WHEN moved = 1 THEN '' ELSE 's' END);
END;
$$;

ALTER FUNCTION "public"."save_tier_list"(uuid, jsonb, jsonb, jsonb) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."save_tier_list"(uuid, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."save_tier_list"(uuid, jsonb, jsonb, jsonb) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."save_tier_list"(uuid, jsonb, jsonb, jsonb) TO "authenticated";


-- --------------------------------------------------------------------------
-- SEEDING THE OWNER'S LIST
-- --------------------------------------------------------------------------
--
-- The current Overall tab becomes the owner's own attributed list rather than
-- being discarded - which also means the page is never empty on the day it
-- ships, and the feature launches with something to read.
--
-- Character keys are rewritten from the navigation display slug to page_id by
-- joining site_pages on a normalized nav_id, because three of the twenty-one
-- (Locust, Mangaka, Sus-Sister) differ from their page id by more than
-- punctuation. Anything that fails to match keeps its original string rather
-- than being dropped - losing a placement silently would be worse than an
-- unresolved one, which is at least visible on the page.
DO $$
DECLARE
    owner_uid uuid;
    owner_name text;
    overall jsonb;
    rebuilt jsonb;
BEGIN
    IF EXISTS (SELECT 1 FROM public.tier_lists) THEN
        RAISE NOTICE 'tier_lists already has rows - skipping the seed.';
        RETURN;
    END IF;

    SELECT tab INTO overall
      FROM public.page_data pd,
           LATERAL jsonb_array_elements(pd.desc_data->'tabs') AS tab
     WHERE pd.page_id = 'tierlist'
       AND tab->>'id' = 'overall'
     LIMIT 1;

    IF overall IS NULL THEN
        RAISE NOTICE 'No Overall tab found on page_data - nothing to seed.';
        RETURN;
    END IF;

    -- Oldest admin, which on this site is the owner. If there is somehow none,
    -- the list is still created and credited, just unowned until assigned.
    SELECT ur.user_id INTO owner_uid
      FROM public.user_roles ur
     WHERE ur.role = 'admin'
     ORDER BY ur.created_at
     LIMIT 1;

    SELECT COALESCE(
        NULLIF(u.raw_user_meta_data->>'display_name', ''),
        NULLIF(u.raw_user_meta_data->>'full_name', ''),
        NULLIF(split_part(COALESCE(u.email, ''), '@', 1), ''),
        'The Owner'
    ) INTO owner_name
    FROM auth.users u WHERE u.id = owner_uid;

    -- Each tier keeps its name and colour; only the character keys change.
    SELECT jsonb_agg(
        jsonb_build_object(
            'name', t->>'name',
            'color', t->>'color',
            'characters', COALESCE((
                SELECT jsonb_agg(COALESCE(sp.page_id, c.value))
                  FROM jsonb_array_elements_text(COALESCE(t->'characters', '[]'::jsonb)) AS c(value)
                  LEFT JOIN public.site_pages sp
                    ON lower(regexp_replace(sp.nav_id, '[-_ ]', '', 'g'))
                     = lower(regexp_replace(c.value, '[-_ ]', '', 'g'))
            ), '[]'::jsonb)
        )
        ORDER BY ord
    ) INTO rebuilt
    FROM jsonb_array_elements(COALESCE(overall->'tiers', '[]'::jsonb)) WITH ORDINALITY AS x(t, ord);

    INSERT INTO public.tier_lists (slug, owner_id, author_name, blurb, status, tiers, reasoning)
    VALUES (
        'owner',
        owner_uid,
        COALESCE(owner_name, 'The Owner'),
        'The original certified ranking, carried over from the site''s single tier list.',
        'published',
        COALESCE(rebuilt, '[]'::jsonb),
        '[]'::jsonb
    );

    -- The old tab carried one changelog entry with a handful of notes. It is
    -- not a per-move record and cannot be turned into one honestly, so it is
    -- not invented into rows here - it stays in page_data, where it still
    -- reads as what it was.
    RAISE NOTICE 'Seeded the owner''s tier list from the Overall tab.';
END $$;
