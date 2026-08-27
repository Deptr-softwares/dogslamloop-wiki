// v0.17 F12 pass 2: `owner` becomes a real role and `admin` becomes a rank
// beneath it.
//
//   owner 5 · admin 4 · reviewer 3 · trusted_editor 2 · viewer 1 · (none) 0
//
// Until now "admin" meant the site owner. The split exists because a second
// staff member is joining: the owner keeps the owner tools, the admin works the
// queue. The owner's rule, 2026-08-27: "The new admin should not get the owner
// tool access at all."
//
// The failure this file is really guarding against is the QUIET one. Every site
// that still compares against 'admin' after the rename is asking the wrong
// question, and most of them fail OPEN - the new admin silently gains something
// nobody granted. Pass 1 shipped believing it had swept them all and had found
// roughly half, because it grepped for ARRAY[...] and fifteen policies used
// plain equality.
//
// WHAT PLAYWRIGHT CANNOT REACH: whether Postgres enforces any of it. The SQL
// half is asserted against migration text and probed live after the release.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SQL = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations',
  '20260827000003_owner_role.sql'), 'utf8');
// Comments stripped: this migration talks ABOUT the old comparison in prose,
// and v0.16 already lost a round to a migration's own commentary.
const STATEMENTS = SQL.split(/\r?\n/).filter(l => !l.trim().startsWith('--')).join('\n');

async function loadLadder(page) {
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.rolesMeet === 'function', { timeout: 45000 });
}

// --- THE TWO LADDERS ---

test('the JS ladder and the SQL ladder carry the same numbers', async ({ page }) => {
  await loadLadder(page);
  const js = await page.evaluate(() => ({
    owner: window.roleRank('owner'), admin: window.roleRank('admin'),
    reviewer: window.roleRank('reviewer'), trusted_editor: window.roleRank('trusted_editor'),
    viewer: window.roleRank('viewer'),
  }));

  expect(js.owner, 'the owner is above the admin').toBeGreaterThan(js.admin);
  expect(js.admin).toBeGreaterThan(js.reviewer);
  expect(js.reviewer).toBeGreaterThan(js.trusted_editor);
  expect(js.trusted_editor).toBeGreaterThan(js.viewer);

  // Two ladders that disagree are worse than the literals they replaced,
  // because the interface would promise access the database refuses.
  for (const [role, rank] of Object.entries(js)) {
    expect(STATEMENTS, `SQL ranks ${role} as ${rank}`)
      .toMatch(new RegExp(`WHEN '${role}'\\s+THEN ${rank}`));
  }
});

test('an admin does not clear the owner bar, and the owner clears every bar', async ({ page }) => {
  await loadLadder(page);
  const seen = await page.evaluate(() => {
    const out = {};
    for (const r of ['owner', 'admin', 'reviewer', 'trusted_editor', 'viewer', null]) {
      out[String(r)] = {
        owner: window.roleMeets(r, 'owner'),
        admin: window.roleMeets(r, 'admin'),
        reviewer: window.roleMeets(r, 'reviewer'),
      };
    }
    return out;
  });

  // The whole point of the split.
  expect(seen.admin.owner, 'an admin gets NO owner-tool access').toBe(false);
  expect(seen.reviewer.owner).toBe(false);
  expect(seen.null.owner).toBe(false);

  // And the half that is easy to break while doing it: the owner must keep
  // everything the admin has, or the split demotes the person who made it.
  expect(seen.owner.owner).toBe(true);
  expect(seen.owner.admin, 'the owner keeps every admin power').toBe(true);
  expect(seen.owner.reviewer, 'and every reviewer power').toBe(true);
  expect(seen.admin.reviewer, 'an admin still outranks a reviewer').toBe(true);
});

test('rolesMeet reads the array shape the pages actually hold', async ({ page }) => {
  await loadLadder(page);
  const seen = await page.evaluate(() => ({
    owner: window.rolesMeet(['owner'], 'owner'),
    adminAtOwnerBar: window.rolesMeet(['admin'], 'owner'),
    adminAtAdminBar: window.rolesMeet(['admin'], 'admin'),
    empty: window.rolesMeet([], 'reviewer'),
    missing: window.rolesMeet(undefined, 'reviewer'),
    ownerAtAdminBar: window.rolesMeet(['owner'], 'admin'),
  }));

  expect(seen.owner).toBe(true);
  expect(seen.adminAtOwnerBar, 'the gate every owner page depends on').toBe(false);
  expect(seen.adminAtAdminBar).toBe(true);
  expect(seen.ownerAtAdminBar).toBe(true);
  // Both must be false rather than throwing: these are read straight off a
  // failed query, where undefined is the normal shape.
  expect(seen.empty).toBe(false);
  expect(seen.missing).toBe(false);
});

// --- THE MIGRATION ---

test('both CHECK constraints learn the new value', async () => {
  expect(STATEMENTS, 'user_roles accepts owner').toMatch(/'owner'::text/);
  expect(STATEMENTS, 'and still accepts admin, which is a real role now')
    .toMatch(/user_roles_role_check[\s\S]*?'admin'::text/);
  expect(STATEMENTS, 'page_permissions can require owner')
    .toMatch(/page_permissions_required_role_check[\s\S]*?'owner'::text/);
});

test('the hub pages are moved AFTER the constraint that allows it', async () => {
  // Order is the whole risk here. Updating the rows first fails against the old
  // constraint; the migration would roll back and take everything with it.
  const check = STATEMENTS.indexOf('ADD CONSTRAINT "page_permissions_required_role_check"');
  const update = STATEMENTS.indexOf('UPDATE "public"."page_permissions"');
  expect(check, 'the widened constraint exists').toBeGreaterThan(-1);
  expect(update, 'and so does the data move').toBeGreaterThan(-1);
  expect(check, 'constraint first, data second').toBeLessThan(update);
});

test('the three hub pages do not silently widen to the new admin', async () => {
  // Read off production 2026-08-26: main-hub, character-hub and systems-hub all
  // carry required_role = 'admin', which TODAY means the owner alone. Left
  // alone, they would hand all three to the new admin on the day it exists -
  // data, not policy, so no policy test would notice.
  expect(STATEMENTS).toMatch(
    /UPDATE "public"\."page_permissions"\s*\n\s*SET "required_role" = 'owner'\s*\n\s*WHERE "required_role" = 'admin'/);
});

test('the owner tools moved, and their refusals stopped saying admin', async () => {
  const tools = ['assign_role_by_email', 'list_personnel', 'anonymize_user_by_email',
    'set_user_capability', 'assign_tier_list', 'list_tier_lists', 'reset_free_submit_tier_list'];

  for (const fn of tools) {
    const at = STATEMENTS.indexOf(`"public"."${fn}"`);
    expect(at, `${fn} is redefined here`).toBeGreaterThan(-1);
  }
  // Seven tools, one guard each, plus the four equality-form sites found later.
  const guards = STATEMENTS.match(/IF NOT "public"\."is_owner"\(\)/g) || [];
  expect(guards.length, 'every owner tool is gated on is_owner()').toBe(7);

  // The message is not cosmetic: a real admin reading "only an admin may do
  // this" after being refused would reasonably file a bug.
  expect(STATEMENTS, 'refusals name the owner').toMatch(/only the owner may/);
  expect(STATEMENTS, 'and never the role that no longer means it')
    .not.toMatch(/only an admin(istrator)? (can|may)/);
});

test('the last-owner guard counts OWNERS', async () => {
  // Found late, and it mattered: anonymize_user_by_email refuses to delete the
  // last account that can still assign roles. It was counting admins. After the
  // rename that is the wrong population - it would happily delete the last
  // owner while protecting an admin who cannot reach the tool at all.
  expect(STATEMENTS).toMatch(/WHERE role = 'owner'\) <= 1/);
  expect(STATEMENTS, 'and checks the target is an owner, not an admin')
    .toMatch(/user_id = target_user_id\) = 'owner'/);
});

test('media deletion belongs to the admin, and keeps its per-user flag', async () => {
  // Corrected by the owner on 2026-08-27, and the correction is a better RULE
  // than the one it replaced: what decides who owns a tool is WHICH PAGE it
  // lives on, not how irreversible it is. The media queue is on admin.html.
  //
  // Asserted against the later migration, because 20260827000003 was already
  // pushed - a preview branch will not re-run a version it has recorded, so
  // this had to be a new file rather than an edit.
  const later = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations',
    '20260827000004_admin_media_deletion.sql'), 'utf8');

  expect(later, 'admin and above').toMatch(
    /role_rank"\(ur\.role\)\s*>=\s*"public"\."role_rank"\('admin'\)/);
  // The flag is not decoration: it is how a REVIEWER, who is below this bar,
  // gets the power one person at a time. A rewrite that dropped it would look
  // correct and quietly revoke every hand-granted deleter.
  expect(later, 'the per-user flag survives').toMatch(/OR ur\.can_delete_media/);
  expect(later, 'and it stays SECURITY DEFINER, since it reads user_roles')
    .toMatch(/SECURITY DEFINER/);
});

// --- THE BADGE ---

test('owner and admin are told apart at a glance', async () => {
  // The account button is the only place a role is shown to the person holding
  // it, and until v0.17 owner and admin were the same role so one icon did.
  //
  // The bug this catches is the MAPPING, not the drawing. An earlier version of
  // this line used roleMeets() and handed the OWNER the admin's shield, because
  // the owner does meet the admin bar - correct for permissions, wrong for
  // identity. Read from source rather than driven, because initAuthDock needs a
  // live session and the thing under test is a lookup table.
  const src = fs.readFileSync(path.join(ROOT, 'js', 'pagebuilder.js'), 'utf8');
  const pairs = [...src.matchAll(/role === '([a-z_]+)'\s*\)\s*\{\s*loginIcon = (svg\w+);\s*dynamicColorClass = "([a-z-]+)"/g)]
    .map(m => ({ role: m[1], icon: m[2], colour: m[3] }));

  expect(pairs.length, 'the mapping was found at all - a regex that matches '
    + 'nothing would satisfy every assertion below').toBeGreaterThanOrEqual(4);

  const byRole = Object.fromEntries(pairs.map(p => [p.role, p]));
  expect(byRole.owner, 'the owner has a badge').toBeTruthy();
  expect(byRole.admin, 'and so does the admin').toBeTruthy();
  expect(byRole.owner.icon, 'different icons').not.toBe(byRole.admin.icon);
  expect(byRole.owner.colour, 'and different colours').not.toBe(byRole.admin.colour);

  // Every badged role has its OWN badge - no two share either half.
  const icons = pairs.map(p => p.icon);
  expect(new Set(icons).size, 'no two roles share an icon').toBe(icons.length);
  const colours = pairs.map(p => p.colour);
  expect(new Set(colours).size, 'nor a colour').toBe(colours.length);
});

test('the crown is a crown, not a box with a line through it', async () => {
  // The old icon was a zigzag over a full-height rectangle, which at 1.2rem
  // read as a treasure chest - the box dominated the silhouette. The redraw is
  // three peaks with real dips and a separate thin band.
  const src = fs.readFileSync(path.join(ROOT, 'js', 'pagebuilder.js'), 'utf8');
  const owner = src.match(/const svgOwner = `([^`]+)`/);
  expect(owner, 'svgOwner exists').toBeTruthy();

  // Three peaks and two dips means the outline path has seven points before it
  // closes. Counting them is what distinguishes a crown from a zigzag.
  const points = (owner[1].match(/[ML]\s*[\d.]+\s*[\d.]+/g) || []).length;
  expect(points, 'seven points: base, peak, dip, peak, dip, peak, base')
    .toBeGreaterThanOrEqual(7);
  expect(owner[1], 'and the outline closes into a shape').toMatch(/Z/);
  expect(owner[1], 'the old full-height box is gone')
    .not.toMatch(/h20v11/);
});
