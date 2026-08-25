// v0.16 bug 6: a reviewer never received the Trusted Editor perks it was
// decided they have.
//
// The decision reached exactly one of three places:
//
//   cooldown bypass          check_revision_rate_limit()    reviewer INCLUDED
//   restricted-page submit   "Guests can submit revisions"  reviewer MISSING
//   vote discount            client-side only               reviewer MISSING
//
// Because every perk tested a LITERAL role name, nothing anywhere stated that a
// reviewer outranks a trusted editor - so granting one perk granted none of the
// others. role_rank() is that statement, and these tests are mostly about the
// ladder being total and correctly ordered, because everything else keys off it.
//
// NOTE ON WHAT PLAYWRIGHT CAN REACH: the SQL half is asserted against the
// migration text, not a database. RLS, GRANTs and policy predicates are
// invisible to this suite - see the supabase-migration skill - so the policy
// itself needs the live probes listed in the PR, and these tests only keep the
// two ladders from drifting apart.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SQL = fs.readFileSync(
  path.join(ROOT, 'supabase', 'migrations', '20260825000001_role_rank.sql'), 'utf8');

async function loadHelpers(page) {
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.roleRank === 'function', { timeout: 45000 });
}

test('the ladder is ordered, and the two copies of it agree', async ({ page }) => {
  await loadHelpers(page);
  const js = await page.evaluate(() => ({
    admin: window.roleRank('admin'),
    reviewer: window.roleRank('reviewer'),
    trusted: window.roleRank('trusted_editor'),
    viewer: window.roleRank('viewer'),
  }));

  expect(js.admin).toBeGreaterThan(js.reviewer);
  expect(js.reviewer, 'the whole point: a reviewer outranks a trusted editor')
    .toBeGreaterThan(js.trusted);
  expect(js.trusted).toBeGreaterThan(js.viewer);

  // The SQL CASE has to carry the same numbers. Two ladders that disagree is
  // worse than the literal lists this replaced, because the interface would
  // then promise access the database refuses.
  for (const [role, rank] of Object.entries({
    admin: js.admin, reviewer: js.reviewer, trusted_editor: js.trusted, viewer: js.viewer,
  })) {
    expect(SQL, `SQL ranks ${role} as ${rank}`)
      .toMatch(new RegExp(`WHEN '${role}'\\s+THEN ${rank}`));
  }
});

test('anything unrecognised ranks zero rather than undefined', async ({ page }) => {
  // Totality is the property that matters. `NULL >= anything` is NULL in SQL,
  // and undefined comparisons are false in JS - either way an unguarded ladder
  // would deny every ordinary contributor, which is the same trap this codebase
  // hits with `<>` against get_my_role().
  await loadHelpers(page);
  const js = await page.evaluate(() => [
    window.roleRank(null), window.roleRank(undefined), window.roleRank(''),
    window.roleRank('nonsense'), window.roleRank('ADMIN'),
  ]);

  expect(js.slice(0, 4), 'null, undefined, empty and unknown all rank 0').toEqual([0, 0, 0, 0]);
  expect(js[4], 'and the ladder is case-insensitive, since roles arrive from a text column')
    .toBe(4);
  expect(SQL, 'the SQL CASE has an ELSE so NULL falls to 0 rather than NULL').toMatch(/ELSE 0/);
});

test('who clears a trusted_editor page, and who clears an admin one', async ({ page }) => {
  await loadHelpers(page);
  const seen = await page.evaluate(() => {
    const roles = ['admin', 'reviewer', 'trusted_editor', 'viewer', null];
    const out = {};
    for (const r of roles) {
      out[String(r)] = {
        trusted: window.roleMeets(r, 'trusted_editor'),
        admin: window.roleMeets(r, 'admin'),
      };
    }
    return out;
  });

  // The fix.
  expect(seen.reviewer.trusted, 'a reviewer can now submit to a trusted_editor page').toBe(true);
  expect(seen.admin.trusted).toBe(true);
  expect(seen.trusted_editor.trusted).toBe(true);
  expect(seen.null.trusted, 'and someone with no role still cannot').toBe(false);
  expect(seen.viewer.trusted, 'nor can a soft-banned viewer').toBe(false);

  // The line worth checking twice: widening the trusted_editor gate must not
  // have widened the admin one.
  expect(seen.reviewer.admin, 'a reviewer does NOT gain admin-restricted pages').toBe(false);
  expect(seen.trusted_editor.admin).toBe(false);
  expect(seen.admin.admin, 'admin still clears its own bar').toBe(true);
});

test('the policy compares ranks rather than naming roles', async ({ page }) => {
  // Asserting the shape positively: "does not contain the old literal" would
  // pass on a policy that had been deleted entirely.
  expect(SQL).toMatch(/CREATE POLICY "Guests can submit revisions"/);
  expect(SQL, 'the gate is a rank comparison')
    .toMatch(/role_rank"\("public"\."get_my_role"\(\)\)\s*>=\s*"public"\."role_rank"\("pp"\."required_role"\)/);
  // Carried over, and load-bearing: NULL <> 'viewer' is NULL, so the obvious
  // operator would deny every ordinary contributor.
  expect(SQL, 'the viewer soft ban survives the rewrite')
    .toMatch(/IS DISTINCT FROM 'viewer'/);
});

test('the function is not left exposed to anonymous callers', async ({ page }) => {
  // Creating a function grants EXECUTE to PUBLIC. This project has already had
  // one unauthenticated privilege escalation from exactly that default.
  expect(SQL).toMatch(/REVOKE ALL ON FUNCTION "public"\."role_rank"\("text"\) FROM PUBLIC/);
  expect(SQL).toMatch(/REVOKE ALL ON FUNCTION "public"\."role_rank"\("text"\) FROM "anon"/);
  expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION "public"\."role_rank"\("text"\) TO "authenticated"/);
  expect(SQL, 'and it pins its search_path').toMatch(/SET "search_path" TO 'public'/);
});
