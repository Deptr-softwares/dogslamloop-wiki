// Coverage for v0.10's page management (owner.html + js/owner.js).
//
// Creating a page used to require three things by hand: a nav entry in
// data/navigation.json, a physical HTML file, and optionally a page_data row.
// site_pages replaces the first two - an insert here becomes a nav entry and
// a stub on the next regeneration run.
const { test, expect } = require('@playwright/test');

// sort_order mirrors the live seed's spacing of 10. The character list is
// ordered by in-game release - full characters first, then base-only ones -
// so inserting in the middle is the normal case, not an edge case.
const PAGES = [
  { page_id: 'vessel', name: 'Vessel', url: 'characters/Vessel/index.html', category: 'Characters', page_type: 'character', status: 'live', sort_order: 0 },
  { page_id: 'boomcat', name: 'Boomcat', url: 'characters/Boomcat/index.html', category: 'Characters', page_type: 'character', status: 'live', sort_order: 10 },
  { page_id: 'locust_guy', name: 'Locust Guy', url: 'characters/Locust_guy/index.html', category: 'Characters', page_type: 'character', status: 'live', sort_order: 20 },
  { page_id: 'old_thing', name: 'Old Thing', url: 'systems/old-thing/index.html', category: 'Guides', page_type: 'system', status: 'archived', sort_order: 0 },
];

async function mockPages(page, { rows = PAGES, insertError = null } = {}) {
  await page.addInitScript(({ rows, insertError }) => {
    window.__pageWrites = [];
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          const orig = lib.createClient.bind(lib);
          lib.createClient = (...args) => {
            const client = orig(...args);
            client.auth.getSession = async () => ({ data: { session: { user: { id: 'u-admin' }, access_token: 't' } } });
            const origFrom = client.from.bind(client);
            client.from = (table) => {
              if (table === 'user_roles') {
                return { select() { return this; }, eq: async () => ({ data: [{ role: 'admin' }], error: null }) };
              }
              if (table === 'site_pages') {
                let orderCalls = 0;
                const chain = {
                  select() { return chain; },
                  eq() { return chain; },
                  // The next-sort-order lookup ends in .limit().
                  limit() { return Promise.resolve({ data: [{ sort_order: 90 }], error: null }); },
                  order() {
                    orderCalls++;
                    // The listing query chains .order() twice, then awaits.
                    return orderCalls >= 2
                      ? Promise.resolve({ data: rows, error: null })
                      : chain;
                  },
                  insert(payload) {
                    window.__pageWrites.push({ op: 'insert', payload });
                    return Promise.resolve({ error: insertError });
                  },
                  update(payload) {
                    return {
                      eq: (col, val) => {
                        window.__pageWrites.push({ op: 'update', payload, val });
                        return Promise.resolve({ error: null });
                      },
                    };
                  },
                };
                return chain;
              }
              if (table === 'page_permissions') {
                return { select() { return this; }, order: async () => ({ data: [], error: null }) };
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
  }, { rows, insertError });
}

test('derivePageIdentity builds the folder convention each page type uses', async ({ page }) => {
  await mockPages(page);
  await page.goto('/owner.html', { waitUntil: 'networkidle' });

  const results = await page.evaluate(() => ({
    character: window.derivePageIdentity('Crow Charmer', 'character'),
    system: window.derivePageIdentity('M1 Trading', 'system'),
    punctuation: window.derivePageIdentity('Vessel’s Guide!', 'character'),
    empty: window.derivePageIdentity('!!!', 'character'),
  }));

  // Characters live in Capitalized_snake folders, system pages in
  // lower-hyphen ones - matching what buildPageUrl and the generator expect.
  expect(results.character).toEqual({
    pageId: 'crow_charmer', url: 'characters/Crow_charmer/index.html', navId: 'Crow-Charmer',
  });
  expect(results.system).toEqual({
    pageId: 'm1_trading', url: 'systems/m1-trading/index.html', navId: 'M1-Trading',
  });
  expect(results.punctuation.pageId).toBe('vessels_guide');
  // A name with no usable characters must not silently produce a page at
  // characters//index.html.
  expect(results.empty).toBeNull();
});

test('creating a page inserts a complete registry row', async ({ page }) => {
  await mockPages(page);
  await page.goto('/owner.html', { waitUntil: 'networkidle' });

  await page.fill('#new-page-name', 'Crow Charmer');
  await page.selectOption('#new-page-type', 'character');
  await page.selectOption('#new-page-category', 'Characters');
  await page.click('#btn-create-page');
  await page.locator('#btn-admin-confirm-ok').click();
  await page.waitForTimeout(300);

  const writes = await page.evaluate(() => window.__pageWrites.filter(w => w.op === 'insert'));
  expect(writes).toHaveLength(1);
  const row = writes[0].payload[0];
  expect(row.page_id).toBe('crow_charmer');
  expect(row.url).toBe('characters/Crow_charmer/index.html');
  expect(row.category).toBe('Characters');
  expect(row.page_type).toBe('character');
  // New pages start flagged WIP rather than presenting an empty page as
  // finished, and land at the end of their category.
  expect(row.is_wip).toBe(true);
  expect(row.sort_order).toBe(30);
});

test('the create form previews the URL before you commit to it', async ({ page }) => {
  await mockPages(page);
  await page.goto('/owner.html', { waitUntil: 'networkidle' });

  await page.fill('#new-page-name', 'Crow Charmer');
  await expect(page.locator('#new-page-preview')).toContainText('characters/Crow_charmer/index.html');
});

test('a duplicate page reports the collision in plain language', async ({ page }) => {
  await mockPages(page, { insertError: { message: 'duplicate key value violates unique constraint "site_pages_url_key"' } });
  await page.goto('/owner.html', { waitUntil: 'networkidle' });

  await page.fill('#new-page-name', 'Boomcat');
  await page.click('#btn-create-page');
  await page.locator('#btn-admin-confirm-ok').click();
  await page.waitForTimeout(300);

  await expect(page.locator('#pages-results')).toContainText('already exists at that address');
  await expect(page.locator('#pages-results')).not.toContainText('unique constraint');
});

test('archiving sets status rather than deleting the row', async ({ page }) => {
  // An archived page keeps a tombstone stub so existing links and Discord
  // embeds resolve instead of 404ing - deletion would break them.
  await mockPages(page);
  await page.goto('/owner.html', { waitUntil: 'networkidle' });

  const row = page.locator('#pages-list .personnel-row').filter({ hasText: 'Boomcat' });
  await row.locator('.page-archive-btn').click();
  await page.locator('#btn-admin-confirm-ok').click();
  await page.waitForTimeout(300);

  const writes = await page.evaluate(() => window.__pageWrites.filter(w => w.op === 'update'));
  expect(writes).toHaveLength(1);
  expect(writes[0].payload.status).toBe('archived');
  expect(writes[0].val).toBe('boomcat');
});

test('an archived page offers restore instead of archive', async ({ page }) => {
  await mockPages(page);
  await page.goto('/owner.html', { waitUntil: 'networkidle' });

  const row = page.locator('#pages-list .personnel-row').filter({ hasText: 'Old Thing' });
  await expect(row.locator('.page-restore-btn')).toBeVisible();
  await expect(row.locator('.page-archive-btn')).toHaveCount(0);
});

// --- ORDERING ---
// The character list is not alphabetical: it mirrors in-game release order,
// full characters before base-only ones. So releasing a new full character
// means inserting it between the last full character and the first base-only
// one - the middle, not the end.

test('a new page can be inserted after a chosen sibling, not just appended', async ({ page }) => {
  await mockPages(page);
  await page.goto('/owner.html', { waitUntil: 'networkidle' });

  // Slot the new character in after Vessel (0), before Boomcat (10).
  await page.fill('#new-page-name', 'Crow Charmer');
  await page.selectOption('#new-page-position', 'vessel');
  await page.click('#btn-create-page');
  await page.locator('#btn-admin-confirm-ok').click();
  await page.waitForTimeout(300);

  const writes = await page.evaluate(() => window.__pageWrites.filter(w => w.op === 'insert'));
  const row = writes[0].payload[0];
  // Midpoint of the 0/10 gap, so it sorts between them.
  expect(row.sort_order).toBeGreaterThan(0);
  expect(row.sort_order).toBeLessThan(10);
});

test('the position dropdown lists only siblings in the chosen category', async ({ page }) => {
  await mockPages(page);
  await page.goto('/owner.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  let values = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#new-page-position option')).map(o => o.value));
  expect(values).toContain('vessel');
  expect(values).toContain('boomcat');
  // Old Thing is in Guides, not Characters.
  expect(values).not.toContain('old_thing');

  await page.selectOption('#new-page-category', 'Guides');
  await page.waitForTimeout(200);
  values = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#new-page-position option')).map(o => o.value));
  expect(values).toContain('old_thing');
  expect(values).not.toContain('vessel');
});

test('an exhausted gap renumbers the category instead of colliding', async ({ page }) => {
  // Repeated insertions in the same spot eventually close the gap. Returning
  // a duplicate or fractional sort_order there would quietly corrupt the
  // ordering, so the category is respaced first.
  await mockPages(page, {
    rows: [
      { page_id: 'a', name: 'A', url: 'characters/A/index.html', category: 'Characters', page_type: 'character', status: 'live', sort_order: 0 },
      { page_id: 'b', name: 'B', url: 'characters/B/index.html', category: 'Characters', page_type: 'character', status: 'live', sort_order: 1 },
    ],
  });
  await page.goto('/owner.html', { waitUntil: 'networkidle' });

  await page.fill('#new-page-name', 'Between');
  await page.selectOption('#new-page-position', 'a');
  await page.click('#btn-create-page');
  await page.locator('#btn-admin-confirm-ok').click();
  await page.waitForTimeout(400);

  const writes = await page.evaluate(() => window.__pageWrites);
  const renumbers = writes.filter(w => w.op === 'update' && w.payload.sort_order !== undefined);
  const insert = writes.find(w => w.op === 'insert');

  // B moves from 1 to 10, opening a real gap, and the new page lands inside it.
  expect(renumbers.length).toBeGreaterThan(0);
  expect(insert.payload[0].sort_order).toBe(5);
});

test('move up swaps a page with its neighbour', async ({ page }) => {
  await mockPages(page);
  await page.goto('/owner.html', { waitUntil: 'networkidle' });

  const row = page.locator('#pages-list .personnel-row').filter({ hasText: 'Boomcat' });
  await row.locator('.page-move-btn[data-dir="up"]').click();
  await page.waitForTimeout(400);

  const writes = await page.evaluate(() => window.__pageWrites.filter(w => w.op === 'update'));
  // Boomcat (10) and Vessel (0) exchange positions.
  expect(writes).toHaveLength(2);
  const byPage = Object.fromEntries(writes.map(w => [w.val, w.payload.sort_order]));
  expect(byPage.boomcat).toBe(0);
  expect(byPage.vessel).toBe(10);
});

test('move does nothing at the boundaries', async ({ page }) => {
  await mockPages(page);
  await page.goto('/owner.html', { waitUntil: 'networkidle' });

  // Vessel is first in Characters - there is nothing above it.
  const first = page.locator('#pages-list .personnel-row').filter({ hasText: 'Vessel' });
  await first.locator('.page-move-btn[data-dir="up"]').click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__pageWrites.filter(w => w.op === 'update'))).toHaveLength(0);
});
