# Incidents behind the checklist

Read when you need the why behind a rule in `SKILL.md`.

## The 2026-08-07 privilege escalation

`public.assign_role_by_email(target_email, assigned_role)` was `SECURITY DEFINER` with **no caller check**, and Postgres's default `GRANT EXECUTE TO PUBLIC` had never been revoked. The anon key is public by design, so an unauthenticated `POST /rest/v1/rpc/assign_role_by_email` returned `HTTP 200`: anyone who knew an account's email could set any role on it, including self-granting admin or revoking the owner's.

Present since the original schema. The v0.6 role rewrite changed the function's body for an unrelated bug and carried the missing guard forward: a rewrite is not an audit. Not exploited. Fixed in `20260807000001_secure_assign_role_by_email.sql` with all three layers (revoke, caller check, pinned `search_path`) and verified by re-running the same probe: `HTTP 200` became `HTTP 401`.

## The two missing-GRANT incidents

Both looked like "the policy doesn't work" while the policy was fine:

- **`page_history`** had RLS and a staff-view policy but no `GRANT SELECT` to `authenticated`, so `owner.js`'s garbage collector silently scanned zero rows.
- **`pending_revisions`** gained a public-read policy for approved revisions, but `anon` had no table SELECT grant, so `history.html` ("Public history...") never worked for a signed-out visitor.

The same investigation found the third layer: `anon` also needed `EXECUTE` on `get_my_role()`, because a staff-only policy calling it threw before the public policy could allow the read.

## The 2026-09-28 NULL guard

`is_owner()` was `get_my_role() = 'owner'`, which is NULL for a roleless account. Every owner check was written `IF NOT is_owner() THEN RAISE`, and `NOT NULL` is NULL, which `IF` treats as false, so the RAISE was skipped. From v0.17 until the hotfix (`20260927000000_is_owner_never_null.sql`, PR #207), any signed-in account with no role passed all twenty owner checks and could make itself owner. Closed on production by hand first, because the repo is public, then explained.

## The v0.14 preview failures

- **PR #85:** `144f721` added `20260814000001` and the preview applied it. `7de46e1` then edited the same file and dropped a `WITH`. The preview skipped the already-recorded version, reported green, and production raised `42601`. `supabase/migrations.lock.json` was created in response.
- **PR #81:** `20260813000005` seeded a tier list from an owner-authored `page_data` row. On the preview its `DO` block hit `IF overall IS NULL THEN RETURN`, so the `ORDER BY ur.created_at` below was never planned. It passed its PR and the release preview, then raised `42703` on production and rolled back the five migrations behind it. `tests/migration-columns.spec.js` was written in the hotfix (PR #97).
