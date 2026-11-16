// "No frame data" on a move (owner's board: "Add a way to disable the frame
// data of a skill card"). Innate covers passives and dash variants, which have
// nothing to measure, and their Skill Cards carried an empty box saying frame
// data had not been mapped yet.
//
// The owner's pick (2026-11-16): the move's description sits where the Frame
// Track would be. The tick is all that is stored; tracks a move already had are
// kept and come back when it is unticked.
const { test, expect } = require('@playwright/test');

const TRACK = {
  standard: {
    label: 'On Hit', totalScale: 20,
    bars: [{ type: 'single', phases: [
      { duration: 10, styleClass: 'bg-tick-start', label: 'Startup: 10f' },
      { duration: 10, styleClass: 'bg-tick-active', label: 'Active: 10f' },
    ] }],
  },
};

// The reader's page, with two moves drawn from data handed to it here.
async function drawMoves(page, moves, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(async (moves) => {
    window.cachedMasterFrameData = window.cachedMasterFrameData || {};
    window.cachedMasterFrameData['boomcat'] = { specials: moves };
    await window.loadMoveSection('boomcat', 'specials');
    for (const move of moves) {
      populateTextSection(`strategy-${move.id}`, 'Move Overview and Strategy',
        [{ type: 'paragraph', content: `About ${move.name}.` }], 'move-strategy');
    }
  }, moves);
  await page.locator('#nav-specials').click();
  await expect(page.locator('#tab-specials .skill-entry-card').first()).toBeVisible();
}

const PASSIVE = { id: 'passive', name: 'Nine Lives', input: 'Passive', type: 'Passive', stats: [{ label: 'Cooldown', value: '12s' }], noFrameData: true, variants: TRACK };
const ATTACK = { id: 'attack', name: 'Swipe', input: 'M1', type: 'Attack', stats: [], variants: TRACK };

test('a move marked No frame data shows its description where the Frame Track would be', async ({ page }) => {
  await drawMoves(page, [PASSIVE, ATTACK]);
  const card = page.locator('#tab-specials .skill-entry-card', { hasText: 'Nine Lives' });

  // Nothing of the Frame Track, and nothing saying it is missing.
  await expect(card.locator('.frame-bar-container')).toHaveCount(0);
  await expect(card.locator('.skill-tab-bar')).toHaveCount(0);
  await expect(card.locator('.empty-frame-data-msg')).toHaveCount(0);
  await expect(card).not.toContainText('Frame data has not been mapped');

  // The description is in the right column, beside the media and Stats.
  const description = card.locator('.skill-right-col .skill-strategy-section');
  await expect(description).toContainText('About Nine Lives.');
  const place = await card.evaluate(el => {
    const box = (sel) => el.querySelector(sel).getBoundingClientRect();
    const left = box('.skill-left-col'), text = box('.skill-strategy-section');
    return { besideLeftColumn: text.left >= left.right - 1, startsLevel: Math.abs(text.top - left.top) < 2 };
  });
  expect(place.besideLeftColumn, 'the description starts right of the media column').toBe(true);
  expect(place.startsLevel, 'and at the top of the card body, not under it').toBe(true);
});

test('a move with frame data is drawn as before, description under the card body', async ({ page }) => {
  await drawMoves(page, [PASSIVE, ATTACK]);
  const card = page.locator('#tab-specials .skill-entry-card', { hasText: 'Swipe' });

  await expect(card.locator('.frame-bar-container')).toHaveCount(1);
  await expect(card.locator('.skill-right-col .skill-strategy-section')).toHaveCount(0);
  const under = await card.evaluate(el =>
    el.querySelector('.skill-strategy-section').getBoundingClientRect().top >= el.querySelector('.skill-entry-body').getBoundingClientRect().bottom - 1);
  expect(under).toBe(true);
});

test('on a narrow screen the description follows the Stats', async ({ page }) => {
  await drawMoves(page, [PASSIVE], 900);
  const card = page.locator('#tab-specials .skill-entry-card', { hasText: 'Nine Lives' });
  const under = await card.evaluate(el =>
    el.querySelector('.skill-strategy-section').getBoundingClientRect().top >= el.querySelector('.skill-stats-box').getBoundingClientRect().bottom - 1);
  expect(under).toBe(true);
});

test('the Color Legend is not shown for a tab where no move has frame data', async ({ page }) => {
  await drawMoves(page, [PASSIVE]);
  await expect(page.locator('#tab-specials .legend-grid')).toHaveCount(0);

  await drawMoves(page, [PASSIVE, ATTACK]);
  await expect(page.locator('#tab-specials .legend-grid')).toHaveCount(1);
});

// --- THE EDITOR ---

function mockEditor(page) {
  return page.addInitScript((variants) => {
    const frame = { m1s: [], skills: [], specials: [{ id: 'passive', name: 'Nine Lives', stats: [], variants }] };
    const rowsFor = (table) => {
      if (table === 'page_data') return { data: { page_id: 'boomcat', desc_data: { overview: [] }, frame_data: frame }, error: null };
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
  }, TRACK);
}

const storedMove = (page) => page.evaluate(() => window.cachedMasterFrameData.boomcat.specials[0]);

test('ticking No frame data puts the timeline away, and unticking brings the same tracks back', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockEditor(page);
  await page.goto('/edit.html?char=boomcat&type=character&tab=specials', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.daw-timeline-wrapper')).toBeVisible({ timeout: 45000 });
  await expect(page.locator('.daw-phase-block')).toHaveCount(2);

  const tick = page.getByLabel('No frame data');
  await expect(tick).not.toBeChecked();
  expect(await storedMove(page)).not.toHaveProperty('noFrameData');

  await tick.check();
  await expect(page.locator('.daw-timeline-wrapper')).toHaveCount(0);
  await expect(page.locator('[data-daw-add-variant]')).toHaveCount(0);
  await expect(page.locator('.daw-no-frames-notice')).toContainText('Frame data is turned off for this move');
  await expect(page.getByLabel('No frame data')).toBeChecked();
  const ticked = await storedMove(page);
  expect(ticked.noFrameData).toBe(true);
  expect(ticked.variants.standard.bars[0].phases, 'the tracks are kept').toHaveLength(2);

  await page.getByLabel('No frame data').uncheck();
  await expect(page.locator('.daw-phase-block')).toHaveCount(2);
  await expect(page.locator('[data-daw-add-variant]').first()).toBeVisible();
  // Gone, not false: a move nobody ticked and a move ticked then unticked
  // are the same data, so the second is not a change to review.
  expect(await storedMove(page)).not.toHaveProperty('noFrameData');
});
