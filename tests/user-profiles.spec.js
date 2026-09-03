// v0.17 F11 part 1: the user_profiles migration.
//
// RLS, GRANTs and RPC guards are invisible to Playwright - every auth spec here
// mocks Supabase and never touches Postgres - so this file cannot prove the
// policies work. The preview branch and the production probes do that.
//
// What it protects is the set of decisions that are easy to "tidy" later and
// expensive to get wrong, each of which has a reason recorded in the migration:
//
//   * the bio never leaves the database when the profile is private
//   * get_public_profile() reads auth.users and must never return an email
//   * no staff UPDATE policy on the table (the v0.14 trap, in a new place)
//   * no trigger on auth.users, because one that raises breaks signup
//
// Two of these are absence assertions, which this project has been bitten by
// before - an absence assertion survives the change that should break it. So
// each one is paired with a positive assertion about what should be there
// instead, and the parsing is checked against itself at the bottom.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const MIG = path.join(__dirname, '..', 'supabase', 'migrations', '20260827000005_user_profiles.sql');
const SQL = fs.readFileSync(MIG, 'utf8');

// Comments explain the decisions below, and several of them quote the thing
// being forbidden. Parsing the prose as if it were SQL is how v0.16 lost a
// round, so strip it once here.
const CODE = SQL.replace(/--[^\n]*/g, ' ');

function fnBody(name) {
    const start = CODE.indexOf(`CREATE OR REPLACE FUNCTION "public"."${name}"`);
    expect(start, `${name}() is defined`).toBeGreaterThan(-1);
    const end = CODE.indexOf('$$;', start);
    return CODE.slice(start, end === -1 ? CODE.length : end + 3);
}

// --- THE TABLE ---

test('the profile cascades when the account is deleted', async () => {
    // anonymize_user_by_email hard-deletes the auth.users row. Two tables have
    // already had to be changed for this (pending_revisions.author_id dropping
    // NOT NULL, page_discussions.author_id becoming ON DELETE SET NULL); a new
    // table with a plain reference would be the third thing blocking deletion.
    expect(CODE).toMatch(
        /FOREIGN KEY \("user_id"\)\s*REFERENCES "auth"\."users"\("id"\) ON DELETE CASCADE/
    );
});

test('the display name is NOT copied into this table', async () => {
    // The whole reason there is no backfill and no trigger on auth.users. A
    // display_name column here would be a second source of truth that has to be
    // synced with user_metadata, and the sync is what would need the trigger.
    const createTable = CODE.slice(
        CODE.indexOf('CREATE TABLE IF NOT EXISTS "public"."user_profiles"'),
        CODE.indexOf('ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY')
    );
    expect(createTable, 'the name stays in auth.users.raw_user_meta_data')
        .not.toMatch(/"display_name"\s+text/);
    // Paired positive: the columns that SHOULD be here are, so this test still
    // means something if the table is ever rewritten.
    for (const col of ['"bio" text', '"flair" text', '"is_private" boolean']) {
        expect(createTable).toContain(col);
    }
});

test('nothing triggers on auth.users', async () => {
    // The standard Supabase profile pattern is a trigger on auth.users that
    // inserts a row on signup. It is deliberately not used: a trigger that
    // raises for any reason takes signup down with it, and reading the name
    // through a definer function makes the row optional instead of required.
    expect(CODE, 'a missing row means "no bio, no flair, public" - not an error')
        .not.toMatch(/(?:CREATE|DROP)\s+TRIGGER[^;]*ON\s+"?auth"?\."?users"?/i);
    // Paired positive: the one trigger this migration does create.
    expect(CODE).toMatch(/CREATE TRIGGER "trigger_touch_user_profile"\s*BEFORE UPDATE ON "public"\."user_profiles"/);
});

// --- PRIVACY IS A SERVER DECISION ---

test('a private bio never leaves the database', async () => {
    const fn = fnBody('get_public_profile');
    // The bio column is returned through a CASE that nulls it, rather than
    // being selected and hidden by the client. A client-side hide is a privacy
    // setting that devtools defeats.
    expect(fn).toMatch(/CASE WHEN COALESCE\("?up"?\."is_private", false\) THEN NULL ELSE "?up"?\."bio" END/);
    // And the raw column is not ALSO returned somewhere else in the same row.
    const bareBio = fn.match(/up\."bio"/g) || [];
    expect(bareBio.length, 'bio is referenced exactly once, inside the CASE').toBe(1);
});

test('the public reader cannot leak an email', async () => {
    const fn = fnBody('get_public_profile');
    // It is SECURITY DEFINER over auth.users, so the column list is the only
    // thing between a public RPC and every address on the site.
    expect(fn, 'no email column, and none aliased out').not.toMatch(/au\."email"|"email"::text|->>'email'/);
    // The named fallback chain must not end at the email prefix the way
    // getDisplayName() does. That fallback is correct for showing you your own
    // name and is a leak here.
    expect(fn).not.toMatch(/split_part\([^)]*email/i);
    expect(fn, "falls back to a placeholder instead").toMatch(/'Anonymous'\s*\)/);
});

test('a soft-banned account is not publicly branded', async () => {
    const fn = fnBody('get_public_profile');
    // viewer is a ban. Publishing it as a standing would put a moderation
    // decision on a public profile.
    expect(fn).toMatch(/CASE WHEN "?ur"?\."role" IS DISTINCT FROM 'viewer' THEN "?ur"?\."role" END/);
});

test('the public reader is callable by a logged-out reader', async () => {
    // The main case for this function is somebody clicking a name in a
    // discussion while signed out. A missing anon grant makes that an error
    // rather than a profile - the same failure the tier list had.
    expect(CODE).toMatch(/REVOKE ALL ON FUNCTION "public"\."get_public_profile"\(uuid\) FROM PUBLIC/);
    expect(CODE).toMatch(/GRANT EXECUTE ON FUNCTION "public"\."get_public_profile"\(uuid\) TO "anon"/);
    expect(CODE).toMatch(/GRANT EXECUTE ON FUNCTION "public"\."get_public_profile"\(uuid\) TO "authenticated"/);
    expect(fnBody('get_public_profile')).toMatch(/SET "search_path" TO 'public'/);
});

test('anon cannot reach the table itself, only the function', async () => {
    // Reads go through get_public_profile precisely so privacy can be applied
    // server-side. A direct anon SELECT grant would route around it.
    expect(CODE, 'no anon grant on user_profiles')
        .not.toMatch(/GRANT[^;]*ON TABLE "public"\."user_profiles" TO "anon"/);
    // Paired positive: the grant that should exist does.
    expect(CODE).toMatch(/GRANT SELECT, INSERT, UPDATE ON TABLE "public"\."user_profiles" TO "authenticated"/);
    // And no policy opens SELECT to everyone. A policy with no TO clause is
    // evaluated for anon too.
    const selectPolicy = CODE.match(/CREATE POLICY "[^"]+" ON "public"\."user_profiles"\s*FOR SELECT[^;]*;/);
    expect(selectPolicy, 'there is a SELECT policy').toBeTruthy();
    expect(selectPolicy[0], 'and it is self-only').toMatch(/TO "authenticated"\s*USING \("auth"\."uid"\(\) = "user_id"\)/);
});

// --- THE v0.14 TRAP, IN A NEW PLACE ---

test('staff cannot rewrite somebody else\'s profile through a policy', async () => {
    // 20260813000001 dropped "Staff can moderate discussions" because a policy
    // constrains WHICH ROWS change, not WHAT changes - it left staff able to
    // rewrite a contributor's post body. A staff UPDATE policy here would let
    // staff rewrite a bio into anything at all.
    const policies = CODE.match(/CREATE POLICY "[^"]+" ON "public"\."user_profiles"[\s\S]*?;/g) || [];
    expect(policies.length, 'the three self-service policies').toBe(3);
    for (const p of policies) {
        expect(p, 'every policy on this table is scoped to the caller\'s own row')
            .toMatch(/"auth"\."uid"\(\) = "user_id"/);
        expect(p, 'and none of them grants staff a way in')
            .not.toMatch(/is_staff|role_rank|is_owner/);
    }
});

test('moderation goes through an RPC that can only blank the text', async () => {
    const fn = fnBody('clear_profile_text');
    // Only these two columns, and the row survives - same as REMOVE on a post,
    // which blanks the body and keeps the placeholder so replies are not
    // orphaned.
    expect(fn).toMatch(/SET "bio" = NULL, "flair" = NULL/);
    expect(fn, 'the row is kept, not deleted').not.toMatch(/DELETE FROM "public"\."user_profiles"/);
    // The snapshot is the only remaining copy of what was said.
    expect(fn).toMatch(/INSERT INTO "public"\."moderation_log"/);
    expect(fn).toMatch(/'user_profile'/);
});

test('the moderation RPC checks the caller before it reads anything', async () => {
    const fn = fnBody('clear_profile_text');
    const guard = fn.search(/IF NOT "public"\."is_staff"\(\) THEN/);
    const raise = fn.search(/ERRCODE = '42501'/);
    const firstRead = fn.search(/SELECT up\."bio"/);
    const firstWrite = fn.search(/UPDATE "public"\."user_profiles"/);

    expect(guard, 'there is a caller check').toBeGreaterThan(-1);
    expect(raise, 'that raises 42501').toBeGreaterThan(guard);
    // Ordering, not mere presence: a guard after the read is not a guard.
    expect(firstRead, 'the guard comes before the first read').toBeGreaterThan(raise);
    expect(firstWrite, 'and before the first write').toBeGreaterThan(raise);
    // By rank, not by name - a literal is how v0.16 bug 6 happened.
    expect(fn).not.toMatch(/= '(?:admin|owner|reviewer)'/);
});

test('the moderation RPC is not exposed to anon', async () => {
    expect(CODE).toMatch(/REVOKE ALL ON FUNCTION "public"\."clear_profile_text"\(uuid, text\) FROM PUBLIC/);
    expect(CODE).toMatch(/REVOKE ALL ON FUNCTION "public"\."clear_profile_text"\(uuid, text\) FROM "anon"/);
    expect(CODE).toMatch(/GRANT EXECUTE ON FUNCTION "public"\."clear_profile_text"\(uuid, text\) TO "authenticated"/);
});

// --- THE BAN ---

test('a soft-banned account cannot write a bio or a flair', async () => {
    // viewer means "signed in, can read, cannot put content on the site". A bio
    // and a flair render beside a name in discussions, so they are content.
    const writes = CODE.match(/CREATE POLICY "[^"]+" ON "public"\."user_profiles"\s*FOR (?:INSERT|UPDATE)[\s\S]*?;/g) || [];
    expect(writes.length, 'INSERT and UPDATE').toBe(2);
    for (const p of writes) {
        // IS DISTINCT FROM, never <>: get_my_role() is NULL for a signed-in
        // user with no role, and NULL <> 'viewer' is NULL, which denies
        // every ordinary user instead of only the banned one.
        expect(p).toMatch(/"public"\."get_my_role"\(\) IS DISTINCT FROM 'viewer'/);
        expect(p).not.toMatch(/get_my_role"\(\)\s*<>/);
    }
});

test('the UPDATE policy re-tests ownership in WITH CHECK', async () => {
    // USING gates the OLD row and cannot see the new one. Without the repeat, a
    // user passes the gate on their own row and writes user_id to somebody
    // else's - the same hole 20260827000000 closed on pending_revisions.
    const p = CODE.match(/CREATE POLICY "Users can update own profile"[\s\S]*?;/)[0];
    const using = p.indexOf('USING');
    const check = p.indexOf('WITH CHECK');
    expect(check).toBeGreaterThan(using);
    expect(p.slice(check)).toMatch(/"auth"\."uid"\(\) = "user_id"/);
});

// --- THE PARSER, CHECKED AGAINST ITSELF ---

test('the assertions above are reading real SQL', async () => {
    // Every absence assertion in this file passes trivially if the parsing is
    // broken and CODE is empty or the function bodies are not found. This is
    // the cheap guard against that.
    expect(CODE.length).toBeGreaterThan(2000);
    expect(fnBody('get_public_profile').length).toBeGreaterThan(400);
    expect(fnBody('clear_profile_text').length).toBeGreaterThan(400);
    // And the comment stripping did not eat the code.
    expect(CODE).toContain('CREATE TABLE IF NOT EXISTS "public"."user_profiles"');
});
