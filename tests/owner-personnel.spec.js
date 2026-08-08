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
  { user_id: 'u-admin', email: 'owner@example.com', role: 'admin', joined_at: '2026-01-01T00:00:00Z' },
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
                return { select() { return this; }, eq: async () => ({ data: [{ role: 'admin' }], error: null }) };
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

  const row = page.locator('.personnel-row').filter({ hasText: 'reviewer@example.com' });
  await row.locator('.personnel-role-select').selectOption('contributor');
  await row.locator('.personnel-apply-btn').click();

  // adminConfirm gates the write.
  await page.locator('#btn-admin-confirm-ok').click();
  await page.waitForTimeout(300);

  const calls = await page.evaluate(() => window.__rpcCalls.filter(c => c.name === 'assign_role_by_email'));
  expect(calls).toHaveLength(1);
  expect(calls[0].params).toEqual({ target_email: 'reviewer@example.com', assigned_role: 'contributor' });
});

test('cancelling the confirm makes no change', async ({ page }) => {
  await mockOwner(page);
  await page.goto('/owner.html', { waitUntil: 'networkidle' });

  const row = page.locator('.personnel-row').filter({ hasText: 'editor@example.com' });
  await row.locator('.personnel-apply-btn').click();
  await page.locator('#btn-admin-confirm-cancel').click();
  await page.waitForTimeout(200);

  const calls = await page.evaluate(() => window.__rpcCalls.filter(c => c.name === 'assign_role_by_email'));
  expect(calls).toHaveLength(0);
});

test('the only admin cannot demote themselves out of the site', async ({ page }) => {
  // Losing the last admin locks everyone out of owner.html permanently - the
  // only recovery is direct database access.
  await mockOwner(page, {
    roster: [
      { user_id: 'u-admin', email: 'owner@example.com', role: 'admin', joined_at: '2026-01-01T00:00:00Z' },
      { user_id: 'u-rev', email: 'reviewer@example.com', role: 'reviewer', joined_at: '2026-02-01T00:00:00Z' },
    ],
  });
  await page.goto('/owner.html', { waitUntil: 'networkidle' });

  const adminRow = page.locator('.personnel-row').filter({ hasText: 'owner@example.com' });
  await expect(adminRow.locator('.personnel-apply-btn')).toBeDisabled();
  await expect(adminRow.locator('.personnel-role-select')).toBeDisabled();

  // A second admin makes demotion safe again.
  await mockOwner(page, {
    roster: [
      ...ROSTER,
      { user_id: 'u-admin2', email: 'second@example.com', role: 'admin', joined_at: '2026-04-01T00:00:00Z' },
    ],
  });
  await page.goto('/owner.html', { waitUntil: 'networkidle' });
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
  await page.waitForTimeout(300);

  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  const rosterHtml = await page.locator('#personnel-roster').innerHTML();
  expect(rosterHtml).not.toContain('<img src=x');
  expect(rosterHtml).toContain('&lt;img');

  // And the error branch, which interpolates error.message.
  await page.locator('.personnel-apply-btn').click();
  await page.locator('#btn-admin-confirm-ok').click();
  await page.waitForTimeout(300);
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
              ? { select() { return this; }, eq: async () => ({ data: [{ role: 'admin' }], error: null }) }
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
  await expect(page.locator('#personnel-roster')).toContainText('Could not load the roster');
  await expect(page.locator('#personnel-roster')).toContainText('permission denied');
});
