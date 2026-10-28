// The frame data editor's variant rows wrap instead of pushing the workspace
// sideways (owner's board, 2026-10-29: "Fix the overflowing buttons when making
// a new variants/micro variants for the frame data editor").
//
// The variant tabs and an empty variant's three buttons were each one flex
// row that never wrapped, in a workspace that is about 30% of the screen. On a
// 1280px screen the fourth new variant ran the row past the workspace, which
// then scrolled sideways: its left edge was cut off ("ONG MOVE"), the tabs
// squashed onto two lines each, and + ADD VARIANT sat off to the right. The
// owner picked wrapping over scrolling inside the row, so every variant and
// + ADD VARIANT stay in view.
//
// Scoped to these rows: .daw-variant-tabs is also the move row, the system
// section row, the Config tabs and the tier editor's tabs, which scroll.
const { test, expect } = require('@playwright/test');

const FRAME = {
  m1s: [], specials: [],
  skills: [{
    id: 'move', name: 'Long Move', stats: [],
    variants: {
      standard: { label: 'Standard', totalScale: 40, bars: [{ type: 'single', phases: [{ duration: 40, styleClass: 'bg-tick-start', label: 'S' }] }] },
      other: { label: 'Other', totalScale: 40, bars: [{ type: 'single', phases: [{ duration: 40, styleClass: 'bg-tick-recov', label: 'R' }] }] },
    },
  }],
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

async function openMove(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockEditor(page);
  await page.goto('/edit.html?char=boomcat&type=character&tab=skills', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.daw-timeline-wrapper')).toBeVisible({ timeout: 45000 });
}

// Everything in the two rows against the workspace's own box, and whether
// anything between them and the page has been scrolled sideways.
const geometry = (page) => page.evaluate(() => {
  const workspace = document.getElementById('interactive-builder');
  const box = workspace.getBoundingClientRect();
  const buttons = [...document.querySelectorAll('.daw-variant-wrapper button, .daw-branch-actions-row button')]
    .map(b => {
      const r = b.getBoundingClientRect();
      return { text: b.textContent.trim(), left: r.left, right: r.right, top: Math.round(r.top), squashed: b.scrollWidth > b.clientWidth + 1 };
    });
  const scrolled = [];
  for (let el = document.querySelector('.daw-variant-wrapper'); el; el = el.parentElement) {
    if (el.scrollLeft > 0) scrolled.push(el.id || el.className);
  }
  return { left: box.left, right: box.right, buttons, scrolled };
});

test('new variants wrap onto new lines, and the workspace never scrolls sideways', async ({ page }) => {
  await openMove(page);
  for (let i = 0; i < 6; i++) {
    await page.locator('[data-daw-add-variant]').first().click();
  }
  await expect(page.locator('.daw-variant-wrapper .daw-tab-btn', { hasText: 'New Variant' })).toHaveCount(6);
  await expect(page.locator('.daw-branch-actions-row button')).toHaveCount(3);

  const g = await geometry(page);
  expect(g.scrolled, 'nothing around the rows is scrolled sideways').toEqual([]);
  for (const b of g.buttons) {
    expect(b.left, `${b.text} starts inside the workspace`).toBeGreaterThanOrEqual(g.left - 0.5);
    expect(b.right, `${b.text} ends inside the workspace`).toBeLessThanOrEqual(g.right + 0.5);
    expect(b.squashed, `${b.text} is not squashed narrower than its words`).toBe(false);
  }
  // The positive half: the tabs really are on more than one line now.
  const tabTops = new Set(g.buttons.filter(b => /variant/i.test(b.text) && !/delete|create/i.test(b.text)).map(b => b.top));
  expect(tabTops.size, 'the variant tabs wrapped').toBeGreaterThan(1);

  // And + ADD VARIANT is still a button you can press.
  await page.locator('[data-daw-add-variant]').first().click();
  await expect(page.locator('.daw-variant-wrapper .daw-tab-btn', { hasText: 'New Variant' })).toHaveCount(7);
});
