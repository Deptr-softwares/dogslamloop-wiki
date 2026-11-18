// Color Codes, a page edited in the editor since v1.2 (the Kanban card
// "Figure out a way to make the site editing feels less restrictive").
//
// It was hand-written, with its swatches listed in the page: 21 characters by
// CSS variable, none added since, and one name misspelt
// (--color-disaster-plant), so that swatch drew nothing. Its swatches are a
// Block now, drawn from the site's own colours, so these tests compare the page
// with those colours and that registry rather than with a list of names: an
// owner adding a character must never turn them red.
const { test, expect } = require('@playwright/test');

const para = (content) => ({ type: 'paragraph', content });
const PAGE = { tabs: [{
  tabId: 'overview', tabLabel: 'Overview',
  sections: [
    { sectionTitle: 'Character Themes', layout: 'full', blocks: [para('Each character colour.'), { type: 'colorswatches', set: 'characters' }] },
    { sectionTitle: 'Frame Data Types', layout: 'full', blocks: [{ type: 'colorswatches', set: 'frames' }] },
    { sectionTitle: 'Stackable Overlays', layout: 'full', blocks: [{ type: 'colorswatches', set: 'overlays' }] },
  ],
}] };

// The page's own row, from the fixture: production has none until the
// release brings the page's content in.
function servePage(page, desc) {
  return page.route('**/rest/v1/page_data*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ page_id: 'color_codes', page_type: 'system', desc_data: desc, frame_data: {} }),
  }));
}

// Every second character hidden in flight, so "a hidden character stays off"
// is proven against whatever the real registry holds.
function hideEverySecondCharacter(page) {
  return page.route('**/data/navigation.json*', async (route) => {
    const response = await route.fetch();
    const nav = await response.json();
    let n = 0;
    for (const entries of Object.values(nav)) {
      if (!Array.isArray(entries)) continue;
      for (const e of entries) {
        if (e && e.cms_config && e.cms_config.pageType === 'character' && n++ % 2 === 1) e.isHidden = true;
      }
    }
    await route.fulfill({ response, json: nav });
  });
}

const transparent = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';

test("the page draws every shown character's own colour, and leaves a hidden one off", async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await servePage(page, PAGE);
  await hideEverySecondCharacter(page);
  await page.goto('/systems/color-codes/index.html', { waitUntil: 'networkidle' });

  const grid = page.locator('.color-swatch-grid[data-swatch-set="characters"]');
  await expect(grid).toHaveAttribute('data-filled', 'true');

  const seen = await page.evaluate(async () => {
    const roster = [...(await window.loadCharacterRoster()).values()];
    const colors = window.CHARACTER_COLORS;
    const hex = (rgb) => '#' + rgb.match(/\d+/g).slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('');
    return {
      expected: roster.filter(e => !e.hidden && window.safeColor(colors[e.name])).map(e => e.name),
      hidden: roster.filter(e => e.hidden && colors[e.name]).map(e => e.name),
      cards: [...document.querySelectorAll('.color-swatch-grid[data-swatch-set="characters"] .color-swatch-card')].map(card => {
        const fill = getComputedStyle(card.querySelector('.swatch-color-block')).backgroundColor;
        return { name: card.querySelector('.swatch-title').textContent, fill, fillHex: hex(fill), code: card.querySelector('.swatch-code').textContent };
      }),
    };
  });

  expect(seen.hidden.length, 'setup: hidden characters with a colour to leave off').toBeGreaterThan(0);
  // Every shown character with a colour, in the registry's order, and no other.
  expect(seen.cards.map(c => c.name)).toEqual(seen.expected);
  for (const name of seen.hidden) expect(seen.cards.map(c => c.name)).not.toContain(name);
  for (const card of seen.cards) {
    // The old page's Disaster Plants: a name whose colour drew nothing.
    expect(transparent(card.fill), `${card.name}'s swatch has a colour`).toBe(false);
    // The code is the colour itself, written the way [color=#...] takes it.
    expect(card.code, card.name).toMatch(/^#[0-9a-f]{6}$/);
    expect(card.code, card.name).toBe(card.fillHex);
  }
  expect(errors).toEqual([]);
});

test('when the registry cannot be read, the character grid says so instead of waiting', async ({ page }) => {
  await servePage(page, PAGE);
  await page.route('**/data/navigation.json*', route => route.fulfill({ status: 500, body: 'down' }));
  await page.goto('/systems/color-codes/index.html', { waitUntil: 'networkidle' });

  const grid = page.locator('.color-swatch-grid[data-swatch-set="characters"]');
  await expect(grid).toHaveText('The character colors could not be loaded.');
  await expect(grid.locator('.color-swatch-card')).toHaveCount(0);
});

test("the frame data and overlay swatches are the legend's own, by the legend's names", async ({ page }) => {
  await servePage(page, PAGE);
  await page.goto('/systems/color-codes/index.html', { waitUntil: 'networkidle' });

  const seen = await page.evaluate(() => {
    const read = (set, visual) => [...document.querySelectorAll(`.color-swatch-grid[data-swatch-set="${set}"] .color-swatch-card`)].map(card => ({
      name: card.querySelector('.swatch-title').textContent,
      style: getComputedStyle(card.querySelector(visual)),
      code: card.querySelector('.swatch-code').textContent,
    })).map(c => ({ name: c.name, fill: c.style.backgroundColor, border: c.style.borderTopWidth, code: c.code }));
    const labels = window.FRAME_COLOR_LABELS;
    return {
      frames: read('frames', '.frame-tick'),
      overlays: read('overlays', '.window-overlay'),
      frameNames: Object.keys(window.FRAME_COLORS).map(k => labels[k]),
      overlayNames: Object.keys(window.WINDOW_COLORS).map(k => labels[k]),
    };
  });

  expect(seen.frames.map(f => f.name)).toEqual(seen.frameNames);
  expect(seen.overlays.map(o => o.name)).toEqual(seen.overlayNames);
  for (const f of seen.frames) {
    expect(transparent(f.fill), `${f.name} is drawn in its colour`).toBe(false);
    expect(f.code, f.name).toMatch(/^#[0-9a-f]{6}$/);
  }
  for (const o of seen.overlays) expect(o.border, `${o.name} draws its border`).not.toBe('0px');
});

// --- THE EDITOR ---
// An ordinary signed-in contributor, and page_data from the fixture.
function mockEditor(page, desc) {
  return page.addInitScript((desc) => {
    const rowsFor = (table) => {
      if (table === 'page_data') return { data: { page_id: 'x', desc_data: desc, frame_data: {} }, error: null };
      if (['user_roles', 'site_settings', 'page_permissions', 'pending_revisions'].includes(table)) return { data: null, error: null };
      return { data: [], error: null };
    };
    const builder = (table) => {
      const result = rowsFor(table);
      const chain = {
        select() { return chain; }, eq() { return chain; }, in() { return chain; }, not() { return chain; },
        order() { return chain; }, limit() { return chain; }, neq() { return chain; },
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
              getSession: async () => ({ data: { session: { user: { id: 'contributor-1', email: 'c@b.c' }, access_token: 't' } } }),
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
  }, desc);
}

const offered = (page) => page.locator('#add-block-popup .add-block-btn').allTextContents();

test('Color Swatches is offered on Color Codes, and its dropdown picks the grid', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockEditor(page, PAGE);
  await page.goto('/edit.html?char=color_codes&type=system', { waitUntil: 'domcontentloaded' });
  const card = page.locator('#block-list .block-card').nth(1);
  await expect(card).toBeVisible({ timeout: 45000 });

  expect(await offered(page)).toContain('+ Color Swatches');
  await expect(card.locator('.block-type-label')).toHaveText('Color Swatches');

  // Drive the custom dropdown: the native <select> is hidden behind it.
  if (!(await card.locator('.manga-select-trigger').last().isVisible())) await card.locator('.btn-collapse').click();
  await card.locator('select[data-field="set"] + .manga-select-wrapper .manga-select-trigger').click();
  await card.locator('.manga-select-options .manga-option', { hasText: /^Frame Data Types$/ }).click();

  const preview = page.locator('#standard-preview-container');
  await expect(preview.locator('.color-swatch-grid[data-swatch-set="frames"]')).toBeVisible();
  await expect(preview.locator('.color-swatch-grid[data-swatch-set="characters"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.getActiveBlocks()[1].set)).toBe('frames');
});

test('Color Swatches is not offered on any other page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockEditor(page, { tabs: [{ tabId: 'overview', tabLabel: 'Overview', sections: [{ sectionTitle: 'Intro', layout: 'full', blocks: [para('Hi.')] }] }] });
  await page.goto('/edit.html?char=m1-trading&type=system', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#block-list .block-card').first()).toBeVisible({ timeout: 45000 });

  const types = await offered(page);
  expect(types.length, 'setup: the menu rendered').toBeGreaterThan(5);
  expect(types).not.toContain('+ Color Swatches');
});
