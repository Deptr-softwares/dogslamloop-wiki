---
paths:
  - "supabase/**"
  - "js/utility/site_utils.js"
  - "js/utility/site_account.js"
  - "js/utility/account_boxes.js"
  - "js/overseer/**"
  - "js/owner/**"
  - "js/editor/core/editor-core.js"
  - "js/pages/community/discussions.js"
  - "js/pages/core/page_shell.js"
  - "js/pages/tier-lists/tier-editor.js"
---

# Roles and who may do what

The ladder and what each role can do are in CLAUDE.md ("Roles"). This file is how to check them.

## Rule

- Authorization lives in Postgres: RLS, table grants and each RPC's own check of its caller. A page's RBAC gate only decides what to show, because anyone can call the REST endpoint directly.
- Never test a role by name. The ladder is stated once, in `role_rank()` (SQL) and `window.ROLE_RANK` (JS); compare with `is_staff()`, `is_owner()`, `roleMeets()` or `rolesMeet()`. The one test by name is the ban: `IS DISTINCT FROM 'viewer'`. When sweeping, grep for equality as well as `ARRAY[...]`.
- `get_my_role()` is NULL for a signed-in account with no role. Compare with `IS DISTINCT FROM`, never `=` or `<>`, and remember `NOT NULL` is NULL, which an `IF` treats as false. `role_rank(NULL)` is 0.
- A `SECURITY DEFINER` function runs with its owner's rights, so it checks its caller before it writes.
- A function granted to `anon` calls only functions `anon` can execute, unless it is `SECURITY DEFINER`.

## What happened

- 2026-08-07 (#29): `assign_role_by_email`, a `SECURITY DEFINER` function, did not check who called it. It does now.
- 2026-08-13 (#80): the storage UPDATE policy was open while DELETE was closed. It was closed the same way.
- 2026-08-20 (#119): trigger functions could be called as RPCs. Their grants were revoked.
- 2026-08-25 (v0.16 bug 6): a reviewer was meant to have a trusted editor's perks, and had one of the three, because each place listed roles by name.
- 2026-08-27 (v0.17, #143 to #145): every literal role list moved onto the ladder before `admin` became `owner`. The rename touched 30 places, and the first pass missed fifteen policies that failed open. The sweep would also have broken the Certified Tier List for signed-out readers, because a policy every reader runs called `role_rank()` without an `anon` grant (#144, caught before release).
- 2026-09-28 (#207): `is_owner()` was `get_my_role() = 'owner'`. For a roleless account that is NULL, so every `IF NOT is_owner() THEN RAISE` skipped its refusal. Closed on production first, then in the repo.

## How it is checked

- `tests/role-ladder-sweep.spec.js`: no live policy names a role.
- `tests/definer-rpc-guards.spec.js`: a `SECURITY DEFINER` function that writes checks its caller.
- The `supabase-migration` skill: probing RLS, grants and RPC guards on a preview database with the five accounts in `supabase/seed.sql`, a roleless one among them.

## Read more

- Supabase, Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
