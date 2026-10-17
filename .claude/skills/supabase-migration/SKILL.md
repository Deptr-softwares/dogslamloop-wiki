---
name: supabase-migration
description: Checklist for writing or reviewing a Supabase migration in this project - tables, RLS policies, GRANTs, RPCs (especially SECURITY DEFINER), and edits to an already-pushed migration - plus how to probe a preview branch and production afterwards. Use when touching supabase/migrations or supabase/seed.sql, or when verifying a permission change.
paths:
  - "supabase/migrations/**"
  - "supabase/seed.sql"
---

# Writing a migration

Every rule here was a production incident. The incident write-ups are in [reference.md](reference.md); probing a preview and production is in [probing.md](probing.md).

The current example to match is `moderate_discussion_post` in `20261010000000_moderation_notifies_author.sql`.

## Every new RPC

1. **Check the caller inside the function, before reading or writing anything**, through the shared helpers and never a role name:
   ```sql
   IF NOT "public"."is_owner"() THEN
       RAISE EXCEPTION 'Permission denied: ...' USING ERRCODE = '42501';
   END IF;
   ```
   `is_staff()`, `can_moderate()` (a capability, not a rung), or `role_rank("public"."get_my_role"()) >= role_rank('<role>')` for other rungs. A page's RBAC gate is client-side and anyone can call the REST endpoint. Inside `SECURITY DEFINER`, `auth.uid()` is still the caller.
2. **Revoke the default grant, then grant explicitly.** Postgres grants `EXECUTE` to `PUBLIC` on creation, so every new RPC starts open to anonymous callers (the 2026-08-07 escalation).
   ```sql
   REVOKE ALL ON FUNCTION "public"."fn"(<arg types>) FROM PUBLIC;
   REVOKE ALL ON FUNCTION "public"."fn"(<arg types>) FROM "anon";
   GRANT EXECUTE ON FUNCTION "public"."fn"(<arg types>) TO "authenticated";
   ```
3. `SET search_path TO 'public'` on every `SECURITY DEFINER` function.
4. `SECURITY DEFINER` only where required: reading `auth.users`, crossing an RLS boundary, or code that runs as the service role (a preview's service role has no table grants it is not named on). If a plain policy would do, use one.
5. **A boolean guard must never answer NULL.** In `IF NOT fn() THEN RAISE`, a NULL skips the RAISE, so NULL means allowed. Wrap it (`SELECT COALESCE(<expr>, false)`) or go through `role_rank()`, which maps NULL to 0. `is_owner()` lacked this from v0.17 until 2026-09-28, and any signed-in account without a role could make itself owner (hotfix `20260927000000`, PR #207). `tests/migration-columns.spec.js` checks every `IF NOT` guard's latest definition.

## Every new policy

6. **Pair it with a table GRANT.** A missing grant returns 401 before RLS is consulted, so the policy looks broken for reasons it cannot explain.
   ```sql
   GRANT SELECT ON TABLE "public"."t" TO "anon";
   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."t" TO "authenticated";
   ```
7. **`IS DISTINCT FROM`, never `<>`, against `get_my_role()`.** It is NULL for a roleless user, and `NULL <> 'viewer'` is NULL, which denies every ordinary user.
8. **Every applicable policy's `USING` runs to compute their OR**, so a staff-only policy calling a function `anon` cannot execute throws before a public policy can allow the read. Grant `anon` EXECUTE on the helpers policies call.
9. **Match the schema's shape:** double-quoted schema-qualified identifiers, `TO "authenticated"` on write policies, `WITH CHECK` mirroring `USING`, and a header comment stating the problem the migration solves. `20260731000000_page_permissions.sql` is the cleanest full miniature: `CREATE TABLE` → `OWNER TO` → `ENABLE ROW LEVEL SECURITY` → policy → grants to both `anon` and `authenticated`.

## Data changes

10. **Behaviour-preserving by construction, not by assertion.** Deleting `contributor` rows left those users with no role, which was the permission set the role already granted.
11. **Check foreign keys before a delete.** `pending_revisions.author_id` and `user_notifications.user_id` reference `auth.users` with no `ON DELETE`, so deleting a user who has contributed raises a constraint violation.

## What a green Supabase Preview does not prove

12. **A pushed migration is immutable: change it with a new one.** A preview records each migration by version and never re-runs it, so an edit is verified by nothing and still reports green (PR #85 dropped a `WITH` that way and production raised `42601`). `npm run validate` checks `supabase/migrations.lock.json`. Re-lock with `npm run lock-migrations` only when the migration failed or never left this machine, and say why in the commit. A migration that failed on production is the `silent-release` case.
13. **A preview has production's schema and only the rows migrations insert, never content.** A path guarded by an owner- or contributor-written row never runs there: `20260813000005` returned early on its preview, then raised `42703` on production and rolled back the five migrations behind it. `seed.sql` runs after migrations and cannot help. `tests/migration-columns.spec.js` resolves column references against the schema with no database. When a migration reads content, assume nothing will run that path before production, and re-read it on that assumption.

## Verify

Playwright mocks Supabase and never reaches RLS, grants or guards, so a migration that was not probed is unverified. Probe the preview while the PR is open, where a mistake costs a push instead of a hotfix, and production after the merge: [probing.md](probing.md).
