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

test('media deletion stays with the owner', async () => {
  // The only irreversible action on the site, and not on the list of what an
  // admin may do. Preserving today's behaviour means the owner keeps it; an
  // admin who should have it gets the per-user flag, which is what it is for.
  expect(STATEMENTS).toMatch(/\(ur\.role = 'owner'\) OR ur\.can_delete_media/);
});
