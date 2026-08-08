---
name: supabase-migration
description: Use when writing or reviewing a Supabase migration for this project - creating or altering a table, RLS policy, GRANT, or RPC (especially SECURITY DEFINER). Covers the checklist that prevents privilege escalation, silent 401s from missing grants, and NULL-comparison bugs that deny every user.
paths: supabase/migrations/**
---

# Writing a migration

Three real incidents in this project came from skipping steps below: an unauthenticated privilege escalation, and two cases of a policy silently returning 401 because its GRANT was missing.

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

7. Match the schema's existing shape: double-quoted schema-qualified identifiers, `TO "authenticated"` on write policies, `WITH CHECK` mirroring `USING`, and a header comment explaining the problem the migration solves.

## Data changes

8. **Prefer behaviour-preserving by construction over by assertion.** When retiring a role or column, make the migration's own mechanics guarantee no access changes — e.g. deleting `contributor` rows leaves those users with no role, which is the permission set that role already granted.

9. Check foreign keys before assuming a delete will work. `pending_revisions.author_id` and `user_notifications.user_id` reference `auth.users` with **no `ON DELETE` clause**, so deleting a user who has contributed raises a constraint violation.

## Verify against production

**Playwright cannot reach RLS, grants, or RPC guards** — every auth spec mocks Supabase and never touches real Postgres. A migration asserted but not probed is unverified.

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

Send the function's *real* signature. Posting a parameter to a zero-argument function returns `PGRST202`, which looks like a refusal but is only a signature mismatch.

Migrations apply on merge, so this verification happens after merging, not before.

## More detail

For the 2026-08-07 privilege-escalation writeup and the schema's existing policy/grant conventions, read `reference.md` in this skill's directory.
