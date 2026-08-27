// v0.16 feature 4: reset the Free Submit Tier List.
//
// A game update changes the balance and the community's ranking becomes a
// record of a version nobody plays. This clears it so the ranking rebuilds.
//
// It is DESTRUCTIVE and IRREVERSIBLE - the individual votes are the raw
// material of the median, so there is no aggregate to recompute them from -
// which is what most of these tests are actually about: that it asks first,
// that cancelling really does nothing, and that the caller check is inside the
// function rather than left to the page being RBAC-gated.
//
// WHAT THIS FILE CANNOT REACH: whether the RPC's own permission check fires.
// Playwright never touches Postgres here, so the guard is asserted against the
// migration text and probed live after the release - see the supabase-migration
// skill and the PR's owner section.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SQL = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations',
  '20260825000002_reset_free_submit_tier_list.sql'), 'utf8');

// The statements alone. The file's own commentary explains why this is a DELETE
// and not a TRUNCATE, which is exactly the word a naive regex then finds - the
// first version of the test below failed on its own migration's prose.
const STATEMENTS = SQL.split(/\r?\n/).filter(l => !l.trim().startsWith('--')).join('\n');

// --- THE GUARD, READ FROM THE MIGRATION ---

test('the caller check is inside the function, before it deletes anything', () => {
  // The order matters and is the whole reason this is asserted rather than
  // assumed: a check after the DELETE is not a check.
  const guardAt = SQL.indexOf("IS DISTINCT FROM 'admin'");
  const deleteAt = SQL.indexOf('DELETE FROM "public"."free_submit_votes"');
  expect(guardAt, 'the guard exists').toBeGreaterThan(-1);
  expect(deleteAt, 'and so does the delete').toBeGreaterThan(-1);
  expect(guardAt, 'the guard comes first').toBeLessThan(deleteAt);

  expect(SQL, 'and refuses with 42501, not a silent no-op').toMatch(/ERRCODE = '42501'/);
  // IS DISTINCT FROM, not <>: get_my_role() is NULL for a signed-in user with
  // no role, and `NULL <> 'admin'` is NULL rather than true, so the obvious
  // operator would let every roleless account through.
  expect(SQL, 'never <> against get_my_role()').not.toMatch(/get_my_role"\(\)\s*<>/);
});

test('it is not left exposed to anonymous callers', () => {
  // Creating a function grants EXECUTE to PUBLIC. This project has already had
  // one unauthenticated privilege escalation from exactly that default.
  const fn = /"public"\."reset_free_submit_tier_list"\(\)/;
  expect(SQL).toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${fn.source} FROM PUBLIC`));
  expect(SQL).toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${fn.source} FROM "anon"`));
  expect(SQL).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${fn.source} TO "authenticated"`));
  expect(SQL, 'search_path is pinned on a SECURITY DEFINER function')
    .toMatch(/SET "search_path" TO 'public'/);
});

test('it clears the votes and keeps the scale', () => {
  // free_submit_tiers is the six tiers and their colours - configuration the
  // ranking is expressed in, not the ranking. Clearing it would leave the page
  // with nothing to sort by, and it is not what "reset the list" means.
  expect(STATEMENTS).toMatch(/DELETE FROM "public"\."free_submit_votes"/);
  expect(STATEMENTS, 'the tier scale is never deleted')
    .not.toMatch(/DELETE FROM "public"\."free_submit_tiers"/);
  expect(STATEMENTS, 'DELETE rather than TRUNCATE, which would lock out every voter')
    .not.toMatch(/TRUNCATE/);
});

// --- THE OWNER TOOL ---

async function ownerPage(page, { rpc } = {}) {
  const calls = [];
  await page.addInitScript((cfg) => {
    window.__rpcCalls = [];
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          const orig = lib.createClient.bind(lib);
          lib.createClient = (...args) => {
            const client = orig(...args);
            client.auth.getSession = async () => ({
              data: { session: { user: { id: 'u-admin', email: 'a@b.c' }, access_token: 't' } },
            });
            const origRpc = client.rpc.bind(client);
            client.rpc = (name, params) => {
              window.__rpcCalls.push(name);
              if (name === 'reset_free_submit_tier_list') {
                return Promise.resolve(cfg.rpc || { data: 'Cleared 412 votes from the Free Submit Tier List.', error: null });
              }
              return origRpc(name, params);
            };
            const origFrom = client.from.bind(client);
            client.from = (table) => {
              if (table === 'user_roles') {
                return { select() { return this; }, eq: async () => ({ data: [{ role: 'owner' }], error: null }) };
              }
              return origFrom(table);
            };
            lib.__patched = true;
            return client;
          };
        }
      },
    });
  }, { rpc });

  await page.goto('/owner.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  // The real nav button, not the function behind it: the group is "tierlists"
  // and driving the control is what proves the card is reachable at all.
  await page.locator('.owner-nav-btn[data-group="tierlists"]').click();
  await page.waitForTimeout(400);
  return calls;
}

const rpcCalls = (page) => page.evaluate(() => window.__rpcCalls || []);

test('it asks before it deletes, and cancelling calls nothing', async ({ page }) => {
  // The half that matters most. A destructive control that fires on the first
  // click is the bug, not the button.
  await ownerPage(page);

  await page.locator('#btn-reset-free-submit').click();
  await page.waitForTimeout(300);

  const modalOpen = await page.evaluate(() =>
    !document.getElementById('admin-confirm-modal').classList.contains('hidden'));
  expect(modalOpen, 'the site confirm modal opened').toBe(true);

  const asked = await page.evaluate(() =>
    document.getElementById('admin-confirm-msg').textContent);
  expect(asked, 'and names the consequence').toMatch(/cannot be undone/i);
  expect(asked, 'and says what survives').toMatch(/tier scale|settings/i);

  expect(await rpcCalls(page), 'nothing has been called yet')
    .not.toContain('reset_free_submit_tier_list');

  await page.locator('#btn-admin-confirm-cancel').click();
  await page.waitForTimeout(300);
  expect(await rpcCalls(page), 'and cancelling calls nothing at all')
    .not.toContain('reset_free_submit_tier_list');
});

test('confirming calls the RPC and reports how many votes went', async ({ page }) => {
  // The other direction - a confirmation that never proceeds is not a
  // confirmation - and the count, because "done" on a destructive action tells
  // the owner nothing about whether it did what they meant.
  await ownerPage(page);

  await page.locator('#btn-reset-free-submit').click();
  await page.waitForTimeout(250);
  await page.locator('#btn-admin-confirm-ok').click();
  await page.waitForTimeout(500);

  expect(await rpcCalls(page)).toContain('reset_free_submit_tier_list');
  const said = await page.evaluate(() =>
    document.getElementById('fs-reset-results').textContent);
  expect(said, 'the row count from the function reaches the owner').toContain('412');
});

test('a failure is reported, not swallowed', async ({ page }) => {
  await ownerPage(page, { rpc: { data: null, error: { message: 'permission denied', code: '42501' } } });

  await page.locator('#btn-reset-free-submit').click();
  await page.waitForTimeout(250);
  await page.locator('#btn-admin-confirm-ok').click();
  await page.waitForTimeout(500);

  const said = await page.evaluate(() =>
    document.getElementById('fs-reset-results').textContent);
  expect(said).toMatch(/failed|permission denied/i);
  // And the button is usable again rather than left disabled on the error path.
  await expect(page.locator('#btn-reset-free-submit')).toBeEnabled();
});

test('the reset is set apart from Save on the same card', async ({ page }) => {
  // Both are the same size in the same column; without separation the red fill
  // is the only thing between "save my settings" and "delete every vote".
  await ownerPage(page);

  const seen = await page.evaluate(() => {
    const reset = document.getElementById('btn-reset-free-submit');
    const save = document.getElementById('btn-save-free-submit');
    const row = reset.closest('.admin-tool-danger-row');
    return {
      separated: !!row,
      borderTop: row ? getComputedStyle(row).borderTopStyle : null,
      gap: Math.round(reset.getBoundingClientRect().top - save.getBoundingClientRect().bottom),
    };
  });

  expect(seen.separated, 'it sits in its own row').toBe(true);
  expect(seen.borderTop, 'with a rule above it').toBe('dashed');
  expect(seen.gap, 'and real distance from SAVE SETTINGS').toBeGreaterThan(24);
});
