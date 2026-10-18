# Probing a preview branch and production

## Contents
- Safety
- Getting a preview's URL and keys
- The seeded accounts
- Running the probes
- Traps

## Safety

- `--linked` is **PRODUCTION**: reads only, never a write without the owner's explicit word. `--db-url "$POSTGRES_URL"` is the preview.
- `npx supabase branches get ... -o env` also prints the branch's service-role key and JWT secret. Grep out only `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `POSTGRES_URL`, write them to the scratchpad, never echo the rest.
- **`npx` echoes its whole command line to stderr** (`npm notice run <command>`). Send stderr to `/dev/null` on any command that carries a secret: on 2026-10-05 a `grep` matched the notice and printed a preview's database URL and relay secret. Rotate a secret that was printed.
- `scripts/probe-release.js` refuses writes against the production ref.

## Getting a preview's URL and keys

The CLI on the owner's machine is logged in and linked; no dashboard needed.

```bash
npx supabase branches list --project-ref gtqswjspxymjdopljmfi
npx supabase branches get <git branch> --project-ref gtqswjspxymjdopljmfi -o env 2>/dev/null
npx supabase db query --db-url "$POSTGRES_URL" "<sql>" 2>/dev/null
```

- **A preview exists per PR, not per push.** With no PR open, `branches list` shows only `main`. To verify a migration while its batch is still being built, open the batch PR as a draft. A preview lives as long as its PR stays open, and its compute sits outside the org spend cap.
- **The `status` column is not the verdict.** On 2026-10-01 a preview read `MIGRATIONS_FAILED` while its database held all 65 migrations and the check had passed. Read `supabase_migrations.schema_migrations` through `--db-url` and look for the objects the migration creates.
- `POSTGRES_URL_NON_POOLING`'s host is IPv6-only and does not resolve on this machine: use `POSTGRES_URL`, the pooler.

## The seeded accounts

`supabase/seed.sql` gives every preview five accounts:

| Account | Password | Role |
|---|---|---|
| `owner@dogslamloop.test` | `seed-owner-password` | `owner`. **This is the `ADMIN_JWT` for `probe-release.js`** |
| `admin@dogslamloop.test` | `seed-admin-password` | `admin`; every owner tool refuses it, correctly |
| `member@dogslamloop.test` | `seed-member-password` | **no role** (`get_my_role()` is NULL). The `USER_JWT`. 10 days old, so it can vote |
| `trusted@dogslamloop.test` | `seed-trusted-password` | `trusted_editor`; can upload by role |
| `banned@dogslamloop.test` | `seed-banned-password` | `viewer` with `can_upload_media` ticked; refused, a ban wins over a perk |

`ADMIN_JWT` is the owner's token, a name kept from before v0.17. Given admin@'s token, nine owner tools report "failures" that are correct refusals.

Mint a token against the branch's URL and anon key:

```bash
curl -s -X POST "$BRANCH_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $BRANCH_ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"owner@dogslamloop.test","password":"seed-owner-password"}'
```

If a sign-in answers 500 "Database error querying schema", the account's token columns are NULL (a preview created before 2026-09-28). Fix through `--db-url`: `UPDATE auth.users SET confirmation_token = COALESCE(confirmation_token, ''), recovery_token = COALESCE(recovery_token, ''), email_change = COALESCE(email_change, ''), email_change_token_new = COALESCE(email_change_token_new, '')`.

## Running the probes

`node scripts/probe-release.js` with `USER_JWT`, `ADMIN_JWT` and `--include-writes`, pointed at the branch. For one RPC, with curl:

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST \
  "$SUPABASE_URL/rest/v1/rpc/<fn>" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" -d '{}'
```

Three cases, in order of what they prove:

- **anon** must fail (401 or 42501).
- **the roleless account** must fail with 42501. Probe it, not only staff: the `is_owner()` hole was invisible from any account that held a role.
- **the legitimate caller** must succeed. Over-tightening breaks the only real caller, and that failure is invisible to every other check.

Send the real signature. A parameter posted to a zero-argument function returns `PGRST202`, and a write naming a column the table lacks returns `400 PGRST204`. Both look like refusals and are only mismatches: a write probe sends the table's real columns and requires `42501` (a probe of the Discord link tables "passed" on `PGRST204`, 2026-10-04).

## Traps

- **A preview's service role has no table grants it is not named on.** Previews build under the "not auto-exposed" default (`supabase/config.toml`), so the service-role key gets `42501` on `site_pages`. Read public tables as anon. Code running as the service role reaches tables through `SECURITY DEFINER` functions, or a migration grants `service_role`; production is older and may not show the gap.
- **A preview deploys the PR's Edge Functions** (`npx supabase functions list --project-ref <branch ref>`), but secrets are per branch, so a function there runs without production's.
- **The site's rate limits apply to probes:** one post every 20 seconds per account, one forum post every 2 minutes. Spread writes across the five accounts, or a `53400` turns every later check into garbage.
- **A JS assignment to an undeclared variable still sends the request** before it throws. Read the database before concluding a crashed probe changed nothing.
- **What a preview holds is not on dogslamloop.com**, which reads production. Say which database a test used. To show the owner a preview's data in the real page, serve the repo locally and set `localStorage.dsl_supabase_override` to the branch's URL and anon key (`resolveSupabaseTarget` in `js/site_utils.js`); the page shows a banner while it is on.
