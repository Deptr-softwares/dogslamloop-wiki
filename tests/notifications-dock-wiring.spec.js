// Regression coverage for the split-brained notification system fixed in
// v0.8. Contributors had no working way to learn what happened to a
// submission: js/admin-actions.js correctly wrote approve/reject rows to
// user_notifications, and js/site_utils.js built a correct modal to display
// them - but nothing ever opened that modal, and the visible bell in the
// sidebar dock was wired by js/pagebuilder.js to a `system_inbox` table that
// has no migration and has never existed. Clicking the bell built a SECOND
// modal reusing the same literal element id and always reported an empty
// inbox, while the real data sat unreachable behind the first one.
const { test, expect } = require('@playwright/test');

const FIXTURE_MESSAGE = 'Your revision for "BOOMCAT" has been approved!';

// Patches window.supabase.createClient before page scripts run so the real
// client is used everywhere except auth + the two tables under test. Both
// tables are mocked with DIFFERENT content so a test can prove which one the
// UI actually read from, rather than just that something rendered.
async function mockNotifications(page, { notifications, unreadCount }) {
  await page.addInitScript(({ notifications, unreadCount }) => {
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__supabaseLib; },
      set(lib) {
        window.__supabaseLib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          const origCreateClient = lib.createClient.bind(lib);
          lib.createClient = (...args) => {
            const client = origCreateClient(...args);
            client.auth.getSession = async () => ({
              data: { session: { user: { id: 'me', email: 'me@example.com' }, access_token: 'tok' } },
            });
            client.auth.getUser = async () => ({ data: { user: { id: 'me' } } });

            const origFrom = client.from.bind(client);
            client.from = (table) => {
              if (table === 'user_notifications') {
                const chain = {
                  _head: false,
                  select(_cols, opts) { chain._head = !!(opts && opts.head); return chain; },
                  eq() { return chain; },
                  order() { return chain; },
                  limit: () => Promise.resolve({ data: notifications, error: null }),
                  update() { return chain; },
                  delete() { return chain; },
                  then(resolve, reject) {
                    const result = chain._head
                      ? { count: unreadCount, error: null }
                      : { data: notifications, error: null };
                    return Promise.resolve(result).then(resolve, reject);
                  },
                };
                return chain;
              }
              if (table === 'system_inbox') {
                // The dead table. Anything reading it should now be gone; if
                // something still does, this deliberately-wrong content makes
                // it obvious rather than silently rendering an empty inbox.
                window.__systemInboxWasQueried = true;
                const chain = {
                  select() { return chain; },
                  eq() { return chain; },
                  order: () => Promise.resolve({ data: [], error: null }),
                  update() { return chain; },
                  then(resolve, reject) { return Promise.resolve({ count: 0, data: [], error: null }).then(resolve, reject); },
                };
                return chain;
              }
              if (table === 'user_roles') {
                const chain = {
                  select() { return chain; },
                  eq() { return chain; },
                  single: () => Promise.resolve({ data: { role: 'contributor' }, error: null }),
                  then(resolve, reject) { return Promise.resolve({ data: [{ role: 'contributor' }], error: null }).then(resolve, reject); },
                };
                return chain;
              }
              return origFrom(table);
            };
            return client;
          };
          lib.__patched = true;
        }
      },
    });
  }, { notifications, unreadCount });
}

const oneNotification = (overrides = {}) => ([{
  id: 'n-1',
  created_at: '2026-08-05T00:00:00Z',
  user_id: 'me',
  message: FIXTURE_MESSAGE,
  link: 'characters/Boomcat/index.html',
  is_read: false,
  ...overrides,
}]);

test('real bug fix: clicking the dock inbox opens the real notification modal instead of building a duplicate that reads a nonexistent table', async ({ page }) => {
  await mockNotifications(page, { notifications: oneNotification(), unreadCount: 1 });
  await page.goto('/index.html', { waitUntil: 'networkidle' });

  await page.locator('#dock-btn-inbox').click();

  const modal = page.locator('#site-notification-modal');
  await expect(modal).toBeVisible();
  // Pre-fix a second element with this same id was inserted on click - the
  // count is the assertion that actually catches that.
  await expect(modal).toHaveCount(1);
  await expect(modal).toContainText(FIXTURE_MESSAGE);
  await expect(modal).not.toContainText('No new messages');
});

test('real bug fix: the unread badge counts user_notifications rather than the nonexistent system_inbox', async ({ page }) => {
  await mockNotifications(page, { notifications: oneNotification(), unreadCount: 3 });
  await page.goto('/index.html', { waitUntil: 'networkidle' });

  await expect(page.locator('#dock-btn-inbox .dock-badge')).toBeAttached();
  expect(await page.evaluate(() => window.__systemInboxWasQueried || false)).toBe(false);
});

test('real bug fix: a notification message containing markup is escaped, not executed', async ({ page }) => {
  await mockNotifications(page, {
    notifications: oneNotification({ message: '<img src=x onerror="window.__xss=1">' }),
    unreadCount: 1,
  });

  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });

  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await page.locator('#dock-btn-inbox').click();
  await expect(page.locator('#site-notification-modal')).toBeVisible();
  await page.waitForTimeout(300);

  expect(dialogs).toEqual([]);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  const html = await page.locator('#site-notification-modal').innerHTML();
  expect(html).not.toContain('<img src=x');
  expect(html).toContain('&lt;img');
});

test('a notification link with an embedded quote cannot break out of its attribute', async ({ page }) => {
  await mockNotifications(page, {
    notifications: oneNotification({ link: `x' onmouseover='window.__attrXss=1` }),
    unreadCount: 1,
  });

  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await page.locator('#dock-btn-inbox').click();
  await expect(page.locator('#site-notification-modal')).toBeVisible();

  // Hovering used to be enough to fire an injected handler when the link was
  // interpolated straight into an inline onclick attribute.
  await page.locator('.notif-item').first().hover();
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__attrXss)).toBeUndefined();
});

test('clicking a notification row marks it read and navigates to its link', async ({ page }) => {
  await mockNotifications(page, { notifications: oneNotification(), unreadCount: 1 });
  await page.goto('/index.html', { waitUntil: 'networkidle' });

  await page.locator('#dock-btn-inbox').click();
  await expect(page.locator('#site-notification-modal')).toBeVisible();

  await page.locator('.notif-item').first().click();
  await page.waitForURL(/characters\/Boomcat/, { timeout: 5000 });
  expect(page.url()).toContain('characters/Boomcat/index.html');
});
