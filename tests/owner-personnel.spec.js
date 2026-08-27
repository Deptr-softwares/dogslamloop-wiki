// Coverage for v0.10's personnel roster (owner.html + js/owner.js).
//
// Before this, role management was a blind by-email setter: you had to
// already know someone's address, and there was no way to see who held what.
// That was a hard limit rather than a UI gap - user_roles' only SELECT policy
// is "Users can read own role", there is no profiles table, and auth.users is
// not PostgREST-reachable, so no client can enumerate. The roster is backed
// by a new SECURITY DEFINER RPC, list_personnel().
//
// These tests drive the real controls (change a select, click APPLY) rather
// than only asserting the page renders - the post-editor shipped three
// unusable bugs past a render-only test, so interaction coverage is the
// standard here now.
const { test, expect } = require('@playwright/test');

const ROSTER = [
  { user_id: 'u-admin', email: 'owner@example.com', role: 'owner', joined_at: '2026-01-01T00:00:00Z' },
  { user_id: 'u-rev', email: 'reviewer@example.com', role: 'reviewer', joined_at: '2026-02-01T00:00:00Z' },
  { user_id: 'u-te', email: 'editor@example.com', role: 'trusted_editor', joined_at: '2026-03-01T00:00:00Z' },
];

async function mockOwner(page, { roster = ROSTER, sessionUserId = 'u-admin', rpcResult } = {}) {
  await page.addInitScript(({ roster, sessionUserId, rpcResult }) => {
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
              data: { session: { user: { id: sessionUserId, email: 'owner@example.com' }, access_token: 'tok' } },
            });
            const origFrom = client.from.bind(client);
            client.from = (table) => {
              if (table === 'user_roles') {
                return { select() { return this; }, eq: async () => ({ data: [{ role: 'owner' }], error: null }) };
              }
              return origFrom(table);
            };
            client.rpc = async (name, params) => {
              window.__rpcCalls.push({ name, params });
              if (name === 'list_personnel') return { data: roster, error: null };
              if (name === 'assign_role_by_email') {
                return rpcResult || { data: `Successfully SET the role of ${params.target_email}`, error: null };
              }
              return { data: null, error: { message: 'unexpected rpc: ' + name } };
            };
            return client;
          };
          lib.__patched = true;
        }
      },
    });
  }, { roster, sessionUserId, rpcResult });
}

test('the roster lists everyone with a role, most privileged first', async ({ page }) => {
  await mockOwner(page);
  await page.goto('/owner.html', { waitUntil: 'networkidle' });
    // owner.html groups its tools as of v0.11; select the one under test.
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('people'));

  await expect(page.locator('.personnel-row')).toHaveCount(3);
  await expect(page.locator('.personnel-email').first()).toContainText('owner@example.com');
  await expect(page.locator('#personnel-roster')).toContainText('reviewer@example.com');
  await expect(page.locator('#personnel-roster')).toContainText('editor@example.com');

  // The signed-in admin is marked so you can tell which row is you.
  await expect(page.locator('.personnel-self')).toHaveCount(1);
});

test('changing a role calls the RPC with the right email and role', async ({ page }) => {
  await mockOwner(page);
  await page.goto('/owner.html', { waitUntil: 'networkidle' });
    // owner.html groups its tools as of v0.11; select the one under test.
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('people'));

  const row = page.locator('.personnel-row').filter({ hasText: 'reviewer@example.com' });
  // 'contributor' was retired in v0.11 - it gated nothing.
  await row.locator('.personnel-role-select').selectOption('trusted_editor');
  await row.locator('.personnel-apply-btn').click();

  // adminConfirm gates the write.
  await page.locator('#btn-admin-confirm-ok').click();
  await expect.poll(() => page.evaluate(
    () => window.__rpcCalls.filter(c => c.name === 'assign_role_by_email').length
  )).toBe(1);

  const calls = await page.evaluate(() => window.__rpcCalls.filter(c => c.name === 'assign_role_by_email'));
  expect(calls[0].params).toEqual({ target_email: 'reviewer@example.com', assigned_role: 'trusted_editor' });
});

test('cancelling the confirm makes no change', async ({ page }) => {
  await mockOwner(page);
  await page.goto('/owner.html', { waitUntil: 'networkidle' });
    // owner.html groups its tools as of v0.11; select the one under test.
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('people'));

  const row = page.locator('.personnel-row').filter({ hasText: 'editor@example.com' });
  await row.locator('.personnel-apply-btn').click();
  await page.locator('#btn-admin-confirm-cancel').click();
  // Kept deliberately: this asserts nothing ever happens, and there is no
  // event for "still hasn't". A bounded window is the honest tool for a
  // negative - polling can only wait for something to appear.
  await page.waitForTimeout(200);

  const calls = await page.evaluate(() => window.__rpcCalls.filter(c => c.name === 'assign_role_by_email'));
  expect(calls).toHaveLength(0);
});

test('the only owner cannot demote themselves out of the site', async ({ page }) => {
  // Losing the last admin locks everyone out of owner.html permanently - the
  // only recovery is direct database access.
  await mockOwner(page, {
    roster: [
      { user_id: 'u-admin', email: 'owner@example.com', role: 'owner', joined_at: '2026-01-01T00:00:00Z' },
      { user_id: 'u-rev', email: 'reviewer@example.com', role: 'reviewer', joined_at: '2026-02-01T00:00:00Z' },
    ],
  });
  await page.goto('/owner.html', { waitUntil: 'networkidle' });
    // owner.html groups its tools as of v0.11; select the one under test.
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('people'));

  const adminRow = page.locator('.personnel-row').filter({ hasText: 'owner@example.com' });
  await expect(adminRow.locator('.personnel-apply-btn')).toBeDisabled();
  await expect(adminRow.locator('.personnel-role-select')).toBeDisabled();

  // A second admin makes demotion safe again.
  await mockOwner(page, {
    roster: [
      ...ROSTER,
      { user_id: 'u-admin2', email: 'second@example.com', role: 'owner', joined_at: '2026-04-01T00:00:00Z' },
    ],
  });
  await page.goto('/owner.html', { waitUntil: 'networkidle' });
    // owner.html groups its tools as of v0.11; select the one under test.
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('people'));
  const firstAdmin = page.locator('.personnel-row').filter({ hasText: 'owner@example.com' });
  await expect(firstAdmin.locator('.personnel-apply-btn')).toBeEnabled();
});

test('roster values are escaped, including the RPC error path', async ({ page }) => {
  await mockOwner(page, {
    roster: [{
      user_id: 'u-x',
      email: '<img src=x onerror="window.__xss=1">@example.com',
      role: 'reviewer',
      joined_at: '2026-01-01T00:00:00Z',
    }],
    rpcResult: { data: null, error: { message: '<script>window.__xss2=1</script>' } },
  });

  await page.goto('/owner.html', { waitUntil: 'networkidle' });
    // owner.html groups its tools as of v0.11; select the one under test.
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('people'));
  // Wait for the roster to render, then check what it rendered AS.
  await expect(page.locator('#personnel-roster')).not.toBeEmpty();

  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  const rosterHtml = await page.locator('#personnel-roster').innerHTML();
  expect(rosterHtml).not.toContain('<img src=x');
  expect(rosterHtml).toContain('&lt;img');

  // And the error branch, which interpolates error.message.
  await page.locator('.personnel-apply-btn').click();
  await page.locator('#btn-admin-confirm-ok').click();
  await expect(page.locator('#role-results')).not.toBeEmpty();
  expect(await page.evaluate(() => window.__xss2)).toBeUndefined();
  const resultsHtml = await page.locator('#role-results').innerHTML();
  expect(resultsHtml).not.toContain('<script>');
});

test('a failed roster load reports the error instead of rendering an empty roster', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          const orig = lib.createClient.bind(lib);
          lib.createClient = (...args) => {
            const client = orig(...args);
            client.auth.getSession = async () => ({ data: { session: { user: { id: 'u1' }, access_token: 't' } } });
            const origFrom = client.from.bind(client);
            client.from = (table) => table === 'user_roles'
              ? { select() { return this; }, eq: async () => ({ data: [{ role: 'owner' }], error: null }) }
              : origFrom(table);
            client.rpc = async () => ({ data: null, error: { message: 'permission denied for function list_personnel' } });
            return client;
          };
          lib.__patched = true;
        }
      },
    });
  });

  await page.goto('/owner.html', { waitUntil: 'networkidle' });
    // owner.html groups its tools as of v0.11; select the one under test.
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('people'));
  await expect(page.locator('#personnel-roster')).toContainText('Could not load the roster');
  await expect(page.locator('#personnel-roster')).toContainText('permission denied');
});

// --- PAGE RESTRICTIONS ---
// page_permissions had no write path at all before v0.10, and required_role
// was decorative: both gates only asked "is this page listed?" and then
// required admin-or-trusted_editor. A column named required_role that nothing
// reads is worse than no column, because it looks like configuration.

const PERMISSIONS = [
  { page_id: 'template', required_role: 'trusted_editor' },
  { page_id: 'tierlist', required_role: 'trusted_editor' },
];

async function mockPermissions(page, { rows = PERMISSIONS, writeError = null } = {}) {
  await page.addInitScript(({ rows, writeError }) => {
    window.__writes = [];
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
              data: { session: { user: { id: 'u-admin' }, access_token: 'tok' } },
            });
            const origFrom = client.from.bind(client);
            client.from = (table) => {
              if (table === 'user_roles') {
                return { select() { return this; }, eq: async () => ({ data: [{ role: 'owner' }], error: null }) };
              }
              if (table === 'page_permissions') {
                const chain = {
                  select() { return chain; },
                  order: async () => ({ data: rows, error: null }),
                  upsert(payload) { window.__writes.push({ op: 'upsert', payload }); return Promise.resolve({ error: writeError }); },
                  delete() { return { eq: (col, val) => { window.__writes.push({ op: 'delete', val }); return Promise.resolve({ error: writeError }); } }; },
                };
                return chain;
              }
              return origFrom(table);
            };
            client.rpc = async () => ({ data: [], error: null });
            return client;
          };
          lib.__patched = true;
        }
      },
    });
  }, { rows, writeError });
}

test('restricted pages are listed with the clearance they require', async ({ page }) => {
  await mockPermissions(page);
  await page.goto('/owner.html', { waitUntil: 'networkidle' });
    // owner.html groups its tools as of v0.11; select the one under test.
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('pages'));

  await expect(page.locator('#permissions-list .personnel-row')).toHaveCount(2);
  await expect(page.locator('#permissions-list')).toContainText('template');
  await expect(page.locator('#permissions-list')).toContainText('Trusted Editor');
});

test('raising a page to admin-only writes required_role, not just the page id', async ({ page }) => {
  await mockPermissions(page);
  await page.goto('/owner.html', { waitUntil: 'networkidle' });
    // owner.html groups its tools as of v0.11; select the one under test.
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('pages'));

  const row = page.locator('#permissions-list .personnel-row').filter({ hasText: 'template' });
  await row.locator('.personnel-role-select').selectOption('admin');
  await row.locator('.permission-apply-btn').click();
  await page.locator('#btn-admin-confirm-ok').click();
  await expect.poll(() => page.evaluate(() => window.__writes.length)).toBe(1);

  const writes = await page.evaluate(() => window.__writes);
  expect(writes[0].op).toBe('upsert');
  expect(writes[0].payload[0]).toEqual({ page_id: 'template', required_role: 'admin' });
});

test('unrestricting a page deletes its row, and is confirmed first', async ({ page }) => {
  await mockPermissions(page);
  await page.goto('/owner.html', { waitUntil: 'networkidle' });
    // owner.html groups its tools as of v0.11; select the one under test.
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('pages'));

  const row = page.locator('#permissions-list .personnel-row').filter({ hasText: 'tierlist' });
  await row.locator('.permission-remove-btn').click();
  await page.locator('#btn-admin-confirm-cancel').click();
  // Kept deliberately: this asserts nothing ever happens, and there is no
  // event for "still hasn't". A bounded window is the honest tool for a
  // negative - polling can only wait for something to appear.
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__writes)).toHaveLength(0);

  await row.locator('.permission-remove-btn').click();
  await page.locator('#btn-admin-confirm-ok').click();
  await expect.poll(() => page.evaluate(() => window.__writes.length)).toBe(1);

  const writes = await page.evaluate(() => window.__writes);
  expect(writes[0]).toEqual({ op: 'delete', val: 'tierlist' });
});

test('the restrict dropdown excludes pages that are already restricted', async ({ page }) => {
  await mockPermissions(page);
  await page.goto('/owner.html', { waitUntil: 'networkidle' });
    // owner.html groups its tools as of v0.11; select the one under test.
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('pages'));
  await expect.poll(() => page.evaluate(() =>
    document.querySelectorAll('#permission-page option').length
  )).toBeGreaterThan(0);

  const values = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#permission-page option')).map(o => o.value));

  // Offering an already-restricted page would let you create a confusing
  // duplicate-looking entry; offering a free-text field would let you create
  // a row for a page id that does not exist, silently locking nothing.
  expect(values).not.toContain('template');
  expect(values).not.toContain('tierlist');
  expect(values.length).toBeGreaterThan(0);
  expect(values).toContain('boomcat');
});

test('an empty restriction list says so rather than looking broken', async ({ page }) => {
  await mockPermissions(page, { rows: [] });
  await page.goto('/owner.html', { waitUntil: 'networkidle' });
    // owner.html groups its tools as of v0.11; select the one under test.
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('pages'));
  await expect(page.locator('#permissions-list')).toContainText('No pages are restricted');
});

test('an undeployed RPC reads as "not deployed yet", not as raw Postgres jargon', async ({ page }) => {
  // The normal state between deploying code and merging the migration.
  // PostgREST's own text ("Could not find the function public.list_personnel
  // without parameters in the schema cache") reads like a crash to anyone who
  // is not holding the schema in their head.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          const orig = lib.createClient.bind(lib);
          lib.createClient = (...args) => {
            const client = orig(...args);
            client.auth.getSession = async () => ({ data: { session: { user: { id: 'u1' }, access_token: 't' } } });
            const origFrom = client.from.bind(client);
            client.from = (table) => table === 'user_roles'
              ? { select() { return this; }, eq: async () => ({ data: [{ role: 'owner' }], error: null }) }
              : origFrom(table);
            client.rpc = async () => ({
              data: null,
              error: {
                code: 'PGRST202',
                message: 'Could not find the function public.list_personnel without parameters in the schema cache',
              },
            });
            return client;
          };
          lib.__patched = true;
        }
      },
    });
  });

  await page.goto('/owner.html', { waitUntil: 'networkidle' });
    // owner.html groups its tools as of v0.11; select the one under test.
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('people'));
  await expect(page.locator('#personnel-roster')).toContainText("hasn't been deployed");
  await expect(page.locator('#personnel-roster')).not.toContainText('schema cache');
});
