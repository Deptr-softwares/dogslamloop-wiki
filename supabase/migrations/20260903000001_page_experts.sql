-- v0.17 F5: the expert system.
--
-- The owner, 2026-08-25: "experts of each character can get to go in and review
-- submission regarding only their characters that they are qualified at (Can be
-- many). We have moderators not tied to a set role already, maybe something like
-- that?"
--
-- Yes, and the precedent is can_moderate (20260813000001): a capability, never a
-- second role. user_roles has UNIQUE(user_id) deliberately - two rows once broke
-- get_my_role() with "more than one row returned by a subquery", which broke
-- that user's access to everything.
--
-- WHY THIS ONE IS A TABLE AND NOT A COLUMN
--
-- The two existing capabilities (bypass_cooldown, can_moderate) are scalars: you
-- either may moderate or you may not. This one is scoped TO A THING, and a
-- scalar cannot express a relationship. Three reasons, in order of weight:
--
--   1. It dissolves the CHECK problem. user_roles.role is NOT NULL, so a
--      capability column can only be granted to somebody who already holds a
--      role - set_user_capability says so outright: "Deliberately cannot create
--      a row. A capability is an extra on top of a role." An expert who is
--      simply a knowledgeable player holds no role, and there is no value that
--      column could take for them. Its own table has nothing to default to.
--   2. Referential integrity. page_id is owner-editable; a text[] of ids rots
--      silently when a page is renamed and a foreign key cannot.
--   3. The badge needs the reverse query. "Who are the experts of Crow Charmer"
--      is an index scan here and an array scan on a column.
--
-- Do not "correct" this back into a column later.

CREATE TABLE IF NOT EXISTS "public"."page_experts" (
    "user_id" uuid NOT NULL,
    "page_id" text NOT NULL,
    "granted_at" timestamptz NOT NULL DEFAULT now(),
    "granted_by" uuid,
    CONSTRAINT "page_experts_pkey" PRIMARY KEY ("user_id", "page_id"),
    -- CASCADE, and it is load-bearing. anonymize_user_by_email hard-deletes the
    -- auth.users row; pending_revisions.author_id has no ON DELETE clause and
    -- already raises a constraint violation for a contributor. This must not
    -- become another thing blocking account deletion. (user_profiles is the
    -- other table that had to learn this.)
    CONSTRAINT "page_experts_user_fkey" FOREIGN KEY ("user_id")
        REFERENCES "auth"."users"("id") ON DELETE CASCADE,
    -- site_pages.page_id is already the primary key (20260808000003:47), so this
    -- costs nothing and is the whole of reason 2 above.
    CONSTRAINT "page_experts_page_fkey" FOREIGN KEY ("page_id")
        REFERENCES "public"."site_pages"("page_id") ON DELETE CASCADE,
    -- SET NULL rather than CASCADE: who granted it is an audit note, and losing
    -- the grantor's account must not silently revoke somebody's expertise.
    CONSTRAINT "page_experts_granted_by_fkey" FOREIGN KEY ("granted_by")
        REFERENCES "auth"."users"("id") ON DELETE SET NULL
);

COMMENT ON TABLE "public"."page_experts" IS
    'Per-page review rights. A capability scoped to a page, not a role: the holder may need no role at all. Assigned from the owner tools.';

-- "Who else is an expert of this page" is the badge query and runs for every
-- reader; it is answered by get_page_experts() below rather than by a policy,
-- so the index is what makes that cheap.
CREATE INDEX IF NOT EXISTS "page_experts_page_idx" ON "public"."page_experts" ("page_id");

ALTER TABLE "public"."page_experts" ENABLE ROW LEVEL SECURITY;

-- Self-read only. The queue page needs to know which pages ARE yours so it can
-- label them; everything public goes through get_page_experts(), and everything
-- that decides access goes through can_review_page(). No write policy at all -
-- granting expertise is an owner action and travels through the RPCs below,
-- which is the same shape assign_role_by_email has for roles.
CREATE POLICY "Users can read own expertise" ON "public"."page_experts"
    FOR SELECT TO "authenticated"
    USING ("auth"."uid"() = "user_id");

GRANT SELECT ON TABLE "public"."page_experts" TO "authenticated";

-- --------------------------------------------------------------------------
-- can_review_page - the ladder, extended sideways
-- --------------------------------------------------------------------------
--
-- Built on is_staff() rather than a fourth independent list of role names. v0.16
-- bug 6 existed precisely because every perk tested a literal.
--
-- SECURITY DEFINER because it reads page_experts, whose only policy is
-- self-read; a plain function would see nothing and every expert would be
-- refused.
CREATE OR REPLACE FUNCTION "public"."can_review_page"("target_page_id" "text")
RETURNS boolean
LANGUAGE "sql" STABLE SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
    SELECT "public"."is_staff"()
        OR EXISTS (
            SELECT 1 FROM "public"."page_experts" pe
            WHERE pe."user_id" = "auth"."uid"()
              AND pe."page_id" = "target_page_id"
        );
$$;

ALTER FUNCTION "public"."can_review_page"("text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."can_review_page"("text") FROM PUBLIC;
-- anon is REQUIRED, not optional. Both queue policies below are written without
-- a TO clause, so Postgres evaluates them for every role including anon, and a
-- visitor who cannot execute this gets an error instead of a refusal. This is
-- exactly the regression that broke the Certified Tier List for logged-out
-- readers in v0.17 pass 1 (20260827000002), and it is why is_staff() carries an
-- anon grant too. It returns false for anon rather than leaking anything:
-- auth.uid() is NULL and is_staff() is false.
GRANT EXECUTE ON FUNCTION "public"."can_review_page"("text") TO "anon";
GRANT EXECUTE ON FUNCTION "public"."can_review_page"("text") TO "authenticated";

-- --------------------------------------------------------------------------
-- THE TWO QUEUE POLICIES - the highest-risk change in this version
-- --------------------------------------------------------------------------
--
-- Both were page-blind: is_staff() alone, from 20260827000001. Scoping them to
-- the page is what makes an expert an expert.
--
-- Too loose and an expert gets the whole queue; too tight and reviewers lose it.
-- can_review_page() short-circuits on is_staff(), so staff keep exactly what
-- they had and the EXISTS is only reached for somebody who is not staff.
--
-- "Staff can manage queue" has NO `FOR` clause, so it is FOR ALL - the write
-- gate as well as the read one. A FOR ALL policy with only USING uses that same
-- expression as its WITH CHECK, so an expert may also insert and update rows for
-- their own page, which is the intent.
--
-- The names are kept. Renaming them to say "expert" would orphan the DROP
-- statements in 20260827000001 and leave the old policies standing beside the
-- new ones - two policies on one table are ORed, so the page-blind version
-- would silently win and the scoping would do nothing at all.
DROP POLICY IF EXISTS "Staff can manage queue" ON "public"."pending_revisions";

CREATE POLICY "Staff can manage queue" ON "public"."pending_revisions"
    USING ("public"."can_review_page"("page_id"));

DROP POLICY IF EXISTS "Staff can view queue" ON "public"."pending_revisions";

CREATE POLICY "Staff can view queue" ON "public"."pending_revisions"
    FOR SELECT USING ("public"."can_review_page"("page_id"));

-- --------------------------------------------------------------------------
-- ASSIGNING AN EXPERT - owner only
-- --------------------------------------------------------------------------
--
-- On owner.html, not admin.html, and that follows the owner's own rule
-- (2026-08-27): which page a tool lives on decides who owns it. Personnel and
-- capabilities are owner tools, and granting somebody review rights over a page
-- is a personnel decision, not a queue action.
--
-- By email, matching assign_role_by_email: it is the only handle the owner has
-- for a person who may hold no role and therefore appear in no roster.
CREATE OR REPLACE FUNCTION "public"."assign_page_expert"(
    "target_email" "text",
    "target_page_id" "text"
) RETURNS "text"
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    target_user_id uuid;
BEGIN
    IF NOT "public"."is_owner"() THEN
        RAISE EXCEPTION 'Permission denied: only the owner may assign an expert.'
            USING ERRCODE = '42501';
    END IF;

    SELECT id INTO target_user_id FROM auth.users WHERE email = target_email;
    IF target_user_id IS NULL THEN
        RETURN 'Error: User with this email not found.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.site_pages sp WHERE sp.page_id = target_page_id) THEN
        RETURN 'Error: No page with that id.';
    END IF;

    -- Idempotent. Re-assigning refreshes who granted it rather than failing on
    -- the primary key, because the owner tool has no way to know what is
    -- already there without asking.
    INSERT INTO public.page_experts (user_id, page_id, granted_by)
    VALUES (target_user_id, target_page_id, auth.uid())
    ON CONFLICT (user_id, page_id)
    DO UPDATE SET granted_by = EXCLUDED.granted_by, granted_at = now();

    RETURN 'Successfully made ' || target_email || ' an expert of ' || target_page_id;
END;
$$;

ALTER FUNCTION "public"."assign_page_expert"("text", "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."assign_page_expert"("text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."assign_page_expert"("text", "text") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."assign_page_expert"("text", "text") TO "authenticated";

CREATE OR REPLACE FUNCTION "public"."revoke_page_expert"(
    "target_email" "text",
    "target_page_id" "text"
) RETURNS "text"
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
DECLARE
    target_user_id uuid;
BEGIN
    IF NOT "public"."is_owner"() THEN
        RAISE EXCEPTION 'Permission denied: only the owner may revoke an expert.'
            USING ERRCODE = '42501';
    END IF;

    SELECT id INTO target_user_id FROM auth.users WHERE email = target_email;
    IF target_user_id IS NULL THEN
        RETURN 'Error: User with this email not found.';
    END IF;

    DELETE FROM public.page_experts
     WHERE user_id = target_user_id AND page_id = target_page_id;

    IF NOT FOUND THEN
        RETURN 'Nothing to revoke: ' || target_email || ' was not an expert of ' || target_page_id;
    END IF;

    RETURN 'Revoked ' || target_email || ' as an expert of ' || target_page_id;
END;
$$;

ALTER FUNCTION "public"."revoke_page_expert"("text", "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."revoke_page_expert"("text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."revoke_page_expert"("text", "text") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."revoke_page_expert"("text", "text") TO "authenticated";

-- The roster behind the owner tool. Same wall list_personnel() hit: page_experts
-- is self-read only and auth.users is not reachable through PostgREST, so no
-- client can enumerate this without a definer function.
CREATE OR REPLACE FUNCTION "public"."list_page_experts"()
RETURNS TABLE (
    "user_id" uuid,
    "email" "text",
    "page_id" "text",
    "granted_at" timestamptz
)
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
BEGIN
    -- Returns email addresses, so the guard comes before the read and is not
    -- left to the EXECUTE grant alone.
    IF NOT "public"."is_owner"() THEN
        RAISE EXCEPTION 'Permission denied: only the owner may list experts.'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT pe."user_id", au."email"::text, pe."page_id", pe."granted_at"
    FROM "public"."page_experts" pe
    JOIN "auth"."users" au ON au."id" = pe."user_id"
    ORDER BY pe."page_id", au."email";
END;
$$;

ALTER FUNCTION "public"."list_page_experts"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."list_page_experts"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."list_page_experts"() FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."list_page_experts"() TO "authenticated";

-- --------------------------------------------------------------------------
-- THE BADGE - who are the experts of this page
-- --------------------------------------------------------------------------
--
-- Public, because the badge is (owner, 2026-08-24: a visible badge, not only a
-- queue permission). Returns display names, never emails - list_page_experts()
-- above is the one that returns an address and it is owner-gated for that
-- reason.
--
-- The name is resolved the same way get_public_profile() resolves it, including
-- the deliberate fall back to 'Anonymous' rather than to the email prefix.
CREATE OR REPLACE FUNCTION "public"."get_page_experts"("target_page_id" "text")
RETURNS TABLE (
    "user_id" uuid,
    "display_name" "text",
    "flair" "text"
)
LANGUAGE "sql" STABLE SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
    SELECT
        au."id",
        COALESCE(
            NULLIF(au."raw_user_meta_data"->>'display_name', ''),
            NULLIF(au."raw_user_meta_data"->>'full_name', ''),
            NULLIF(au."raw_user_meta_data"->'custom_claims'->>'global_name', ''),
            NULLIF(au."raw_user_meta_data"->>'user_name', ''),
            'Anonymous'
        )::text,
        up."flair"
    FROM "public"."page_experts" pe
    JOIN "auth"."users" au ON au."id" = pe."user_id"
    LEFT JOIN "public"."user_profiles" up ON up."user_id" = pe."user_id"
    WHERE pe."page_id" = "target_page_id"
    ORDER BY 2;
$$;

ALTER FUNCTION "public"."get_page_experts"("text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."get_page_experts"("text") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."get_page_experts"("text") TO "anon";
GRANT EXECUTE ON FUNCTION "public"."get_page_experts"("text") TO "authenticated";

-- The other direction: which pages is THIS PERSON an expert of.
--
-- The owner chose (2026-09-03) to show the badge on the person rather than on
-- the page - in their profile, and beside their name in a thread on a page they
-- cover. get_page_experts() above answers the thread half, because a thread
-- already knows its page_id; this answers the profile half, where the page is
-- what is unknown.
--
-- Returns the page's NAME as well as its id, because "Expert of crow_charmer"
-- is not what the page is called anywhere a reader has seen it. COALESCE so a
-- row whose page has no name still says something rather than vanishing.
CREATE OR REPLACE FUNCTION "public"."get_user_expert_pages"("target_user_id" uuid)
RETURNS TABLE (
    "page_id" "text",
    "page_name" "text"
)
LANGUAGE "sql" STABLE SECURITY DEFINER
SET "search_path" TO 'public'
AS $$
    SELECT pe."page_id", COALESCE(NULLIF(sp."name", ''), pe."page_id")::text
    FROM "public"."page_experts" pe
    LEFT JOIN "public"."site_pages" sp ON sp."page_id" = pe."page_id"
    WHERE pe."user_id" = "target_user_id"
    ORDER BY 2;
$$;

ALTER FUNCTION "public"."get_user_expert_pages"(uuid) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."get_user_expert_pages"(uuid) FROM PUBLIC;
-- Public, like the profile it appears in. Returns page names and nothing about
-- the person, so there is no address to leak here.
GRANT EXECUTE ON FUNCTION "public"."get_user_expert_pages"(uuid) TO "anon";
GRANT EXECUTE ON FUNCTION "public"."get_user_expert_pages"(uuid) TO "authenticated";
