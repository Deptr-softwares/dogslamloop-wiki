// A one-line field being edited widens over its neighbours when its text is
// longer than the box (owner's wishlist, 2026-10-18: "that field expanded and
// lay on top of every other elements ... This sacrifice neat and cleaness for
// practicality and QoL"). Names, table cells and a combo's damage are all this
// kind of field.
//
// Three things have to hold, and the second is the one a careless version
// breaks: it grows and is on top; NOTHING ELSE MOVES; and it is still the same
// field, so typing still edits the data.
const { test, expect } = require('@playwright/test');

const LONG = 'Aerial Cursed Strikes into Black Flash follow-up (only on a grounded opponent after a whiffed punish)';

const FRAME = {
  m1s: [], specials: [],
  skills: [{ id: 'one', name: LONG, input: '1', type: 'Skill', damageType: 'Melee', variant: 'Standard', stats: [] }],
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

const box = (loc) => loc.evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, top: r.top }; });

test('a long name grows over its neighbour while edited, and nothing else moves', async ({ page }) => {
  await mockEditor(page);
  await page.goto('/edit.html?char=boomcat&type=character&tab=skills', { waitUntil: 'domcontentloaded' });

  const name = page.locator('.meta-inp[data-field="name"]');
  const input = page.locator('.meta-inp[data-field="input"]');
  await expect(name).toBeVisible({ timeout: 45000 });

  const nameBefore = await box(name);
  const inputBefore = await box(input);
  expect(await name.evaluate(el => el.scrollWidth > el.clientWidth), 'the name does not fit its box').toBe(true);

  await name.click();
  const nameGrown = await box(name);
  expect(nameGrown.width, 'it grew').toBeGreaterThan(nameBefore.width + 40);

  // Its neighbour has not moved: the field takes no extra layout space.
  expect(await box(input)).toEqual(inputBefore);

  // And it is the one on top where the neighbour sits.
  const onTop = await page.evaluate(() => {
    const field = document.querySelector('.meta-inp[data-field="name"]');
    const next = document.querySelector('.meta-inp[data-field="input"]').getBoundingClientRect();
    const hit = document.elementFromPoint(next.left + 10, next.top + next.height / 2);
    return hit === field;
  });
  expect(onTop, 'the grown field is drawn over its neighbour').toBe(true);

  // Still the same field: typing edits the move's data.
  await page.keyboard.press('End');
  await page.keyboard.type(' x');
  expect(await page.evaluate(() => window.currentEditorFrameData.skills[0].name)).toBe(`${LONG} x`);

  // Back to its own size once it is left.
  await page.locator('.meta-inp[data-field="type"]').click();
  expect((await box(name)).width).toBeCloseTo(nameBefore.width, 0);
});

test('a short value does not grow', async ({ page }) => {
  await mockEditor(page);
  await page.goto('/edit.html?char=boomcat&type=character&tab=skills', { waitUntil: 'domcontentloaded' });

  const field = page.locator('.meta-inp[data-field="input"]');
  await expect(field).toBeVisible({ timeout: 45000 });
  const before = await box(field);
  await field.click();
  expect(await box(field)).toEqual(before);
  await expect(field).not.toHaveClass(/editor-input-grown/);
});
