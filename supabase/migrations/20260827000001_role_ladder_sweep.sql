-- v0.17 F12, PASS 1 of 2: every literal role list, rewritten against the ladder.
--
-- THIS MIGRATION CHANGES NO BEHAVIOUR. That is the point of doing it on its own.
-- `role_rank('reviewer')` is 3 and the only roles at or above it today are
-- reviewer and admin, so `role_rank(get_my_role()) >= role_rank('reviewer')` is
-- exactly `get_my_role() = ANY (ARRAY['admin','reviewer'])`. Every rewrite below
-- is that substitution and nothing else.
--
-- WHY IT HAS TO COME FIRST. Pass 2 renames what `admin` means: the owner takes
-- an `owner` role and `admin` becomes a queue-working role beneath it. At that
-- moment every literal `ARRAY['admin','reviewer']` in this schema silently
-- changes meaning - it would stop naming the site owner and start naming the new
-- junior role. There were 18 such literals across 10 migrations. Renaming while
-- they exist means touching every one of them in the same migration as the
-- rename, against a live database, where a single miss is a privilege change
-- nobody can see.
--
-- Done in this order instead: sweep now, while `admin` still means what it has
-- always meant and the change is provably a no-op; rename next, by which point
-- these sites need no further edit at all.
--
-- This is also what v0.16 bug 6 was, generalised. A reviewer never received the
-- Trusted Editor perks because every perk tested a literal, so a decision made
-- once reached exactly one of the three places that needed it.
--
-- WHAT IS DELIBERATELY NOT SWEPT
--
--   "Staff can moderate discussions" on page_discussions. It LOOKS like the
--   twelfth site and it is not a site at all: 20260813000001 DROPPED it and
--   never recreated it, on purpose - "Dropped, not narrowed. Every moderation
--   action now goes through the RPC below, which can constrain *what* changes;
--   a policy can only constrain which rows, so leaving this would leave staff
--   able to rewrite post bodies." Recreating it here, even with identical role
--   logic, would hand back the one power v0.14 took away. It stays gone.
--
--   user_roles' own CHECK constraint (20260808000006). That enumerates which
--   roles may exist rather than who may do something. Pass 2 changes it.

-- --------------------------------------------------------------------------
-- "Staff", once
-- --------------------------------------------------------------------------
--
-- Reviewer and above. Named rather than repeated as a rank comparison in eleven
-- policies, so the next question of this kind - "should an expert count?" - has
-- one place to be answered instead of eleven.
--
-- NOT every perk is this bar, and the difference matters: the submission
-- cooldown bypass below is trusted_editor and above, and is written as its own
-- rank comparison rather than bent to fit this helper.
--
-- Granted to "anon" as well as "authenticated", and that is not an oversight.
-- "Anyone can read published tier lists" is a SELECT policy with no TO clause,
-- so it is evaluated for EVERY reader including anonymous ones - a visitor who
-- could not execute this would get an error instead of a tier list. get_my_role()
-- was granted to anon in 20260803000002 for precisely this reason, and
-- can_moderate() repeats it in 20260813000001.
CREATE OR REPLACE FUNCTION "public"."is_staff"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
    SELECT "public"."role_rank"("public"."get_my_role"())
           >= "public"."role_rank"('reviewer');
$$;

REVOKE ALL ON FUNCTION "public"."is_staff"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."is_staff"() TO "anon";
GRANT EXECUTE ON FUNCTION "public"."is_staff"() TO "authenticated";

COMMENT ON FUNCTION "public"."is_staff"() IS
    'Reviewer or above, by rank rather than by name. The one definition of "staff" for the policies that used to spell it ARRAY[admin, reviewer].';

-- --------------------------------------------------------------------------
-- page_data
-- --------------------------------------------------------------------------
-- No FOR clause, so FOR ALL - this is the write gate on live page content.
-- TO "authenticated" and the WITH CHECK mirroring USING are both carried over.
DROP POLICY IF EXISTS "Admin Write Live Data" ON "public"."page_data";

CREATE POLICY "Admin Write Live Data" ON "public"."page_data"
    TO "authenticated"
    USING ("public"."is_staff"())
    WITH CHECK ("public"."is_staff"());

-- --------------------------------------------------------------------------
-- pending_revisions
-- --------------------------------------------------------------------------
-- "manage" has no FOR clause either, so it is the write half; "view" is the
-- read half. Both are carried over exactly, TO clauses included (neither has
-- one). These two are the queue's whole server-side gate and are what F5's
-- can_review_page() will replace - built on this helper rather than beside it.
DROP POLICY IF EXISTS "Staff can manage queue" ON "public"."pending_revisions";

CREATE POLICY "Staff can manage queue" ON "public"."pending_revisions"
    USING ("public"."is_staff"());

DROP POLICY IF EXISTS "Staff can view queue" ON "public"."pending_revisions";

CREATE POLICY "Staff can view queue" ON "public"."pending_revisions"
    FOR SELECT USING ("public"."is_staff"());

-- --------------------------------------------------------------------------
-- user_notifications
-- --------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff insert notifications" ON "public"."user_notifications";

CREATE POLICY "Staff insert notifications" ON "public"."user_notifications"
    FOR INSERT TO "authenticated"
    WITH CHECK ("public"."is_staff"());

-- --------------------------------------------------------------------------
-- page_history
-- --------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff can view page history" ON "public"."page_history";

CREATE POLICY "Staff can view page history" ON "public"."page_history"
    FOR SELECT USING ("public"."is_staff"());

-- --------------------------------------------------------------------------
-- site_posts
-- --------------------------------------------------------------------------
-- Staff see drafts; the public read policy for published posts is separate and
-- untouched.
DROP POLICY IF EXISTS "Staff can view all posts" ON "public"."site_posts";

CREATE POLICY "Staff can view all posts" ON "public"."site_posts"
    FOR SELECT TO "authenticated"
    USING ("public"."is_staff"());

-- --------------------------------------------------------------------------
-- media_moderation - four policies, one per verb
-- --------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff can view all moderation records" ON "public"."media_moderation";

CREATE POLICY "Staff can view all moderation records" ON "public"."media_moderation"
    FOR SELECT TO "authenticated"
    USING ("public"."is_staff"());

DROP POLICY IF EXISTS "Staff can record a moderation decision" ON "public"."media_moderation";

CREATE POLICY "Staff can record a moderation decision" ON "public"."media_moderation"
    FOR INSERT TO "authenticated"
    WITH CHECK ("public"."is_staff"());

DROP POLICY IF EXISTS "Staff can change a moderation decision" ON "public"."media_moderation";

CREATE POLICY "Staff can change a moderation decision" ON "public"."media_moderation"
    FOR UPDATE TO "authenticated"
    USING ("public"."is_staff"())
    WITH CHECK ("public"."is_staff"());

DROP POLICY IF EXISTS "Staff can clear a moderation decision" ON "public"."media_moderation";

CREATE POLICY "Staff can clear a moderation decision" ON "public"."media_moderation"
    FOR DELETE TO "authenticated"
    USING ("public"."is_staff"());

-- --------------------------------------------------------------------------
-- tier_lists
-- --------------------------------------------------------------------------
-- The staff clause is one branch of a public read policy, and the other two
-- branches are what make the page work for everyone else. Carried over verbatim.
DROP POLICY IF EXISTS "Anyone can read published tier lists" ON "public"."tier_lists";

CREATE POLICY "Anyone can read published tier lists" ON "public"."tier_lists"
    FOR SELECT USING (
        "status" = 'published'
        OR "owner_id" = "auth"."uid"()
        OR "public"."is_staff"()
    );

-- --------------------------------------------------------------------------
-- can_moderate() - the capability, rebuilt on the ladder
-- --------------------------------------------------------------------------
-- Body carried over from 20260813000001 with the literal replaced. The OR with
-- the per-user flag is the whole point of the function and is untouched: this
-- grants thread moderation to someone who is not staff at all.
--
-- Still SECURITY DEFINER, because it reads user_roles for the flag, which RLS
-- protects. is_staff() is not, because it does not.
CREATE OR REPLACE FUNCTION "public"."can_moderate"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
    SELECT "public"."is_staff"()
        OR COALESCE(
            (SELECT ur.can_moderate FROM public.user_roles ur
             WHERE ur.user_id = auth.uid()),
            false
        );
$$;

-- --------------------------------------------------------------------------
-- check_revision_rate_limit() - a DIFFERENT bar, kept different
-- --------------------------------------------------------------------------
-- trusted_editor and above, NOT is_staff(). Written as its own rank comparison
-- so the distinction survives: bending this to the staff helper would silently
-- take the cooldown bypass away from every trusted editor.
--
-- Body carried over from 20260812000005 (the latest definition) unchanged apart
-- from that one test - including the per-user bypass_cooldown capability, the
-- COALESCE that makes an absent settings row mean "enforce", and the keying on
-- NEW.author_id rather than the caller.
CREATE OR REPLACE FUNCTION "public"."check_revision_rate_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  bypass_enabled boolean;
  author_exempt boolean;
BEGIN
  SELECT staff_bypass_submission_cooldown INTO bypass_enabled
    FROM site_settings WHERE id = true;

  -- The rank comparison is total where the old `IN` list was not: role_rank()
  -- returns 0 for NULL through its ELSE branch, so a signed-in user with no
  -- role falls through to the limit below instead of evaluating to NULL.
  IF COALESCE(bypass_enabled, false)
     AND public.role_rank(public.get_my_role()) >= public.role_rank('trusted_editor') THEN
    RETURN NEW;
  END IF;

  -- The per-user capability, checked second so it can grant the exemption to
  -- someone the site-wide switch does not cover - a contributor with no role
  -- at all, which is the case it exists for. COALESCE because a user with no
  -- user_roles row at all selects into NULL, and NULL must mean "enforce".
  SELECT bypass_cooldown INTO author_exempt
    FROM user_roles WHERE user_id = NEW.author_id;

  IF COALESCE(author_exempt, false) THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pending_revisions
    WHERE author_id = NEW.author_id
    AND created_at > (NOW() - INTERVAL '3 minutes')
  ) THEN
    RAISE EXCEPTION 'Server Rate limit exceeded. You can only submit a revision every 3 minutes.';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."check_revision_rate_limit"() OWNER TO "postgres";

-- No table-level GRANTs are added or changed. Every table touched here already
-- carries its grants from the migration that created it, and this migration
-- replaces policies rather than introducing anything.
