// Frame-data edits are auto-saved like Block edits.
//
// The frame-data editor changes the move in place and never passes through the
// Block buffer's live preview, which is what writes the draft. So a phase, track
// or Micro Variant edit stayed in memory only, and closing the tab before a Sync
// or a tab switch lost it: the draft on disk still held the old move. Undo for
// frame data is separate, later work (the notebook editor).
const { test, expect } = require('@playwright/test');

const FRAME = {
  m1s: [], specials: [],
  skills: [{
    id: 'mv', name: 'Move', stats: [],
    variants: {
      standard: {
        label: 'Standard', totalScale: 60,
        bars: [{ type: 'single', phases: [
          { duration: 10, styleClass: 'bg-tick-start', label: 'Startup' },
          { duration: 20, styleClass: 'bg-tick-active', label: 'Active' },
        ] }],
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
        select() { return chain; }, eq() { return chain; }, in() { return chain; }, neq() { return chain; },
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
  await mockEditor(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/edit.html?char=boomcat&type=character&tab=skills', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.daw-timeline-wrapper')).toBeVisible({ timeout: 45000 });
}

// The phases of the move as the saved draft holds them.
const savedPhases = (page) => page.evaluate(() => {
  const raw = localStorage.getItem('wiki_draft_boomcat');
  const frame = raw ? JSON.parse(raw).frame_data : null;
  return frame ? frame.skills[0].variants.standard.bars[0].phases.map(p => p.duration) : null;
});

test('a phase changed in the inspector survives closing the tab, with no Sync', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openMove(page);

  await page.locator('.daw-phase-block').first().click();
  await page.locator('#insp-duration').fill('37');
  await page.locator('#insp-duration').press('Tab');
  await expect.poll(() => savedPhases(page), 'the draft holds the new length').toEqual([37, 20]);

  // Closing the tab and coming back.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#editor-modal-confirm', { hasText: 'RESTORE DRAFT' }).click();
  await expect(page.locator('.daw-timeline-wrapper')).toBeVisible({ timeout: 45000 });
  await page.locator('.daw-phase-block').first().click();
  await expect(page.locator('#insp-duration')).toHaveValue('37');
  expect(errors).toEqual([]);
});

test('a field that does not redraw the editor is saved as it is typed', async ({ page }) => {
  // The move's name changes the data without redrawing anything, so only the
  // editor's own input listener can save it.
  await openMove(page);

  await page.locator('.meta-inp[data-field="name"]').fill('Renamed Move');
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem('wiki_draft_boomcat');
    return raw ? JSON.parse(raw).frame_data.skills[0].name : null;
  }), 'the draft holds the new name').toBe('Renamed Move');
});

test('a phase added with + is saved too', async ({ page }) => {
  await openMove(page);

  await page.locator('button[title="Add Phase"]').first().click();
  await expect(page.locator('.daw-phase-block')).toHaveCount(3);
  await expect.poll(() => savedPhases(page), 'the draft holds the new phase').toEqual([10, 20, 10]);
});
