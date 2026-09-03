// v0.17 F5: the expert system's migration.
//
// The owner's ask: "experts of each character can get to go in and review
// submission regarding only their characters that they are qualified at".
//
// The two pending_revisions policies are the highest-risk change in the whole
// version - too loose and an expert gets the entire queue, too tight and every
// reviewer loses it - and Playwright cannot reach RLS at all. So these protect
// the SHAPE, and the four probes in the PR are what verify the behaviour:
// anon fails, a roleless non-expert fails, an expert succeeds on their own page,
// and an expert FAILS on somebody else's. The last is two probes, not one.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const MIG_DIR = path.join(__dirname, '..', 'supabase', 'migrations');
const SQL = fs.readFileSync(path.join(MIG_DIR, '20260903000001_page_experts.sql'), 'utf8');
const CODE = SQL.replace(/--[^\n]*/g, ' ');

function fnBody(name) {
    const start = CODE.indexOf(`CREATE OR REPLACE FUNCTION "public"."${name}"`);
    expect(start, `${name}() is defined`).toBeGreaterThan(-1);
    const end = CODE.indexOf('$$;', start);
    return CODE.slice(start, end === -1 ? CODE.length : end + 3);
}

// --- THE TABLE ---

test('expertise disappears with the account, and follows a renamed page', async () => {
    // CASCADE on the user: anonymize_user_by_email hard-deletes the auth.users
    // row, and pending_revisions.author_id already blocks that for contributors.
    expect(CODE).toMatch(
        /FOREIGN KEY \("user_id"\)\s*REFERENCES "auth"\."users"\("id"\) ON DELETE CASCADE/);
    // FK on the page: page_id is owner-editable, and a text[] of ids would rot
    // silently when a page is renamed. This is reason 2 for the table existing.
    expect(CODE).toMatch(
        /FOREIGN KEY \("page_id"\)\s*REFERENCES "public"\."site_pages"\("page_id"\) ON DELETE CASCADE/);
    // But NOT cascade on the grantor - losing the account that granted it must
    // not silently revoke somebody's expertise.
    expect(CODE).toMatch(
        /FOREIGN KEY \("granted_by"\)\s*REFERENCES "auth"\."users"\("id"\) ON DELETE SET NULL/);
});

test('one row per person per page', async () => {
    expect(CODE).toMatch(/PRIMARY KEY \("user_id", "page_id"\)/);
    // Which is what makes re-assigning safe rather than a constraint violation.
    expect(fnBody('assign_page_expert')).toMatch(/ON CONFLICT \("?user_id"?, "?page_id"?\)\s*DO UPDATE/);
});

test('nobody can grant themselves expertise through a policy', async () => {
    // There is exactly one policy on this table and it is a SELECT. Every grant
    // goes through the owner-gated RPCs - the same shape assign_role_by_email
    // has for roles, and the same reason clear_profile_text is an RPC.
    const policies = CODE.match(/CREATE POLICY "[^"]+" ON "public"\."page_experts"[\s\S]*?;/g) || [];
    expect(policies.length, 'one policy').toBe(1);
    expect(policies[0]).toMatch(/FOR SELECT TO "authenticated"\s*USING \("auth"\."uid"\(\) = "user_id"\)/);

    expect(CODE, 'and the table grant is read-only')
        .toMatch(/GRANT SELECT ON TABLE "public"\."page_experts" TO "authenticated"/);
    expect(CODE, 'no write grant of any kind')
        .not.toMatch(/GRANT[^;]*(?:INSERT|UPDATE|DELETE)[^;]*ON TABLE "public"\."page_experts"/);
});

// --- can_review_page ---

test('can_review_page is the ladder plus the page, not a fourth role list', async () => {
    const fn = fnBody('can_review_page');
    expect(fn, 'built on is_staff()').toMatch(/"public"\."is_staff"\(\)/);
    expect(fn, 'and never names a role').not.toMatch(/'(?:owner|admin|reviewer|trusted_editor)'/);
    expect(fn).toMatch(/EXISTS \(\s*SELECT 1 FROM "public"\."page_experts" pe/);
    expect(fn).toMatch(/pe\."page_id" = "target_page_id"/);
});

test('can_review_page must be SECURITY DEFINER or every expert is refused', async () => {
    // page_experts' only policy is self-read. A plain STABLE function runs as
    // the caller, so the EXISTS would see the row - but the reason it is definer
    // is that the policies calling it are evaluated for anon too, and the
    // function must be able to answer rather than error.
    const fn = fnBody('can_review_page');
    expect(fn).toMatch(/SECURITY DEFINER/);
    expect(fn).toMatch(/SET "search_path" TO 'public'/);
});

test('a logged-out reader can execute can_review_page', async () => {
    // Not optional. Both queue policies are written with no TO clause, so
    // Postgres evaluates them for every role including anon, and a visitor who
    // cannot execute this gets an ERROR rather than a refusal. This is the exact
    // regression that took the Certified Tier List down for logged-out readers
    // in pass 1 of the role split.
    expect(CODE).toMatch(/REVOKE ALL ON FUNCTION "public"\."can_review_page"\("text"\) FROM PUBLIC/);
    expect(CODE).toMatch(/GRANT EXECUTE ON FUNCTION "public"\."can_review_page"\("text"\) TO "anon"/);
    expect(CODE).toMatch(/GRANT EXECUTE ON FUNCTION "public"\."can_review_page"\("text"\) TO "authenticated"/);
});

// --- THE TWO QUEUE POLICIES ---

test('both queue policies are scoped to the page', async () => {
    const manage = CODE.match(/CREATE POLICY "Staff can manage queue"[\s\S]*?;/);
    const view = CODE.match(/CREATE POLICY "Staff can view queue"[\s\S]*?;/);
    expect(manage, 'the write gate is rewritten').toBeTruthy();
    expect(view, 'and the read gate').toBeTruthy();

    for (const p of [manage[0], view[0]]) {
        expect(p).toMatch(/"public"\."can_review_page"\("page_id"\)/);
        // The bug this replaces: page-blind is_staff() with no page argument.
        expect(p, 'not page-blind any more').not.toMatch(/USING \("public"\."is_staff"\(\)\)/);
    }
    // "manage" has no FOR clause, so it stays FOR ALL - the write gate as well
    // as the read one. Adding one would silently drop the write scoping.
    expect(manage[0]).not.toMatch(/FOR (?:SELECT|UPDATE|INSERT|DELETE)/);
    expect(view[0], 'and view stays SELECT-only').toMatch(/FOR SELECT/);
});

test('the policy names are unchanged, and that is deliberate', async () => {
    // Renaming them would orphan the DROP statements in the role-ladder sweep
    // and leave the page-blind policies standing beside the new ones. Two
    // policies on one table are ORed, so the old one would win and the whole
    // feature would silently do nothing.
    expect(CODE).toMatch(/DROP POLICY IF EXISTS "Staff can manage queue" ON "public"\."pending_revisions"/);
    expect(CODE).toMatch(/DROP POLICY IF EXISTS "Staff can view queue" ON "public"\."pending_revisions"/);

    const created = [...CODE.matchAll(/CREATE POLICY "([^"]+)" ON "public"\."pending_revisions"/g)]
        .map(m => m[1]);
    expect(new Set(created), 'no third policy sneaks in beside them')
        .toEqual(new Set(['Staff can manage queue', 'Staff can view queue']));
});

// --- THE OWNER TOOLS ---

for (const fn of ['assign_page_expert', 'revoke_page_expert', 'list_page_experts']) {
    test(`${fn} is owner-only and checks before it acts`, async () => {
        const body = fnBody(fn);
        const guard = body.search(/IF NOT "public"\."is_owner"\(\) THEN/);
        const raise = body.search(/ERRCODE = '42501'/);
        expect(guard, 'there is a caller check').toBeGreaterThan(-1);
        expect(raise).toBeGreaterThan(guard);

        // Ordering: a guard after the first read or write is not a guard.
        const firstTouch = body.search(/SELECT id INTO|RETURN QUERY|INSERT INTO|DELETE FROM/);
        expect(firstTouch, 'the guard comes first').toBeGreaterThan(raise);

        // By is_owner(), never by name - a literal is how v0.16 bug 6 happened.
        expect(body).not.toMatch(/= '(?:owner|admin)'/);
    });

    test(`${fn} is not reachable by anon`, async () => {
        const sig = fn === 'list_page_experts' ? '\\(\\)' : '\\("text", "text"\\)';
        expect(CODE).toMatch(new RegExp(`REVOKE ALL ON FUNCTION "public"\\."${fn}"${sig} FROM PUBLIC`));
        expect(CODE).toMatch(new RegExp(`REVOKE ALL ON FUNCTION "public"\\."${fn}"${sig} FROM "anon"`));
        expect(CODE).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION "public"\\."${fn}"${sig} TO "authenticated"`));
    });
}

// --- THE BADGE ---

test('the public expert list gives names, never addresses', async () => {
    // list_page_experts() returns emails and is owner-gated for that reason.
    // This one is granted to anon, so the column list is the whole defence.
    const fn = fnBody('get_page_experts');
    expect(fn).not.toMatch(/au\."email"|"email"::text|->>'email'/);
    expect(fn, 'and no email-prefix fallback either').toMatch(/'Anonymous'/);
    expect(CODE).toMatch(/GRANT EXECUTE ON FUNCTION "public"\."get_page_experts"\("text"\) TO "anon"/);

    // The owner-gated one is the opposite in both respects.
    expect(fnBody('list_page_experts')).toMatch(/au\."email"::text/);
    expect(CODE).toMatch(/REVOKE ALL ON FUNCTION "public"\."list_page_experts"\(\) FROM "anon"/);
});

test('the badge query has an index to use', async () => {
    // "Who are the experts of this page" runs for every reader of a character
    // page. The primary key is (user_id, page_id), so a page_id lookup has no
    // usable prefix without this.
    expect(CODE).toMatch(/CREATE INDEX IF NOT EXISTS "page_experts_page_idx" ON "public"\."page_experts" \("page_id"\)/);
});

// --- THE PARSER, CHECKED AGAINST ITSELF ---

test('the assertions above are reading real SQL', async () => {
    expect(CODE.length).toBeGreaterThan(3000);
    for (const fn of ['can_review_page', 'assign_page_expert', 'revoke_page_expert',
                      'list_page_experts', 'get_page_experts']) {
        expect(fnBody(fn).length, `${fn} body found`).toBeGreaterThan(200);
    }
    expect(CODE).toContain('CREATE TABLE IF NOT EXISTS "public"."page_experts"');
});
