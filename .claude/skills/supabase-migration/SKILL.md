---
name: supabase-migration
description: Use when writing or reviewing a Supabase migration for this project - creating or altering a table, RLS policy, GRANT, or RPC (especially SECURITY DEFINER), or when editing a migration that has already been pushed. Covers the checklist that prevents privilege escalation, silent 401s from missing grants, NULL-comparison bugs that deny every user, and the two ways a green Supabase Preview check still lets a broken migration reach production.
paths: supabase/migrations/**
---

# Writing a migration

Five real incidents in this project came from skipping steps below: an unauthenticated privilege escalation, two cases of a policy silently returning 401 because its GRANT was missing, and the two v0.14 migration failures that left three features inert in production.

## Every new RPC

1. **Check the caller inside the function, before reading or writing anything.**
   ```sql
   IF "public"."get_my_role"() IS DISTINCT FROM 'admin' THEN
       RAISE EXCEPTION 'Permission denied: ...' USING ERRCODE = '42501';
   END IF;
   ```
   Never rely on the grant alone. Never rely on the calling page being RBAC-gated — those gates are client-side and bypassed by hitting the REST endpoint directly. `auth.uid()` resolves to the *caller* inside a `SECURITY DEFINER` function, which is what makes this work.

2. **Revoke the default grant, then grant explicitly.**
   ```sql
   REVOKE ALL ON FUNCTION "public"."fn"(...) FROM PUBLIC;
   REVOKE ALL ON FUNCTION "public"."fn"(...) FROM "anon";
   GRANT EXECUTE ON FUNCTION "public"."fn"(...) TO "authenticated";
   ```
   Postgres grants `EXECUTE` to `PUBLIC` on function creation. **Every new RPC starts exposed to anonymous callers.** This is exactly how the privilege escalation happened.

3. **`SET search_path TO 'public'`** on every `SECURITY DEFINER` function.

4. Use `SECURITY DEFINER` only where genuinely required — reading `auth.users`, or crossing an RLS boundary. If a plain policy would do, use one.

## Every new policy

5. **Pair it with a table-level GRANT.** They are independent gates and a missing grant returns 401 *before* RLS is consulted, so the policy looks broken for reasons the policy cannot explain.
   ```sql
   GRANT SELECT ON TABLE "public"."t" TO "anon";
   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."t" TO "authenticated";
   ```

6. **`IS DISTINCT FROM`, never `<>`, against `get_my_role()`.** It returns NULL for a signed-in user with no role, and `NULL <> 'viewer'` evaluates to NULL — not true — so the obvious operator denies *every* ordinary user.

6a. **A boolean helper used as `IF NOT fn() THEN RAISE` must never answer NULL.** `NOT NULL` is NULL, `IF` treats it as false, and the RAISE is skipped: NULL means *allowed*. `is_owner()` was `get_my_role() = 'owner'`, NULL for every roleless account, so from v0.17 until 2026-09-28 any signed-in account without a role passed all twenty owner checks and could make itself owner (hotfix `20260927000000`, PR #207). Wrap the answer: `SELECT COALESCE(<expr>, false)`, or go through `role_rank()`, which maps NULL to 0. `tests/migration-columns.spec.js` enforces this on every `IF NOT` guard's latest definition. **Probe the roleless account, not only staff:** the hole was invisible to every probe run from an account that held a role, because any role made the comparison false instead of NULL.

7. Match the schema's existing shape: double-quoted schema-qualified identifiers, `TO "authenticated"` on write policies, `WITH CHECK` mirroring `USING`, and a header comment explaining the problem the migration solves.

## Data changes

8. **Prefer behaviour-preserving by construction over by assertion.** When retiring a role or column, make the migration's own mechanics guarantee no access changes — e.g. deleting `contributor` rows leaves those users with no role, which is the permission set that role already granted.

9. Check foreign keys before assuming a delete will work. `pending_revisions.author_id` and `user_notifications.user_id` reference `auth.users` with **no `ON DELETE` clause**, so deleting a user who has contributed raises a constraint violation.

## What a green `Supabase Preview` does not prove

It is a required check on both branches now. It still lies in two specific ways, and v0.14 shipped broken through both of them at once.

10. **A migration is immutable once pushed. To change it, write a new one.**

    A preview branch records each migration by version and will not run that version again. Edit a file you have already pushed and the branch skips it and reports green — having never read your change.

    PR #85 did this. `144f721` added `20260814000001` correctly and the preview applied it. `7de46e1` edited the same file during the tie-break change and dropped a `WITH`, leaving a body starting `settings AS (`. The preview skipped it, reported green again, and production raised `42601` on first sight.

    `npm run validate` enforces this via `supabase/migrations.lock.json`. If you genuinely need to re-lock — the migration failed, or never left your machine — `npm run lock-migrations` and say why in the commit.

11. **A preview branch has production's schema and only the data the migrations themselves insert.** Not a blank database — it holds all 40 `site_pages` rows, the hub copy, the tier settings. What it has none of is **content**: anything the owner or a contributor wrote through the site. A code path guarded by a *content* row therefore never executes, and its column references are never resolved.

    `20260813000005` seeds a tier list from a `page_data` row for `'tierlist'` carrying an `overall` tab — owner-authored, created by no migration. Its `DO` block opens `IF overall IS NULL THEN ... RETURN`, so it returned early and the `ORDER BY ur.created_at` below was never planned. It passed its own PR (#81) **and** the release preview, then raised `42703` on production and rolled back the five migrations behind it.

    `supabase/seed.sql` cannot fix this — seeding runs *after* migrations. **The defence is static:** `tests/migration-columns.spec.js` resolves column references against the schema in `supabase/migrations` with no database at all, and it is in the required `test` check. When a migration reads content at migration time, assume nothing will execute that path before production and re-read it on that assumption.

## Verify against a preview branch, then production

**Playwright cannot reach RLS, grants, or RPC guards** — every auth spec mocks Supabase and never touches real Postgres. A migration asserted but not probed is unverified.

`supabase/seed.sql` gives every preview branch five accounts, so all three cases below can be run **before** merging rather than only after:

| | |
|---|---|
| `owner@dogslamloop.test` | password `seed-owner-password`, `user_roles.role = 'owner'`. **This is the `ADMIN_JWT` for `probe-release.js`** (since 2026-10-01) |
| `admin@dogslamloop.test` | password `seed-admin-password`, `user_roles.role = 'admin'`. Refused by every owner tool, correctly |
| `member@dogslamloop.test` | password `seed-member-password`, **no role at all** (`get_my_role()` returns NULL). The `USER_JWT`. 10 days old, so the 7-day voting rule lets it vote |
| `trusted@dogslamloop.test` | password `seed-trusted-password`, `trusted_editor`: can upload by role |
| `banned@dogslamloop.test` | password `seed-banned-password`, `viewer` with `can_upload_media` ticked: refused, a ban wins over a perk |

**`ADMIN_JWT` means the OWNER's token**, a name kept from before v0.17. Given admin@'s token, nine owner tools report "failures" that are the system refusing an admin correctly. v0.20's release preview did exactly that before `owner@` existed.

Mint a JWT against the branch's URL and anon key (both in the Supabase dashboard, Branches tab):

```bash
curl -s -X POST "$BRANCH_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $BRANCH_ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"admin@dogslamloop.test","password":"seed-admin-password"}'
```

**Getting the branch's URL and keys needs no dashboard.** The CLI on the owner's machine is logged in and linked: `npx supabase branches list --project-ref gtqswjspxymjdopljmfi` shows the preview's status, and `npx supabase branches get <git branch> --project-ref gtqswjspxymjdopljmfi -o env` prints its `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `POSTGRES_URL`. It also prints the branch's service-role key and JWT secret: grep out only what you need, write it to the scratchpad, never echo the rest. `npx supabase db query --db-url "$POSTGRES_URL" "<sql>"` then reads or fixes the PREVIEW directly. `--linked` instead of `--db-url` is PRODUCTION: reads only, never a write without the owner's explicit word.

**A preview exists per PR, not per push.** With no PR open, `branches list` shows only `main`. To verify a migration while its batch is still being built, open the batch PR as a draft.

**The branch's `status` in `branches list` is not the verdict.** On 2026-10-01 the v0.20 release preview read `MIGRATIONS_FAILED` while its database held 65 of 65 migrations, both new objects and all the seeded accounts, and the `Supabase Preview` check had passed. The label's timestamp predated the check run and was never updated. Read `supabase_migrations.schema_migrations` through `--db-url`, and look for the objects the migration creates; believe those over the label, in either direction.

**If a seeded account's sign-in answers 500 "Database error querying schema"**, its token columns are NULL. `seed.sql` fills them since 2026-09-28; a preview created before that needs `UPDATE auth.users SET confirmation_token = COALESCE(confirmation_token, ''), recovery_token = COALESCE(recovery_token, ''), email_change = COALESCE(email_change, ''), email_change_token_new = COALESCE(email_change_token_new, '')` through `--db-url`.

Then `node scripts/probe-release.js` with `USER_JWT`, `ADMIN_JWT` and `--include-writes`. It refuses writes against the production ref, so point it at the branch.

Probe with curl and the public anon key, **before and after**:

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST \
  "$SUPABASE_URL/rest/v1/rpc/<fn>" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" -d '{}'
```

Three cases, in order of what they prove:
- **anon** → must fail (401/42501).
- **non-admin authenticated** → must fail with 42501.
- **admin** → **must succeed.** This is the one that matters most: over-tightening breaks the only legitimate caller, and that failure is invisible to every other check.

Send the function's *real* signature. Posting a parameter to a zero-argument function returns `PGRST202`, which looks like a refusal but is only a signature mismatch. The same trap for a table: a write naming a column the table lacks answers `400 PGRST204`, which also "refuses". A write probe sends the table's real columns and requires `42501` (found 2026-10-04, when a probe of the Discord link tables passed on `PGRST204`).

**Three things a preview is not, found 2026-10-04 (v1.0 batch 1):**

* **Its service role has no table grants it is not named on.** A preview builds from migrations under the newer "not auto-exposed" default (`supabase/config.toml`), so the service-role key gets `42501 permission denied for table site_pages`. Read public tables as anon in a probe. Code that runs as the service role should reach tables through `SECURITY DEFINER` functions, or a migration must `GRANT ... TO "service_role"`; production is older and may not show the gap.
* **`POSTGRES_URL_NON_POOLING`'s host is IPv6-only** and does not resolve on this machine. Use `POSTGRES_URL`, the pooler.
* **It deploys the PR's Edge Functions** (status `FUNCTIONS_DEPLOYED`; `npx supabase functions list --project-ref <branch ref>`), but secrets are per branch (`supabase secrets set --project-ref <branch ref>`), so a function there runs without production's.

**Four probe traps, found 2026-10-04 and 05 (v1.0 batches 2 to 4):**

* **The site's own rate limits apply to probes.** One post every 20 seconds per account and one forum post every 2 minutes: a probe that posts twice from the same seeded account in quick succession gets `53400` and every check after it reads garbage. Spread the writes across the five seeded accounts.
* **A JS assignment to an undeclared variable still sends the request.** `r = await fetch(...)` in a module with no `let r` throws a ReferenceError, but only after the right-hand side has run, so the write happened. Read the database before concluding a crashed probe changed nothing.
* **`npx` echoes the whole command line to stderr** as `npm notice run <command>`. With `2>&1 | grep <column>`, a secret passed in the command (a Postgres URL with its password, a value written into SQL) is printed whenever the grep pattern also appears in the command. On 2026-10-05, `grep secret_set` matched the notice and printed a preview's database URL and its relay secret. Send stderr to `/dev/null` on any command that carries a secret, and rotate one that was printed.
* **What a preview holds is not on dogslamloop.com.** The live site reads production. To show the owner a preview's data in the real page, serve the repo locally and set `localStorage.dsl_supabase_override` to the branch's URL and anon key (`js/site_utils.js`, `resolveSupabaseTarget`); the page shows a banner while it is on. Sign in as a seeded account from the console for a moderator's view.

Migrations apply to **production** on merge, so the production half of this happens after merging. The preview half does not — run it while the PR is open, where a mistake costs a force-push instead of a hotfix.

## More detail

For the 2026-08-07 privilege-escalation writeup and the schema's existing policy/grant conventions, read `reference.md` in this skill's directory.
