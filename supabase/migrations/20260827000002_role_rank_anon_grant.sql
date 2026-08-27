-- v0.17: role_rank() must be executable by "anon", or the Certified Tier List
-- stops rendering for logged-out readers.
--
-- A REGRESSION FROM 20260827000001, caught before it reached production.
--
-- That migration rewrote "Anyone can read published tier lists" to call
-- is_staff() instead of naming roles. The policy is FOR SELECT with no TO
-- clause, and anon holds SELECT on tier_lists (20260813000005:195), so it is
-- evaluated for EVERY reader - which the sweep knew, and is why is_staff() was
-- granted to anon there.
--
-- What it missed is one level down. is_staff() is deliberately NOT SECURITY
-- DEFINER, so it executes as the CALLER; and it calls role_rank(), which
-- 20260825000001 explicitly revoked from anon. An anonymous visitor would
-- therefore reach the policy, enter is_staff(), and fail with "permission
-- denied for function role_rank" - an error where a tier list should be.
--
-- Granting EXECUTE on a function is not enough on its own: everything that
-- function calls has to be reachable by the same role. get_my_role() was
-- already granted to anon in 20260803000002 for exactly this reason, which is
-- why that half worked and this half did not.
--
-- WHY GRANTING IS THE RIGHT FIX, rather than making is_staff() SECURITY
-- DEFINER. role_rank() is IMMUTABLE and maps a string to a small integer. It
-- reads no table, touches no row, and discloses nothing: the ladder is already
-- public, written into CLAUDE.md and shipped to every visitor as
-- window.ROLE_RANK in js/site_utils.js. There is nothing here for anon to
-- learn, and adding SECURITY DEFINER would take a function that needs no
-- elevation and give it some - against the rule that definer is for crossing
-- an RLS boundary, which this does not.
GRANT EXECUTE ON FUNCTION "public"."role_rank"("text") TO "anon";

COMMENT ON FUNCTION "public"."role_rank"("text") IS
    'Orders the role names so a perk can be expressed as "at least X" instead of a literal list. The one place that states a reviewer outranks a trusted editor. Executable by anon because is_staff() calls it from a policy that every reader evaluates.';
