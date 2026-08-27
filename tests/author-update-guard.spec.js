// v0.17: "Authors can update own pending revisions" tested ownership and
// nothing else in its WITH CHECK, so an author could rewrite their own row
// into states only a reviewer should produce.
//
// The one that matters: status = 'approved'. That drops the row out of the
// staff queue (js/admin-queue.js selects .in('status', ['pending',
// 'ticket_open'])) and makes it world-readable, because "Public can view
// approved revisions" is FOR SELECT USING (status = 'approved') and anon holds
// SELECT on the table. Unreviewed content, publicly visible, gone from
// moderation.
//
// WHAT THIS FILE CANNOT REACH: whether Postgres actually refuses the write.
// Playwright never touches real Postgres here - every auth spec mocks the
// Supabase client - so the policy is asserted against the migration text and
// probed for real against a preview branch. See the supabase-migration skill
// and the PR's owner section. These tests keep the policy and the client from
// drifting apart; they are not evidence the database enforces anything.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SQL = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations',
  '20260827000000_author_update_guard.sql'), 'utf8');

// The two policies both carry a WITH CHECK, so every assertion below has to say
// WHICH one it means. Splitting on the CREATE POLICY headers is enough here and
// keeps the regexes readable.
function policyBody(name) {
  const start = SQL.indexOf(`CREATE POLICY "${name}"`);
  expect(start, `the ${name} policy exists`).toBeGreaterThan(-1);
  const after = SQL.slice(start + 1);
  const next = after.indexOf('CREATE POLICY ');
  return next === -1 ? after : after.slice(0, next);
}

const UPDATE_POLICY = () => policyBody('Authors can update own pending revisions');
const INSERT_POLICY = () => policyBody('Guests can submit revisions');

// The WITH CHECK half only - USING carries its own status list, and asserting
// against the whole body would pass on the wrong one.
function withCheckOf(body) {
  const at = body.indexOf('WITH CHECK');
  expect(at, 'the policy has a WITH CHECK').toBeGreaterThan(-1);
  return body.slice(at);
}

// --- THE HOLE THAT WAS OPEN ---

test('an author cannot write a reviewer verdict onto their own row', () => {
  const check = withCheckOf(UPDATE_POLICY());

  // Positive form: pull the allow-list out and state exactly what it is.
  // "does not contain 'approved'" would also pass on a policy that had been
  // deleted, or on one whose status clause was dropped altogether.
  const list = check.match(/"status"\s+IN\s*\(([^)]*)\)/);
  expect(list, 'the WITH CHECK constrains status at all').not.toBeNull();

  const allowed = list[1].split(',').map(s => s.trim().replace(/'/g, ''));
  expect(allowed.sort(), 'exactly the three an author legitimately produces')
    .toEqual(['pending', 'ticket_open', 'withdrawn']);

  // Said again in the terms of the bug, because the list above could be
  // "corrected" by someone who did not know why it was short.
  expect(allowed, "'approved' is a reviewer's verdict").not.toContain('approved');
  expect(allowed, "so is 'rejected'").not.toContain('rejected');
});

test('an author cannot move their revision onto a restricted page', () => {
  // The INSERT policy always gated page_id against page_permissions; UPDATE
  // never did, so the gate was bypassable in two steps - insert against an open
  // page, then move the row.
  expect(withCheckOf(UPDATE_POLICY()))
    .toMatch(/"public"\."can_submit_to_page"\("page_id"\)/);
});

test('the soft ban reaches UPDATE, but never blocks a withdrawal', () => {
  const check = withCheckOf(UPDATE_POLICY());

  // IS DISTINCT FROM, not <>: get_my_role() is NULL for a signed-in user with
  // no role, and `NULL <> 'viewer'` is NULL rather than true - the obvious
  // operator would deny every ordinary contributor.
  expect(check).toMatch(/IS DISTINCT FROM 'viewer'/);
  expect(check, 'never <> against get_my_role()').not.toMatch(/get_my_role"\(\)\s*<>/);

  // The escape hatch is the point: a banned author retracting their own pending
  // work is a de-escalation, and blocking it strands the row in the queue with
  // nobody able to pull it.
  expect(check, 'withdrawal survives the ban')
    .toMatch(/IS DISTINCT FROM 'viewer'::text\s*\r?\n?\s*OR "status" = 'withdrawn'/);
});

test('USING still refuses to reopen a closed record', () => {
  // Carried over from 20260802000000 and easy to lose in a rewrite: the author
  // may only touch a row that is still open. WITH CHECK decides what it becomes;
  // USING decides whether they may start at all.
  const body = UPDATE_POLICY();
  const using = body.slice(body.indexOf('USING'), body.indexOf('WITH CHECK'));
  const list = using.match(/"status"\s+IN\s*\(([^)]*)\)/);
  expect(list, 'USING constrains which rows are reachable').not.toBeNull();

  const reachable = list[1].split(',').map(s => s.trim().replace(/'/g, ''));
  expect(reachable.sort()).toEqual(['pending', 'ticket_open']);
});

// --- THE HALF THAT MUST NOT HAVE CHANGED ---

test('the INSERT policy keeps all three of its gates', () => {
  // This migration rewrites the INSERT policy purely to share the extracted
  // helper. A behaviour change here would be a regression smuggled in beside a
  // security fix, which is the worst place to put one.
  const check = withCheckOf(INSERT_POLICY());
  expect(check, 'ownership').toMatch(/"auth"\."uid"\(\) = "author_id"/);
  expect(check, 'the viewer soft ban').toMatch(/IS DISTINCT FROM 'viewer'/);
  expect(check, 'and the page gate, now via the helper')
    .toMatch(/"public"\."can_submit_to_page"\("page_id"\)/);
});

test('both policies gate the page through ONE definition', () => {
  // The reason the helper exists. Two copies of this predicate is exactly the
  // shape of v0.16 bug 6 - a rule restated per caller, which then drifts.
  const uses = SQL.match(/"public"\."can_submit_to_page"\("page_id"\)/g) || [];
  expect(uses.length, 'used by the INSERT policy and the UPDATE policy').toBe(2);

  // And it is built on the ladder rather than naming roles, so F12's rename
  // does not have to find it.
  expect(SQL, 'the helper compares ranks')
    .toMatch(/role_rank"\("public"\."get_my_role"\(\)\)\s*>=\s*"public"\."role_rank"\("pp"\."required_role"\)/);
});

test('the helper is not left exposed to anonymous callers', () => {
  const fn = '"public"\\."can_submit_to_page"\\("text"\\)';
  expect(SQL).toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC`));
  expect(SQL).toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${fn} FROM "anon"`));
  expect(SQL).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${fn} TO "authenticated"`));
  expect(SQL, 'and it pins its search_path').toMatch(/SET "search_path" TO 'public'/);
});

// --- THE OTHER DIRECTION ---

test('every status the client writes as the author is one the policy allows', () => {
  // A consistency check only finds drift in the direction it looks. Everything
  // above asks "is the policy strict enough"; this asks "is it strict about the
  // wrong things" - a policy that refuses something the UI actually does would
  // fail silently, because PostgREST returns 0 rows updated and no error.
  const submissions = fs.readFileSync(path.join(ROOT, 'js', 'submissions.js'), 'utf8');

  const allowed = withCheckOf(UPDATE_POLICY())
    .match(/"status"\s+IN\s*\(([^)]*)\)/)[1]
    .split(',').map(s => s.trim().replace(/'/g, ''));

  // submissions.js is the contributor's own page - every status it sets is set
  // as the author, which is exactly the set this policy governs.
  const written = [...submissions.matchAll(/\.update\(\{\s*status:\s*'([a-z_]+)'/g)]
    .map(m => m[1]);

  expect(written.length, 'the page sets at least one status, or this proves nothing')
    .toBeGreaterThan(0);
  for (const status of written) {
    expect(allowed, `js/submissions.js writes '${status}' as the author`).toContain(status);
  }
});
