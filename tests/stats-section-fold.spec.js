// "1. STATS & FRAME DATA" can be folded away (owner's wishlist, 2026-10-18:
// "Scrolling all the way up with an extra length is exhausting if done
// repeatedly"). Folded or not is remembered on the device, so it stays folded
// from one move to the next and across a reload.
const { test, expect } = require('@playwright/test');

const FRAME = {
  m1s: [], specials: [],
  skills: [
    { id: 'one', name: 'Move One', stats: [{ label: 'Damage', value: '10' }] },
    { id: 'two', name: 'Move Two', stats: [{ label: 'Damage', value: '12' }] },
  ],
};

function mockEditor(page) {
  return page.addInitScript((frame) => {
    const rowsFor = (table) => {
      if (table === 'page_data') return { data: { page_id: 'boomcat', desc_data: { overview: [] }, frame_data: JSON.parse(JSON.stringify(frame)) }, error: null };
      if (['user_roles', 'site_settings', 'page_permissions', 'pending_revisions'].includes(table)) return { data: null, error: null };
      return { data: [], error: null };
    };
    const builder = (table) => {
      const result = rowsFor(table);
      const chain = {
        select() { return chain; }, eq() { return chain; }, in() { return chain; },
        order() { return chain; }, limit() { return chain; },
        single: async () => result, maybeSingle: async () => result,
        then: (res) => Promise.resolve(result).then(res),
      };
      return chain;
    };
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          lib.createClient = () => ({
            auth: {
              getSession: async () => ({ data: { session: { user: { id: 'c-1', email: 'c@b.c' }, access_token: 't' } } }),
              onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
              signOut: async () => ({}),
            },
            from: builder,
            rpc: async () => ({ data: null, error: null }),
            storage: { from: () => ({ list: async () => ({ data: [], error: null }) }) },
          });
          lib.__patched = true;
        }
      },
    });
  }, FRAME);
}

async function openSkills(page) {
  await page.goto('/edit.html?char=boomcat&type=character&tab=skills', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.editor-stats-fold')).toBeVisible({ timeout: 45000 });
}

test('the section folds, stays folded on the next move and after a reload, and unfolds', async ({ page }) => {
  await mockEditor(page);
  await openSkills(page);

  const target = page.locator('#daw-editor-target');
  const fold = page.locator('.editor-stats-fold');
  await expect(target).toBeVisible();
  await expect(page.locator('#move-stats-container')).toBeVisible();

  await fold.click();
  await expect(target).toBeHidden();
  await expect(fold).toHaveText('EXPAND');
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  // The strategy section under it is still there to edit.
  await expect(page.locator('#strategy-block-target')).toBeVisible();

  // The next move opens folded too.
  await page.locator('[data-move-load="two"]').click();
  await expect(page.locator('.editor-section-banner-text').first()).toContainText('Move Two');
  await expect(page.locator('#daw-editor-target')).toBeHidden();

  // And so does the editor after a reload, on this device. Switching moves
  // saved a local draft, which would otherwise open the restore prompt first.
  await page.evaluate(() => Object.keys(localStorage)
    .filter(k => k.startsWith('wiki_draft_')).forEach(k => localStorage.removeItem(k)));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.editor-stats-fold')).toBeVisible({ timeout: 45000 });
  await expect(page.locator('#daw-editor-target')).toBeHidden();

  await page.locator('.editor-stats-fold').click();
  await expect(page.locator('#daw-editor-target')).toBeVisible();
  await expect(page.locator('.editor-stats-fold')).toHaveText('COLLAPSE');
});
