-- v0.14 item 4: the Free Submit Tier List.
--
-- The community's own ranking, beside the certified per-person lists. Anyone
-- eligible rates any character, and the page publishes what the community
-- actually thinks.
--
-- THE THREAT MODEL IS THE DESIGN. This site is pointed at by a 1.4M-member
-- Discord and the ranking would carry the wiki's endorsement. One message -
-- "everyone go rate this character S" - produces hundreds of votes in an
-- afternoon. So the defences are in the schema rather than in a follow-up:
--
--   1. ONE VOTE PER ACCOUNT PER CHARACTER, as a UNIQUE constraint. Not a
--      client check. Re-rating updates the existing row.
--   2. A GATE ON WHO MAY VOTE - account age OR an approved contribution.
--      Alt accounts made for a single vote are the cheapest attack, and this
--      is what makes them expensive.
--   3. MEDIAN, NOT MEAN. Owner's decision, 2026-08-13, taken before the schema
--      existed rather than after, because changing it later means recomputing
--      every published ranking. A coordinated block drags a mean immediately;
--      it does not move a median until it is more than half of everyone who
--      voted.
--   4. THE SAMPLE SIZE AND THE DISTRIBUTION ARE PUBLISHED. Both are returned
--      by the ranking RPC and neither is optional, because a ranking with no
--      vote count cannot be evaluated by a reader at all - and because a
--      successful brigade then shows up as a visibly lopsided distribution
--      rather than being laundered into a clean-looking number.
--   5. RATE LIMITING, so a script cannot submit faster than people can.
--
-- None of these stop a determined brigade outright. Together they make it
-- expensive, visible, and much less rewarding.
--
-- WHY THE MEDIAN FORCES THIS SHAPE. A median cannot be computed from a running
-- total the way a mean can - it needs every individual vote kept. So votes are
-- stored per person and the ranking is derived, which is what the UNIQUE row
-- already implies. That also makes the distribution free: once the individual
-- votes exist, showing the spread is a query rather than a schema change.
--
-- RAW VOTES ARE NOT PUBLIC. Only the voter and admins can read individual
-- rows. "You rated my main F" is a harassment vector, and the aggregate is the
-- entire point of the feature - nothing legitimate needs the per-person data.

-- --------------------------------------------------------------------------
-- THE SCALE
-- --------------------------------------------------------------------------
--
-- A lookup table rather than a CHECK on a hardcoded array, because a median
-- needs an ORDER and a text column has none. `rank` is that order, and it is
-- what percentile_disc sorts by below.
--
-- Seeded with the exact six tiers and colours the owner's own certified list
-- uses, read from production on 2026-08-14. Deliberately the same vocabulary:
-- a community ranking that disagrees with a named one is interesting, and a
-- community ranking measured on a different scale is not comparable at all.
CREATE TABLE IF NOT EXISTS "public"."free_submit_tiers" (
    "tier" text NOT NULL,
    -- Higher is better. The gap between values is meaningless - this is an
    -- ordinal scale, which is exactly why the aggregate is a median.
    "rank" integer NOT NULL,
    "color" text NOT NULL,
    CONSTRAINT "free_submit_tiers_pkey" PRIMARY KEY ("tier"),
    CONSTRAINT "free_submit_tiers_rank_key" UNIQUE ("rank")
);

ALTER TABLE "public"."free_submit_tiers" OWNER TO "postgres";
ALTER TABLE "public"."free_submit_tiers" ENABLE ROW LEVEL SECURITY;

INSERT INTO "public"."free_submit_tiers" ("tier", "rank", "color") VALUES
    ('S', 6, 'hsl(0, 80%, 60%)'),
    ('A', 5, 'hsl(30, 80%, 60%)'),
    ('B', 4, 'hsl(60, 80%, 60%)'),
    ('C', 3, 'hsl(120, 60%, 60%)'),
    ('D', 2, 'hsl(210, 80%, 60%)'),
    ('F', 1, 'hsl(300, 80%, 60%)')
ON CONFLICT ("tier") DO NOTHING;

CREATE POLICY "Anyone can read the tier scale" ON "public"."free_submit_tiers"
    FOR SELECT USING (true);

GRANT SELECT ON TABLE "public"."free_submit_tiers" TO "anon";
GRANT SELECT ON TABLE "public"."free_submit_tiers" TO "authenticated";


-- --------------------------------------------------------------------------
-- THE KNOBS
-- --------------------------------------------------------------------------
--
-- On tier_page_settings rather than in a second singleton, which is what the
-- previous migration said this table was for: "the next thing this page needs
-- configuring (whether Free Submit is open, say) belongs beside it".
--
-- These are settings and not constants because the failure they guard against
-- arrives without warning. When a brigade is under way, the useful response is
-- to close voting or raise the age floor within a minute from the owner tools,
-- not to write a migration and wait for a release.
ALTER TABLE "public"."tier_page_settings"
    -- The emergency stop. Closing hides the ballot and refuses the write; the
    -- existing ranking stays readable, because deleting the community's answer
    -- is a much larger act than pausing new ones.
    ADD COLUMN IF NOT EXISTS "free_submit_open" boolean NOT NULL DEFAULT true,
    -- The gate, satisfied by EITHER of the next two. An established reader who
    -- has never edited still gets a say; a brand-new account that has had an
    -- edit approved has already been vouched for by a human.
    ADD COLUMN IF NOT EXISTS "free_submit_min_age_days" integer NOT NULL DEFAULT 7,
    ADD COLUMN IF NOT EXISTS "free_submit_min_contributions" integer NOT NULL DEFAULT 1,
    -- Below this a character is returned with its votes but flagged unranked,
    -- so the page can say "12 votes so far" instead of presenting three
    -- people's opinion as the community's.
    ADD COLUMN IF NOT EXISTS "free_submit_min_votes" integer NOT NULL DEFAULT 10;

COMMENT ON COLUMN "public"."tier_page_settings"."free_submit_open" IS
    'The emergency stop for the community ranking. False hides the ballot and refuses new votes; the published ranking stays readable.';


-- --------------------------------------------------------------------------
-- THE VOTES
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."free_submit_votes" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,

    -- NOT NULL and ON DELETE CASCADE, which is the opposite of every other
    -- authored table here - and deliberately so. Elsewhere the column is
    -- nullable because anonymize_user_by_email hard-deletes the auth.users row
    -- and the CONTENT should outlive the account. A vote is not content: it is
    -- one account's say. Left behind as NULL it would be unupdatable by
    -- anybody, would inflate the sample with a ghost, and - because NULLs are
    -- never equal in a UNIQUE index - would stop enforcing one vote per
    -- person the moment two accounts were deleted.
    "user_id" uuid NOT NULL,

    -- page_id, the key the rest of this site uses. NOT a foreign key to
    -- site_pages, for the same reason page_discussions.page_id is not: owner
    -- tools archive and recreate those rows, and a cascade silently deleting
    -- the community's ranking during a page rebuild would be a disaster with
    -- no error message. Validated at write time instead.
    "character_id" text NOT NULL,

    "tier" text NOT NULL,

    "created_at" timestamptz NOT NULL DEFAULT now(),
    -- Doubles as the rate-limit clock: the caller's most recent updated_at is
    -- when they last submitted a ballot.
    "updated_at" timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT "free_submit_votes_pkey" PRIMARY KEY ("id"),
    -- The single most important line in this migration. One vote per account
    -- per character, enforced by Postgres, so re-rating updates rather than
    -- stacks and no client bug or crafted request can produce a second.
    CONSTRAINT "free_submit_votes_one_per_person" UNIQUE ("user_id", "character_id"),
    CONSTRAINT "free_submit_votes_user_fkey" FOREIGN KEY ("user_id")
        REFERENCES "auth"."users"("id") ON DELETE CASCADE,
    CONSTRAINT "free_submit_votes_tier_fkey" FOREIGN KEY ("tier")
        REFERENCES "public"."free_submit_tiers"("tier")
);

ALTER TABLE "public"."free_submit_votes" OWNER TO "postgres";
ALTER TABLE "public"."free_submit_votes" ENABLE ROW LEVEL SECURITY;

-- The aggregate scans by character; the ballot loads by voter.
CREATE INDEX IF NOT EXISTS "free_submit_votes_character_idx"
    ON "public"."free_submit_votes" ("character_id");
CREATE INDEX IF NOT EXISTS "free_submit_votes_voter_idx"
    ON "public"."free_submit_votes" ("user_id");


-- --------------------------------------------------------------------------
-- POLICIES
-- --------------------------------------------------------------------------
--
-- Note what is absent: there is no INSERT or UPDATE policy and no INSERT or
-- UPDATE grant for anyone. Every write goes through submit_tier_votes below,
-- which is what makes the eligibility gate and the rate limit unskippable
-- rather than advisory. A policy could express "this row is mine"; it cannot
-- express "this account is old enough", which needs auth.users.

CREATE POLICY "Voters read their own votes" ON "public"."free_submit_votes"
    FOR SELECT TO "authenticated"
    USING ("user_id" = "auth"."uid"() OR "public"."get_my_role"() = 'admin');

-- Withdrawing is direct, and works even when voting is closed. Taking your
-- opinion back should never be harder than giving it.
CREATE POLICY "Voters withdraw their own votes" ON "public"."free_submit_votes"
    FOR DELETE TO "authenticated"
    USING ("user_id" = "auth"."uid"() OR "public"."get_my_role"() = 'admin');

-- Paired with the policies, because a missing grant returns 401 before RLS is
-- consulted and this project has been bitten by that twice. anon gets nothing
-- here at all: the public reads the aggregate, never the rows.
GRANT SELECT, DELETE ON TABLE "public"."free_submit_votes" TO "authenticated";


-- --------------------------------------------------------------------------
-- MAY I VOTE?
-- --------------------------------------------------------------------------
--
-- Asked BEFORE the ballot renders, not at submit time. A gate discovered after
-- somebody has rated twenty-two characters is a hostile way to enforce a rule
-- that is perfectly reasonable to state up front.
--
-- SECURITY DEFINER because it reads auth.users.created_at and counts rows in
-- pending_revisions, neither of which an ordinary caller can see. It returns
-- only facts about the caller themselves.
CREATE OR REPLACE FUNCTION "public"."free_submit_eligibility"()
RETURNS TABLE (
    "eligible" boolean,
    "reason" text,
    "voting_open" boolean,
    "account_age_days" integer,
    "contributions" integer,
    "votes_cast" integer,
    "min_votes_to_rank" integer
)
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    uid uuid := auth.uid();
    s_open boolean;
    s_age integer;
    s_contrib integer;
    s_min_votes integer;
    age_days integer := 0;
    contribs integer := 0;
    cast_count integer := 0;
    my_role text;
BEGIN
    -- Read into scalars with a COALESCE each, rather than into a record whose
    -- fields are all NULL when the singleton is missing. A NULL there would
    -- make every comparison below NULL, and an IF on NULL does not fire - so
    -- the missing-settings case would fail OPEN and let anybody vote.
    SELECT COALESCE(free_submit_open, true),
           COALESCE(free_submit_min_age_days, 7),
           COALESCE(free_submit_min_contributions, 1),
           COALESCE(free_submit_min_votes, 10)
      INTO s_open, s_age, s_contrib, s_min_votes
      FROM public.tier_page_settings WHERE id = true;

    s_open := COALESCE(s_open, true);
    s_age := COALESCE(s_age, 7);
    s_contrib := COALESCE(s_contrib, 1);
    s_min_votes := COALESCE(s_min_votes, 10);

    IF uid IS NULL THEN
        RETURN QUERY SELECT false, 'Sign in to rate characters.'::text,
            s_open, 0, 0, 0, s_min_votes;
        RETURN;
    END IF;

    -- Date subtraction, not EXTRACT on an interval: whole days is the unit the
    -- rule is written in, and this cannot disagree with itself about whether a
    -- month is thirty days.
    SELECT GREATEST(0, (now()::date - u.created_at::date))
      INTO age_days FROM auth.users u WHERE u.id = uid;

    SELECT COUNT(*)::integer INTO contribs
      FROM public.pending_revisions
     WHERE author_id = uid AND status = 'approved';

    SELECT COUNT(*)::integer INTO cast_count
      FROM public.free_submit_votes WHERE user_id = uid;

    my_role := public.get_my_role();

    -- viewer is this site's soft ban - signed in, can read, cannot submit.
    -- Handing a banned account a vote in the community ranking would make the
    -- ban decorative.
    IF my_role IS NOT DISTINCT FROM 'viewer' THEN
        RETURN QUERY SELECT false, 'Your account cannot submit to the wiki.'::text,
            s_open, age_days, contribs, cast_count, s_min_votes;
        RETURN;
    END IF;

    IF NOT s_open THEN
        RETURN QUERY SELECT false, 'Voting is closed right now.'::text,
            false, age_days, contribs, cast_count, s_min_votes;
        RETURN;
    END IF;

    IF age_days < s_age AND contribs < s_contrib THEN
        RETURN QUERY SELECT false, format(
            'Voting opens once your account is %s days old, or as soon as one of your edits is approved.',
            s_age
        ), true, age_days, contribs, cast_count, s_min_votes;
        RETURN;
    END IF;

    RETURN QUERY SELECT true, NULL::text, true, age_days, contribs, cast_count,
        s_min_votes;
END;
$$;

ALTER FUNCTION "public"."free_submit_eligibility"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."free_submit_eligibility"() FROM PUBLIC;
-- anon may ask, and is told to sign in. Refusing the question outright would
-- mean a signed-out reader cannot be shown why the ballot is not there.
GRANT EXECUTE ON FUNCTION "public"."free_submit_eligibility"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."free_submit_eligibility"() TO "authenticated";


-- --------------------------------------------------------------------------
-- CASTING A BALLOT
-- --------------------------------------------------------------------------
--
-- p_votes is [{ character_id, tier }]. A PARTIAL BALLOT IS THE NORMAL CASE:
-- rating only the characters you have an opinion about is more honest than
-- filling in twenty-two, and forcing completeness would guarantee noise on the
-- ones a voter has never played.
--
-- The whole ballot is one statement, so it is all-or-nothing: a submission
-- that half-recorded somebody's opinion would be worse than one that failed
-- and said so.
CREATE OR REPLACE FUNCTION "public"."submit_tier_votes"("p_votes" jsonb)
RETURNS text
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    uid uuid := auth.uid();
    gate record;
    entry jsonb;
    char_id text;
    tier_name text;
    last_cast timestamptz;
    written integer := 0;
BEGIN
    IF uid IS NULL THEN
        RAISE EXCEPTION 'You must be signed in to vote.' USING ERRCODE = '42501';
    END IF;

    -- The same gate the UI asked about, re-checked here. The UI's copy is a
    -- courtesy; this is the enforcement, and it is why there is no INSERT
    -- grant on the table.
    SELECT * INTO gate FROM public.free_submit_eligibility();
    IF NOT gate.eligible THEN
        RAISE EXCEPTION '%', COALESCE(gate.reason, 'You cannot vote yet.')
            USING ERRCODE = '42501';
    END IF;

    IF jsonb_typeof("p_votes") IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Votes must be an array.' USING ERRCODE = '22023';
    END IF;

    -- Generous next to a 22-character roster. It is here so a crafted request
    -- cannot hand the loop below a million elements.
    IF jsonb_array_length("p_votes") > 100 THEN
        RAISE EXCEPTION 'That is more votes than there are characters.'
            USING ERRCODE = '22023';
    END IF;

    IF jsonb_array_length("p_votes") = 0 THEN
        RETURN 'Nothing to save.';
    END IF;

    -- Rate limit. Deliberately modest: this stops a script, not a brigade -
    -- a brigade's constraint is accounts, not speed, and that is what the
    -- eligibility gate is for.
    SELECT MAX(updated_at) INTO last_cast
      FROM public.free_submit_votes WHERE user_id = uid;

    IF last_cast IS NOT NULL AND last_cast > (now() - INTERVAL '20 seconds') THEN
        RAISE EXCEPTION 'Slow down - you can save your ratings once every 20 seconds.'
            USING ERRCODE = '53400';
    END IF;

    FOR entry IN SELECT * FROM jsonb_array_elements("p_votes")
    LOOP
        char_id := entry->>'character_id';
        tier_name := entry->>'tier';

        -- Validated against the live roster rather than trusted. Without this
        -- a crafted request could file votes against arbitrary strings, and
        -- the aggregate would carry rows for characters that do not exist.
        IF NOT EXISTS (
            SELECT 1 FROM public.site_pages
             WHERE page_id = char_id AND page_type = 'character' AND status = 'live'
        ) THEN
            RAISE EXCEPTION 'No such character: %', COALESCE(char_id, '(none)')
                USING ERRCODE = 'P0002';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM public.free_submit_tiers WHERE tier = tier_name) THEN
            RAISE EXCEPTION 'No such tier: %', COALESCE(tier_name, '(none)')
                USING ERRCODE = '22023';
        END IF;

        INSERT INTO public.free_submit_votes (user_id, character_id, tier)
        VALUES (uid, char_id, tier_name)
        ON CONFLICT ("user_id", "character_id")
        DO UPDATE SET tier = EXCLUDED.tier, updated_at = now();

        written := written + 1;
    END LOOP;

    RETURN format('Saved %s rating%s.', written, CASE WHEN written = 1 THEN '' ELSE 's' END);
END;
$$;

ALTER FUNCTION "public"."submit_tier_votes"(jsonb) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."submit_tier_votes"(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."submit_tier_votes"(jsonb) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."submit_tier_votes"(jsonb) TO "authenticated";


-- --------------------------------------------------------------------------
-- THE RANKING
-- --------------------------------------------------------------------------
--
-- Two medians, and they are doing different jobs.
--
--   percentile_disc(0.5) returns an ACTUAL OBSERVED VALUE - a tier somebody
--   really voted. That is what a character is placed in. An interpolated
--   result would invent a "B+" that is on nobody's ballot and on no scale this
--   site uses.
--
--   percentile_cont(0.5) interpolates, and is used ONLY to order characters
--   within the tier they landed in. Without it a tier is an unordered heap;
--   with a mean instead of it, the ordering would reintroduce exactly the
--   sensitivity to extreme votes that choosing a median was meant to remove.
--   Both numbers are medians, so shifting either still takes more than half
--   the electorate.
--
-- SECURITY DEFINER because the underlying rows are readable only by their own
-- voter. It returns counts and no identities, which is the whole distinction:
-- the community's answer is public, who gave which answer is not.
CREATE OR REPLACE FUNCTION "public"."get_free_submit_rankings"()
RETURNS TABLE (
    "character_id" text,
    "vote_count" integer,
    "median_tier" text,
    "median_rank" numeric,
    "distribution" jsonb,
    "ranked" boolean
)
LANGUAGE "sql" SECURITY DEFINER
STABLE
SET "search_path" TO 'public'
AS $$
    WITH floor_votes AS (
        SELECT COALESCE(
            (SELECT free_submit_min_votes FROM public.tier_page_settings WHERE id = true),
            10
        ) AS n
    ),
    counted AS (
        SELECT v.character_id, v.tier, t.rank
          FROM public.free_submit_votes v
          JOIN public.free_submit_tiers t ON t.tier = v.tier
    ),
    agg AS (
        SELECT c.character_id,
               COUNT(*)::integer AS vote_count,
               (percentile_disc(0.5) WITHIN GROUP (ORDER BY c.rank))::integer AS disc_rank,
               (percentile_cont(0.5) WITHIN GROUP (ORDER BY c.rank))::numeric AS cont_rank
          FROM counted c
         GROUP BY c.character_id
    ),
    dist AS (
        SELECT b.character_id, jsonb_object_agg(b.tier, b.n) AS distribution
          FROM (
              SELECT c.character_id, c.tier, COUNT(*)::integer AS n
                FROM counted c GROUP BY c.character_id, c.tier
          ) b
         GROUP BY b.character_id
    )
    SELECT a.character_id,
           a.vote_count,
           t.tier,
           a.cont_rank,
           COALESCE(d.distribution, '{}'::jsonb),
           a.vote_count >= f.n
      FROM agg a
      CROSS JOIN floor_votes f
      LEFT JOIN dist d ON d.character_id = a.character_id
      LEFT JOIN public.free_submit_tiers t ON t.rank = a.disc_rank
     ORDER BY a.cont_rank DESC, a.vote_count DESC, a.character_id;
$$;

ALTER FUNCTION "public"."get_free_submit_rankings"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."get_free_submit_rankings"() FROM PUBLIC;
-- The ranking is the page. Anonymous readers are the audience for it.
GRANT EXECUTE ON FUNCTION "public"."get_free_submit_rankings"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."get_free_submit_rankings"() TO "authenticated";
