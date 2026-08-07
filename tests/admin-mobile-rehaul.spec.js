// Coverage for v0.8's mobile admin rehaul. admin.html shares edit.html's
// two-pane .editor-layout shell, and several parts of the reviewer workflow
// had never had a mobile rule written for them at all - confirmed on a real
// 375px viewport before these fixes: the ticket workspace's two columns
// collapsed to ~150px each, PAGE HISTORY (a 4th button added to the version
// toggle bar in v0.6) hung off the right edge of the screen unreachable, and
// the header burned four full-width button rows before any queue content.
//
// admin.html's RBAC gate replaces document.body.innerHTML wholesale on auth
// failure (js/admin-core.js kickUser), so every test here has to mock a valid
// staff session first or the markup under test is destroyed before it can be
// measured - same client-patching approach as admin-rbac-retry.spec.js.
const { test, expect } = require('@playwright/test');

const MOBILE = { width: 375, height: 812 };

async function mockStaffSession(page) {
  await page.addInitScript(() => {
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
              data: { session: { user: { id: 'u1', email: 'staff@example.com' }, access_token: 'tok' } },
            });
            const origFrom = client.from.bind(client);
            client.from = (table) => {
              if (table === 'user_roles') {
                const result = { data: [{ role: 'admin' }], error: null };
                const chain = {
                  select() { return chain; },
                  eq() { return chain; },
                  single: () => Promise.resolve({ data: { role: 'admin' }, error: null }),
                  then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
                };
                return chain;
              }
              if (table === 'pending_revisions') {
                const chain = {
                  select() { return chain; },
                  in() { return chain; },
                  eq() { return chain; },
                  order: () => Promise.resolve({ data: [], error: null }),
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
  });
}

async function gotoAdminMobile(page) {
  await mockStaffSession(page);
  await page.setViewportSize(MOBILE);
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#queue-container')).toBeAttached();
}

test('real bug fix: the ticket workspace stacks vertically on mobile instead of splitting into two ~150px columns', async ({ page }) => {
  await gotoAdminMobile(page);
  // The ticket workspace lives inside the preview pane, which is display:none
  // on mobile until SHOW PREVIEW is tapped - without this the elements measure
  // 0x0 and any layout assertion passes vacuously.
  await page.evaluate(() => {
    window.toggleMobilePreview();
    document.getElementById('ticket-workspace').classList.remove('hidden');
  });

  const result = await page.evaluate(() => {
    const ws = document.querySelector('.ticket-workspace');
    const left = document.querySelector('.ticket-left-col').getBoundingClientRect();
    const right = document.querySelector('.ticket-right-col').getBoundingClientRect();
    return {
      flexDirection: getComputedStyle(ws).flexDirection,
      leftBottom: left.bottom,
      rightTop: right.top,
      leftWidth: left.width,
    };
  });

  expect(result.flexDirection).toBe('column');
  // The property alone isn't proof - assert the columns genuinely occupy
  // separate vertical bands and each gets real width, which is what actually
  // made the chat log readable again.
  expect(result.rightTop).toBeGreaterThanOrEqual(result.leftBottom);
  expect(result.leftWidth).toBeGreaterThan(250);
});

test('real bug fix: version-toggle button labels stay readable on mobile instead of being clipped by their own button', async ({ page }) => {
  await gotoAdminMobile(page);
  await page.evaluate(() => {
    window.toggleMobilePreview();
    document.getElementById('version-toggle-bar').classList.remove('hidden');
  });

  const result = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('#version-toggle-bar .version-toggle-btn'));
    return {
      // Flex shrinks the buttons to fit the bar, so their boxes stay in-bounds
      // either way - what actually broke was the LABEL overflowing its own
      // (too-narrow) button, since .btn-sys sets white-space: nowrap.
      clipped: btns.filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.textContent.trim()),
      rows: new Set(btns.map(b => Math.round(b.getBoundingClientRect().top))).size,
    };
  });

  expect(result.clipped).toEqual([]);
  // 4 buttons across 2 rows rather than crushed into 1.
  expect(result.rows).toBe(2);
});

test('the floating BACK TO QUEUE button clears the version-toggle bar instead of covering a button', async ({ page }) => {
  await gotoAdminMobile(page);
  await page.evaluate(() => {
    window.toggleMobilePreview();
    document.getElementById('version-toggle-bar').classList.remove('hidden');
  });

  const result = await page.evaluate(() => {
    const bar = document.getElementById('version-toggle-bar').getBoundingClientRect();
    const back = document.querySelector('.mobile-back-to-editor').getBoundingClientRect();
    return { backBottom: back.bottom, barTop: bar.top };
  });

  // Both are position:fixed near the bottom edge; the back button sits at a
  // higher z-index, so any vertical overlap silently hides a real control
  // (this regressed once when the bar grew from one row to two).
  expect(result.backBottom).toBeLessThanOrEqual(result.barTop);
});

test('real bug fix: a long unbroken JSON diff dump wraps instead of overflowing its container', async ({ page }) => {
  await gotoAdminMobile(page);

  const result = await page.evaluate(() => {
    const wrapper = document.createElement('div');
    wrapper.className = 'diff-stacked-old';
    const pre = document.createElement('pre');
    pre.className = 'diff-stacked-pre old';
    // No whitespace at all - the exact shape a serialized JSON blob takes,
    // and the case a plain <pre> (white-space: pre) refuses to break.
    pre.textContent = 'x'.repeat(300);
    wrapper.appendChild(pre);
    document.body.appendChild(wrapper);

    return { preScrollWidth: pre.scrollWidth, wrapperClientWidth: wrapper.clientWidth };
  });

  expect(result.preScrollWidth).toBeLessThanOrEqual(result.wrapperClientWidth + 1);
});

test('real bug fix: the mobile header collapses to a single row instead of four stacked button rows', async ({ page }) => {
  await gotoAdminMobile(page);

  const height = await page.evaluate(() =>
    document.querySelector('.admin-header-actions-col').getBoundingClientRect().height
  );

  await expect(page.locator('#admin-mobile-menu-toggle')).toBeVisible();
  // Four stacked rows measured ~150-200px before this fix; one row of compact
  // buttons is well under half that.
  expect(height).toBeLessThan(70);
});

test('the mobile header menu opens on click and closes when clicking outside', async ({ page }) => {
  await gotoAdminMobile(page);

  const panel = page.locator('#admin-secondary-actions');
  const toggle = page.locator('#admin-mobile-menu-toggle');

  await expect(panel).toBeHidden();

  await toggle.click();
  await expect(panel).toBeVisible();
  await expect(panel.locator('a', { hasText: 'RECENT CHANGES' })).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  await page.locator('.admin-title').click();
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('desktop header is unchanged: no MENU button, nav links visible directly', async ({ page }) => {
  await mockStaffSession(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  await expect(page.locator('#admin-mobile-menu-toggle')).toBeHidden();
  await expect(page.locator('#admin-secondary-actions')).toBeVisible();
  await expect(page.locator('#admin-secondary-actions a', { hasText: 'HUB' })).toBeVisible();
});
