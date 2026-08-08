// Coverage for v0.11's role changes.
//
// The role list had five values but only three gated anything: a
// 'contributor' and a signed-in user with no role at all had identical
// permissions. 'contributor' is removed, and 'viewer' becomes a real soft
// ban - signed in, can read, cannot submit. Before this the only way to stop
// someone contributing was deleting their account.
const { test, expect } = require('@playwright/test');

test('the owner tools no longer offer a role that does nothing', async ({ request }) => {
  const html = await (await request.get('/owner.html')).text();

  expect(html).not.toContain('Clearance: Contributor');
  expect(html).not.toContain('value="contributor"');
  // And 'viewer' is labelled as what it does, not as a neutral-sounding tier.
  expect(html).toContain('Blocked: cannot submit edits');
});

test('the role labels drop contributor and describe viewer honestly', async ({ page }) => {
  await page.goto('/owner.html', { waitUntil: 'domcontentloaded' });
  const labels = await page.evaluate(() => {
    // ROLE_LABELS is a module-scope const in a classic script.
    try { return typeof ROLE_LABELS !== 'undefined' ? ROLE_LABELS : null; } catch (e) { return null; }
  });

  expect(labels).not.toBeNull();
  expect(Object.keys(labels)).toEqual(['admin', 'reviewer', 'trusted_editor', 'viewer']);
  expect(labels.viewer).toMatch(/blocked/i);
});

test('logged-out visitors are not labelled with the ban role', async ({ page }) => {
  // pagebuilder.js used 'viewer' as its logged-out placeholder. Once 'viewer'
  // means "banned", that default is backwards - harmless today because it
  // only picks a dock icon, but exactly the kind of default that becomes a
  // real bug the first time something gates on it.
  const source = await (await page.request.get('/js/pagebuilder.js')).text();
  expect(source).toContain("let userRole = 'none'");
  expect(source).not.toContain("let userRole = 'viewer'");
});

test('a blocked user is told before filling in the submission form', async ({ page }) => {
  // The database is the real boundary, but hitting it produces an opaque RLS
  // rejection at the very end of the flow - after the QA modal.
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
            client.auth.getSession = async () => ({
              data: { session: { user: { id: 'u-viewer', email: 'blocked@example.com' }, access_token: 't' } },
            });
            const origFrom = client.from.bind(client);
            client.from = (table) => {
              if (table === 'user_roles') {
                return {
                  select() { return this; }, eq() { return this; },
                  maybeSingle: async () => ({ data: { role: 'viewer' }, error: null }),
                };
              }
              return origFrom(table);
            };
            return client;
          };
          lib.__patched = true;
        }
      },
    });
  });

  await page.goto('/edit.html?page=boomcat&type=character&tab=overview', { waitUntil: 'networkidle' });
  await page.locator('#submit-payload-btn').click();
  await page.waitForTimeout(600);

  const alert = page.locator('#editor-alert-modal');
  await expect(alert).toBeVisible();
  await expect(page.locator('#editor-alert-msg')).toContainText("can't submit edits");

  // And the QA modal must not have opened - being stopped after writing a
  // changelog would be worse than being stopped before.
  await expect(page.locator('#dynamic-qa-modal-overlay')).toHaveCount(0);
});

test('an ordinary signed-in user with no role is unaffected', async ({ page }) => {
  // get_my_role() returns NULL for them, which is why the policy uses
  // IS DISTINCT FROM rather than <> - NULL <> 'viewer' is NULL, which would
  // have denied every ordinary contributor.
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
            client.auth.getSession = async () => ({
              // email is required: getDisplayName and editor-core's fallback
              // both do session.user.email.split('@'), so a session without one
              // throws during boot and the submit handler is never attached.
              data: { session: { user: { id: 'u-plain', email: 'plain@example.com' }, access_token: 't' } },
            });
            const origFrom = client.from.bind(client);
            client.from = (table) => {
              if (table === 'user_roles') {
                return {
                  select() { return this; }, eq() { return this; },
                  maybeSingle: async () => ({ data: null, error: null }),
                };
              }
              if (table === 'page_permissions') {
                return {
                  select() { return this; }, eq() { return this; },
                  maybeSingle: async () => ({ data: null, error: null }),
                };
              }
              return origFrom(table);
            };
            return client;
          };
          lib.__patched = true;
        }
      },
    });
  });

  await page.goto('/edit.html?page=boomcat&type=character&tab=overview', { waitUntil: 'networkidle' });
  await page.locator('#submit-payload-btn').click();

  // They should get past the role gate. The QA modal opening is proof.
  // Waited for rather than polled after a fixed delay: this path continues
  // through a sync and a live collision check, so it is legitimately slower
  // than the blocked-user path that returns immediately.
  await expect(page.locator('#dynamic-qa-modal-overlay')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#editor-alert-modal')).toBeHidden();
});

test('the migration keeps existing access unchanged when retiring contributor', async ({ request }) => {
  const sql = await (await request.get('/supabase/migrations/20260808000006_role_cleanup.sql')).text();

  // Deleting the row leaves those users with no role - which is exactly the
  // permission set 'contributor' already granted. Behaviour-preserving by
  // construction rather than by assertion.
  expect(sql).toContain("DELETE FROM \"public\".\"user_roles\" WHERE \"role\" = 'contributor'");
  // The operator this policy's correctness hinges on.
  expect(sql).toContain('IS DISTINCT FROM');
  expect(sql).not.toMatch(/get_my_role\(\)\s*<>\s*'viewer'/);
});
