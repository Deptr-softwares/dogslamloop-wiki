// A revision's page_id is text on admin.html, everywhere it is shown.
//
// page_id is whatever the submitter sent: the editor fills it from the URL, and
// a direct REST insert can send anything that passes the INSERT policy, which
// until 2026-10-29 was any id without a page_permissions row. admin.html wrote
// it into innerHTML unescaped in five places (the group title, the MERGE
// TICKETS button's inline onclick, the card badge, the preview status line and
// the merge compiler title), and the queue draws itself as soon as staff open
// the page. So a page_id written as markup ran in a reviewer's, an admin's or
// the owner's browser with their powers. Closed in the database the same day
// (20261029000000_pending_revision_page_id_format.sql); this is the client half.
//
// Three of the five upper-case the id, which breaks a `window...` handler but
// not markup written to survive it, so the test counts elements rather than
// relying on a handler firing.
const { test, expect } = require('@playwright/test');

const EVIL = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';

const rev = (id, minutes) => ({
  id, page_id: EVIL, page_type: 'character', status: 'pending', author_id: 'u-author',
  author_name: 'Someone', created_at: new Date(Date.parse('2026-10-29T10:00:00Z') + minutes * 60000).toISOString(),
  is_delta: true, target_scope: 'overview', target_key: 'full', delta_payload: [],
  qa_metadata: {}, supporters: [], opposers: [], ticket_chat: [],
});
const ROWS = [rev('00000000-0000-4000-8000-000000000001', 0), rev('00000000-0000-4000-8000-000000000002', 1)];

async function openQueue(page) {
  await page.addInitScript((rows) => {
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (!lib || !lib.createClient || lib.__patched) return;
        lib.__patched = true;
        const orig = lib.createClient.bind(lib);
        lib.createClient = (...args) => {
          const client = orig(...args);
          client.auth.getSession = async () => ({ data: { session: { user: { id: 'u-staff', email: 'staff@example.com' }, access_token: 'tok' } } });
          const thenable = (result) => {
            const chain = {
              select() { return chain; }, eq() { return chain; }, in() { return chain; }, order() { return chain; },
              single: async () => result, maybeSingle: async () => result,
              then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
            };
            return chain;
          };
          client.from = (table) => {
            if (table === 'user_roles') return thenable({ data: [{ role: 'admin' }], error: null });
            if (table === 'pending_revisions') return thenable({ data: rows.map(r => ({ ...r })), error: null });
            if (table === 'page_data') return thenable({ data: null, error: { code: 'PGRST116', message: 'no rows' } });
            return thenable({ data: [], error: null });
          };
          return client;
        };
      },
    });
  }, ROWS);
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#queue-container .update-log-item')).toHaveCount(2, { timeout: 15000 });
}

const injected = (page, scope) => page.evaluate(sel => document.querySelectorAll(`${sel} img`).length, scope);

test('a crafted page_id is text in the queue, and MERGE TICKETS still opens the compiler for it', async ({ page }) => {
  await openQueue(page);

  expect(await injected(page, '#queue-container'), 'no element was made from the page_id').toBe(0);
  await expect(page.locator('.admin-queue-group-title')).toHaveText(EVIL.replace(/_/g, ' '));
  await expect(page.locator('#queue-container .badge-page-id').first()).toHaveText(EVIL.toUpperCase());

  await page.locator('.admin-merge-btn').click();
  await expect(page.locator('#compiler-modal-overlay')).toBeVisible();
  await expect(page.locator('#compiler-char-name')).toHaveText(EVIL.toUpperCase());
  expect(await injected(page, '#compiler-modal-overlay')).toBe(0);

  expect(await page.evaluate(() => window.__xss || 0)).toBe(0);
});

test('a crafted page_id is text in the preview status line', async ({ page }) => {
  await openQueue(page);
  await page.locator('#queue-container .admin-review-btn').first().click();

  await expect(page.locator('#preview-status-text')).toContainText(EVIL.toUpperCase());
  expect(await injected(page, '#preview-status-text')).toBe(0);
  expect(await page.evaluate(() => window.__xss || 0)).toBe(0);
});
