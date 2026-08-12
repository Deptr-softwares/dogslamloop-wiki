-- Rename two matchup tiers: "Unwinnable" -> "Hopeless", and "Unloseable" ->
-- "Dominating". Owner's reasoning: the old words are absolutist, and claim a
-- result rather than a difficulty.
--
-- Why a rename needs a migration at all: the tier string IS the stored value.
-- js/site_utils.js colours a matchup by looking that exact string up in
-- window.MATCHUP_TIERS, and an unrecognised tier falls back to white with
-- whatever word is stored still printed on the page. Renaming in the code
-- alone would leave 32 live matchups un-coloured and still reading
-- "Unwinnable".
--
-- Measured against production immediately before writing this:
--
--   page_data           380 matchups across 30 pages
--                       18 "Unwinnable", 14 "Unloseable"
--   pending_revisions   72 rows carry one of the two words
--
-- Only page_data is rewritten. page_history and pending_revisions are records
-- of what a contributor submitted and a reviewer approved - editing them to
-- say something else falsifies that record, and page_history is the audit
-- trail the whole review workflow rests on. They keep rendering correctly
-- because window.MATCHUP_TIER_ALIASES maps both old words permanently.
--
-- That alias is not a transitional measure and must not be deleted when this
-- migration looks old. History replay will keep producing the old words for
-- as long as the history exists.
--
-- One entry is deliberately left alone: salaryman vs Crow Charmer has the
-- tier "Aerial Circling tier", which was never an option and is not a
-- difficulty rating. Rewriting it to a real tier would invent a claim about
-- that matchup. It stays as it is, and the editor now offers it as its own
-- selected option so somebody who knows the matchup can correct it.
--
-- No schema, policy, grant or function changes here - this is a data rewrite
-- of one jsonb field, so the RLS and grant checklist does not apply.

-- Top level: desc_data.matchups. This is the one that changes today.
--
-- WITH ORDINALITY and the ORDER BY are load-bearing: jsonb_agg has no defined
-- order without them, and matchup order is the display order on the page.
UPDATE "public"."page_data"
SET "desc_data" = "jsonb_set"(
    "desc_data",
    '{matchups}',
    (
        SELECT "jsonb_agg"(
            CASE
                WHEN "mu"->>'tier' = 'Unwinnable' THEN "jsonb_set"("mu", '{tier}', '"Hopeless"')
                WHEN "mu"->>'tier' = 'Unloseable' THEN "jsonb_set"("mu", '{tier}', '"Dominating"')
                ELSE "mu"
            END
            ORDER BY "ord"
        )
        FROM "jsonb_array_elements"("desc_data"->'matchups') WITH ORDINALITY AS "t"("mu", "ord")
    )
)
WHERE "jsonb_typeof"("desc_data"->'matchups') = 'array'
  AND EXISTS (
      SELECT 1
      FROM "jsonb_array_elements"("desc_data"->'matchups') AS "e"
      WHERE "e"->>'tier' IN ('Unwinnable', 'Unloseable')
  );

-- Per-mode matchups (desc_data.modeData.<modeId>.matchups, from v0.12's
-- character states) are deliberately NOT rewritten here.
--
-- No live page has any: honored_one is the only page declaring a mode and its
-- matchups array is empty, checked against production. An earlier draft of
-- this migration walked them anyway with a PL/pgSQL loop, which was removed -
-- it matched nothing, could not be run against a real Postgres before merge,
-- and migrations here apply straight to production on merge. Untestable SQL
-- that provably does nothing is a worse trade than the one statement above.
--
-- Nothing depends on it either way. After this ships the editor only offers
-- the new words, so the sole route by which an old word can enter new data is
-- approving a revision submitted before the rename - which this migration
-- could not have caught regardless, and which the permanent alias renders
-- correctly.
