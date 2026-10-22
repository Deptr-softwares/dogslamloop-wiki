// The frame data editor keeps its timeline where the editor left it (owner's
// wishlist, 2026-10-18: "Clicking on the phase editor of each Frame Phase reset
// the preview position ... back to its start").
//
// Every click in the timeline rebuilds it (renderDaw writes the whole editor's
// innerHTML), and a rebuilt scroll box starts at 0. On a long move that sent
// the editor back to frame 0 on every phase picked.
const { test, expect } = require('@playwright/test');

// A long move: 400 frames at 5px a frame is a 2000px timeline.
const FRAME = {
  m1s: [], specials: [],
  skills: [{
    id: 'long', name: 'Long Move', stats: [],
    variants: {
      standard: {
        label: 'Standard', totalScale: 400,
        bars: [{ type: 'single', phases: Array.from({ length: 20 }, (_, i) => (
          { duration: 20, styleClass: i % 2 ? 'bg-tick-active' : 'bg-tick-start', label: `P${i}` })) }],
      },
      other: {
        label: 'Other', totalScale: 400,
        bars: [{ type: 'single', phases: [{ duration: 400, styleClass: 'bg-tick-recov', label: 'R' }] }],
      },
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

async function openLongMove(page) {
  await mockEditor(page);
  await page.goto('/edit.html?char=boomcat&type=character&tab=skills', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.daw-timeline-wrapper')).toBeVisible({ timeout: 45000 });
}

const scrollOf = (page) => page.locator('.daw-timeline-wrapper').evaluate(el => el.scrollLeft);

test('picking a phase keeps the timeline where it was', async ({ page }) => {
  await openLongMove(page);

  const wrapper = page.locator('.daw-timeline-wrapper');
  await wrapper.evaluate(el => { el.scrollLeft = 900; });
  const before = await scrollOf(page);
  expect(before, 'the timeline is long enough to scroll').toBeGreaterThan(500);

  // A phase in view at that scroll position, clicked the way a person does.
  const phase = page.locator('.daw-phase-block').nth(12);
  await phase.scrollIntoViewIfNeeded();
  const at = await scrollOf(page);
  await phase.click();

  await expect(page.locator('.daw-phase-block.selected')).toHaveCount(1);
  expect(await scrollOf(page), 'the rebuilt timeline is where the old one was').toBe(at);
});

test('a different variant is a different timeline, and starts at its beginning', async ({ page }) => {
  await openLongMove(page);
  await page.locator('.daw-timeline-wrapper').evaluate(el => { el.scrollLeft = 900; });

  await page.locator('[data-daw-path]').filter({ hasText: 'Other' }).click();
  await expect(page.locator('[data-daw-path].active')).toContainText('Other');
  expect(await scrollOf(page)).toBe(0);
});
