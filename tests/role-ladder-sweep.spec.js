// v0.17 F12, pass 1: every literal role list rewritten against the ladder.
//
// The sweep itself is a no-op - role_rank('reviewer') is 3 and the only roles at
// or above it today are reviewer and admin, so the new predicate is exactly the
// old ARRAY['admin','reviewer']. What these tests protect is the property that
// makes pass 2 (renaming `admin` to `owner` and reusing `admin` beneath it)
// survivable: NO LIVE POLICY MAY NAME A ROLE.
//
// The important test is the first one, and it is deliberately not a list of the
// eleven sites that were swept. It recomputes which policies are live across
// every migration and asserts the property over all of them, so a new policy
// written next month with a literal list fails here rather than silently
// becoming the thing pass 2 misses.
//
// WHAT PLAYWRIGHT CANNOT REACH: whether Postgres agrees. RLS is invisible to
// this suite - see the supabase-migration skill - so the preview branch and the
// production probes are what actually verify the rewrite. These tests keep the
// text honest.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIG_DIR = path.join(ROOT, 'supabase', 'migrations');
const files = fs.readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).sort();
const SWEEP = fs.readFileSync(path.join(MIG_DIR, '20260827000001_role_ladder_sweep.sql'), 'utf8');

// A membership test against role NAMES. role_rank('reviewer') is an argument,
// not a list, and must not match.
const LITERAL_LIST = /ARRAY\s*\[\s*'(admin|reviewer|trusted_editor|viewer|owner)'/;

// Replay every migration in order and keep only what is still standing.
// Identity is (policy name, table): the same name on two tables is two policies.
function livePolicies() {
  const live = new Map();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIG_DIR, f), 'utf8');
    const events = [];
    const drop = /DROP POLICY IF EXISTS\s+"([^"]+)"\s+ON\s+"public"\."([^"]+)"/g;
    const create = /CREATE POLICY\s+"([^"]+)"\s+ON\s+"public"\."([^"]+)"/g;
    let m;
    while ((m = drop.exec(sql))) events.push({ at: m.index, kind: 'drop', name: m[1], table: m[2] });
    while ((m = create.exec(sql))) {
      const end = sql.indexOf(';', m.index);
      events.push({
        at: m.index, kind: 'create', name: m[1], table: m[2],
        text: sql.slice(m.index, end === -1 ? sql.length : end + 1), file: f,
      });
    }
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      const key = `${e.table}::${e.name}`;
      if (e.kind === 'drop') live.delete(key);
      else live.set(key, e);
    }
  }
  return live;
}

// Same replay for functions - last CREATE OR REPLACE wins.
function liveFunctions() {
  const live = new Map();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIG_DIR, f), 'utf8');
    const re = /CREATE OR REPLACE FUNCTION\s+"public"\."([^"]+)"/g;
    let m;
    while ((m = re.exec(sql))) {
      const end = sql.indexOf('$$;', m.index);
      live.set(m[1], {
        name: m[1], file: f,
        text: sql.slice(m.index, end === -1 ? sql.length : end + 3),
      });
    }
  }
  return live;
}

// --- THE INVARIANT ---

test('no live policy names a role', async () => {
  const offenders = [...livePolicies().values()]
    .filter(p => LITERAL_LIST.test(p.text))
    .map(p => `${p.table}."${p.name}" (${p.file})`);

  expect(offenders,
    'a policy naming a role is the thing that breaks when admin is renamed - '
    + 'write it as role_rank(...) >= role_rank(...) or is_staff()').toEqual([]);
});

test('no live function tests a role by name', async () => {
  const allowed = new Set([
    // The ladder itself. Its whole job is to map names to ranks, so the names
    // must appear here and nowhere else.
    'role_rank',
  ]);

  const offenders = [...liveFunctions().values()]
    .filter(f => !allowed.has(f.name))
    .filter(f => LITERAL_LIST.test(f.text) || /IN\s*\(\s*'trusted_editor'/.test(f.text))
    .map(f => `${f.name}() (${f.file})`);

  expect(offenders).toEqual([]);
});

// Added 2026-08-27, after the test above missed four sites.
//
// It looked for `= ANY (ARRAY['admin', ...])`, because that was the shape the
// grep behind pass 1 happened to find. Four functions compared with plain
// EQUALITY instead - `ur.role = 'admin'`, `get_my_role() = 'admin'` - and sailed
// through: can_delete_media, save_tier_list, anonymize_user_by_email's
// last-owner guard, and get_my_role's own tiebreak ordering.
//
// Two of those mattered a lot. can_delete_media would have moved the only
// irreversible action on the site from the owner to the new admin, and the
// last-owner guard would have stopped protecting the last owner - it was still
// counting admins.
//
// This checks for 'admin' specifically rather than every role name. 'owner' is
// the new correct thing to compare against; 'viewer' is a soft BAN, which is
// genuinely a name and not a rank, and free_submit_eligibility and
// report_discussion_post test it deliberately.
test("nothing still compares against 'admin' except the ladder", async () => {
  const ADMIN_COMPARISON = /(?:=|IS\s+(?:NOT\s+)?DISTINCT\s+FROM)\s*'admin'/;

  const allowed = new Set([
    'role_rank',    // maps the name to a rank; the names live here
    'get_my_role',  // a CASE ordering, not a permission test
  ]);

  const fnOffenders = [...liveFunctions().values()]
    .filter(f => !allowed.has(f.name))
    // Strip -- comments: a migration's own prose about the old comparison is
    // not the comparison. v0.16 lost a round to exactly this.
    .filter(f => ADMIN_COMPARISON.test(f.text.replace(/--[^\n]*/g, ' ')))
    .map(f => `${f.name}() (${f.file})`);

  const policyOffenders = [...livePolicies().values()]
    .filter(p => ADMIN_COMPARISON.test(p.text.replace(/--[^\n]*/g, ' ')))
    .map(p => `${p.table}."${p.name}" (${p.file})`);

  expect([...fnOffenders, ...policyOffenders],
    "after the rename 'admin' is a junior role - anything still comparing "
    + 'against it is asking the wrong question').toEqual([]);
});

test('the sweep covered eleven policies, two of which F5 has since taken over', async () => {
  // A count, so that "no offenders" cannot pass by the replay above finding
  // nothing at all - a broken parser would report a clean schema.
  const live = livePolicies();
  expect(live.size, 'the replay found policies to check').toBeGreaterThan(15);

  const swept = [...live.values()].filter(p => p.file === '20260827000001_role_ladder_sweep.sql');

  // Was 11. v0.17 F5 (20260903000001_page_experts.sql) re-scoped the two
  // pending_revisions queue policies from is_staff() to can_review_page(page_id),
  // so the sweep is no longer the migration that defines them. Their names are
  // deliberately unchanged - renaming would orphan the sweep's DROP statements
  // and leave the page-blind versions standing alongside the new ones, and two
  // policies on one table are ORed, so the old one would silently win.
  expect(swept.length, 'nine still defined by the sweep').toBe(9);

  const queue = [...live.values()].filter(p => p.table === 'pending_revisions'
    && ['Staff can manage queue', 'Staff can view queue'].includes(p.name));
  expect(queue.length, 'and both queue policies are still live, exactly once each').toBe(2);
  for (const p of queue) {
    expect(p.file, 'now owned by the expert migration').toBe('20260903000001_page_experts.sql');
    expect(p.text, 'and scoped to the page rather than page-blind')
      .toMatch(/can_review_page"\("page_id"\)/);
  }
});

// --- THE ONE THAT MUST NOT COME BACK ---

test('"Staff can moderate discussions" is NOT recreated', async () => {
  // It looks like a twelfth site and is not a site at all: 20260813000001
  // dropped it deliberately, because a policy can constrain which rows change
  // but not WHAT changes - leaving it would leave staff able to rewrite a
  // contributor's post body. Recreating it with tidier role logic would hand
  // back the exact power v0.14 removed.
  const live = livePolicies();
  expect(live.has('page_discussions::Staff can moderate discussions'),
    'moderation goes through the RPC, not a blanket UPDATE policy').toBe(false);

  expect(SWEEP, 'and this migration does not create it')
    .not.toMatch(/CREATE POLICY "Staff can moderate discussions"/);

  // The replacement read policy is what should be standing.
  expect(live.has('page_discussions::Anyone can read visible discussions')).toBe(true);
});

// --- THE BARS THAT ARE NOT THE SAME BAR ---

test('the cooldown bypass stays at trusted_editor, not reviewer', async () => {
  // Bending this to is_staff() would silently take the bypass away from every
  // trusted editor. Different perk, different bar, and the sweep must not
  // flatten the two.
  const fn = liveFunctions().get('check_revision_rate_limit');
  expect(fn, 'the trigger is still defined').toBeTruthy();
  expect(fn.text).toMatch(/role_rank\('trusted_editor'\)/);
  // Matched WITHOUT the parens: the call is written "public"."is_staff"(), so a
  // /is_staff\(\)/ pattern never matches it and this negative assertion would
  // have passed on a function that had been promoted.
  expect(fn.text, 'and it is not quietly promoted to the staff bar')
    .not.toMatch(/is_staff/);
});

test('can_moderate keeps the per-user flag that is its reason to exist', async () => {
  // The OR is the whole function: it grants thread moderation to somebody who
  // is not staff at all. A rewrite that kept only the role half would look
  // correct and quietly revoke every hand-granted moderator.
  const fn = liveFunctions().get('can_moderate');
  expect(fn.text, 'built on the ladder now').toMatch(/"is_staff"\(\)/);
  expect(fn.text, 'and still reads the capability column').toMatch(/ur\.can_moderate/);
  expect(fn.text, 'still SECURITY DEFINER, because it reads user_roles')
    .toMatch(/SECURITY DEFINER/);
});

// --- THE HELPER ---

test('is_staff is executable by the readers whose policies call it', async () => {
  expect(SWEEP).toMatch(/REVOKE ALL ON FUNCTION "public"\."is_staff"\(\) FROM PUBLIC/);
  // anon is required, not optional: "Anyone can read published tier lists" is a
  // SELECT policy with no TO clause, so it is evaluated for every reader, and a
  // visitor who cannot execute this gets an error instead of a tier list.
  expect(SWEEP, 'anon reads tier lists').toMatch(/GRANT EXECUTE ON FUNCTION "public"\."is_staff"\(\) TO "anon"/);
  expect(SWEEP).toMatch(/GRANT EXECUTE ON FUNCTION "public"\."is_staff"\(\) TO "authenticated"/);
  expect(SWEEP, 'and it pins its search_path').toMatch(/SET "search_path" TO 'public'/);
});

test('is_staff means reviewer-and-above, by rank', async () => {
  const fn = liveFunctions().get('is_staff');
  expect(fn.text).toMatch(/role_rank"\("public"\."get_my_role"\(\)\)\s*>=\s*"public"\."role_rank"\('reviewer'\)/);
  // Not SECURITY DEFINER: it reads nothing RLS protects, and get_my_role() is
  // already definer on its own.
  expect(fn.text, 'least privilege - no definer where none is needed')
    .not.toMatch(/SECURITY DEFINER/);
});
