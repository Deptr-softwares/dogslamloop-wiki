// The frame data editor calls its frame-level variants Micro Variants (owner's
// board, 2026-10-29: "Renamed Variants in frame data to Micro Variants (on hit,
// on whiff, on block, on front hit, etc.) to not be confused with actual skill
// variants in game (Garuda Stab, Mass-imbued Garuda Stab)"), and the level
// nested inside one Sub-Micro Variants ("call them sub-Micro Variants").
//
// Only words change. A Micro Variant is still stored under `variants`, so every
// page already written reads the same. The move's own "Variant" field (Ground,
// Air, Standard) is the in-game kind, and it keeps its name.
const { test, expect } = require('@playwright/test');

const FRAME = {
  m1s: [], specials: [],
  skills: [{
    id: 'move', name: 'Garuda Stab', variant: 'Standard', stats: [],
    variants: {
      standard: { label: 'On Hit', totalScale: 40, bars: [{ type: 'single', phases: [{ duration: 40, styleClass: 'bg-tick-start', label: 'S' }] }] },
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

// Every word the editor shows in the frame data area: text, placeholders and
// hover titles. The move's own Variant field is left out by name, because it is
// the one that stays.
const wordsSaying = (page, pattern) => page.evaluate((source) => {
  const re = new RegExp(source, 'i');
  const root = document.getElementById('interactive-builder');
  const out = [];
  for (const el of root.querySelectorAll('*')) {
    if (el.closest('[data-field="variant"]')) continue;
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ');
    for (const text of [own, el.getAttribute('placeholder') || '', el.getAttribute('title') || '']) {
      if (text && re.test(text)) out.push(text);
    }
  }
  return out;
}, pattern.source);

// "variant" anywhere it is not part of "Micro Variant".
const OLD_NAME = /(?<!micro )(?<!micro-)variant/;

test('the frame data editor says Micro Variant everywhere it means one', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockEditor(page);
  await page.goto('/edit.html?char=boomcat&type=character&tab=skills', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.daw-timeline-wrapper')).toBeVisible({ timeout: 45000 });

  // A Micro Variant with a timeline.
  await expect(page.locator('[data-daw-add-variant]').first()).toHaveText('+ ADD MICRO VARIANT');
  await expect(page.locator('#daw-variant-label')).toHaveAttribute('placeholder', 'Micro Variant Label');
  expect(await wordsSaying(page, OLD_NAME), 'a leaf').toEqual([]);

  // A new, empty one.
  await page.locator('[data-daw-add-variant]').first().click();
  await expect(page.locator('.daw-variant-wrapper .daw-tab-btn', { hasText: 'New Micro Variant' })).toHaveCount(1);
  await expect(page.locator('.daw-branch-hint')).toHaveText('This Micro Variant is currently empty.');
  await expect(page.locator('.daw-branch-actions-row button')).toHaveText(['Initialize Timeline', 'Create Sub-Micro Variants', 'Delete Micro Variant']);
  expect(await wordsSaying(page, OLD_NAME), 'an empty one').toEqual([]);

  // Turned into a branch holding Sub-Micro Variants. Creating one opens it, so
  // the branch's own panel is one click back up.
  await page.getByRole('button', { name: 'Create Sub-Micro Variants' }).click();
  await expect(page.locator('.daw-variant-wrapper .daw-variant-tabs')).toHaveCount(2);
  expect(await wordsSaying(page, OLD_NAME), 'a new Sub-Micro Variant').toEqual([]);
  await page.locator('.daw-variant-wrapper .daw-variant-tabs').first().getByRole('button', { name: 'New Micro Variant' }).click();
  await expect(page.locator('.daw-branch-title')).toHaveText('Micro Variant Branch');
  await expect(page.locator('.daw-branch-hint')).toHaveText('Select a Sub-Micro Variant from the tabs above to view or edit its timeline.');
  expect(await wordsSaying(page, OLD_NAME), 'a branch').toEqual([]);

  // The in-game kind of move keeps its name.
  await expect(page.locator('[data-field="variant"]')).toHaveAttribute('placeholder', 'Variant (e.g. Standard)');
});

test('deleting one asks about the Micro Variant', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockEditor(page);
  await page.goto('/edit.html?char=boomcat&type=character&tab=skills', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.daw-timeline-wrapper')).toBeVisible({ timeout: 45000 });

  await page.locator('[data-daw-add-variant]').first().click();
  await page.getByRole('button', { name: 'Delete Micro Variant' }).click();
  await expect(page.locator('#editor-custom-modal')).toBeVisible();
  await expect(page.locator('#editor-modal-text')).toHaveText('Delete this Micro Variant completely?');
});
