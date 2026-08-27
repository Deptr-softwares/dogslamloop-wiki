# Reference: incidents and schema conventions

Background for `SKILL.md`. Read when you need the *why* behind a rule, or an existing example to match.

## The 2026-08-07 privilege escalation

`public.assign_role_by_email(target_email, assigned_role)` was `SECURITY DEFINER` with **no caller check**, and Postgres's default `GRANT EXECUTE TO PUBLIC` had never been revoked.

The anon key is public by design — it ships in `js/site_utils.js`. So an unauthenticated `POST /rest/v1/rpc/assign_role_by_email` returned `HTTP 200`. Anyone on the internet who knew or guessed an account's email could set any role on it: self-granting `admin`, or revoking the owner's own admin row.

Present since the original schema. The v0.6 role-model rewrite changed the function's body for an unrelated bug and carried the missing guard forward — a rewrite is not an audit.

Not exploited; `user_roles` held only the expected accounts. Fixed in `20260807000001_secure_assign_role_by_email.sql` with all three layers (revoke, internal caller check, pinned `search_path`), and verified by re-running the same probe: `HTTP 200` → `HTTP 401 permission denied`.

**Audited at the same time and clean:** `get_my_role()` (only ever returns the caller's own role) and the triggers `archive_page_version`, `check_revision_rate_limit`, `rls_auto_enable` (not client-callable). Re-audit if new definer functions appear.

## The two missing-GRANT incidents

Both presented as "the policy doesn't work" when the policy was fine:

- **`page_history`** had RLS enabled and a staff-view policy, but no `GRANT SELECT` to `authenticated`. `owner.js`'s garbage collector had been silently scanning zero rows.
- **`pending_revisions`** gained a public-read policy for approved revisions, but `anon` had no table-level SELECT grant. `history.html` said "Public history…" in its own header and had never worked for an anonymous visitor.

A third layer surfaced in the same investigation: `anon` also needed `EXECUTE` on `get_my_role()`. Postgres evaluates *every* applicable policy's `USING` clause to compute their OR — so a staff-only policy that calls a function `anon` cannot execute throws before the public policy can grant access.

## Schema conventions to match

```sql
-- Role-gated write, both clauses (remote_schema.sql:269)
CREATE POLICY "Admin Write Live Data" ON "public"."page_data" TO "authenticated"
USING (("public"."get_my_role"() = ANY (ARRAY['admin'::"text",'reviewer'::"text"])))
WITH CHECK (("public"."get_my_role"() = ANY (ARRAY['admin'::"text",'reviewer'::"text"])));

-- Ownership-gated (20260807000000_user_notifications_update_policy.sql)
CREATE POLICY "Users update own notifications" ON "public"."user_notifications"
FOR UPDATE TO "authenticated"
USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));
```

`get_my_role()` is the role predicate everywhere — never a subquery on `user_roles`. `20260731000000_page_permissions.sql` is the cleanest full miniature: `CREATE TABLE` → `OWNER TO` → `ENABLE ROW LEVEL SECURITY` → policy → explicit grants to both `anon` and `authenticated`.

## Who writes to what

Admin-only tables (`site_pages`, `site_faq`, `site_collaborators`, `site_posts`, `page_permissions`) are deliberately tighter than `page_data`, which allows reviewers too. Structural and editorial changes sit with admins; content review sits with reviewers.

## Migration delivery

A Supabase GitHub integration auto-applies migrations to production **on merge to `main`**. A "Supabase Preview" check runs on PRs against a separate preview project, which validates the SQL parses and applies — but not that policies behave correctly against real data and real roles.
