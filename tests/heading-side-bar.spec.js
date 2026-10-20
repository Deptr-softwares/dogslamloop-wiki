// A Heading Block's side bar (v1.1). Owner, 2026-10-19: "when heading Block is
// rendered in these tabs [Starter Guide, Matchup, Counterplay], there are a
// sidebar of colors on the side. I think this should be removed, every Blocks
// should rendered the same way across the whole site ... And this side bar
// colors thing can be an optional styling option block." Scoped the same day:
// a Side bar setting on the Heading Block, in every tab, in any colour (the
// text-colour presets plus custom).
//
// Asserted on what the browser paints (the computed border), not on a class.
const { test, expect } = require('@playwright/test');

const PAGE = '/characters/Boomcat/index.html';

// Every context the renderer is called with: the plain one, the three tabs that
// used to draw a bar of their own, a system page and a move write-up.
const CONTEXTS = ['', 'matchup', 'counterplay', 'starterGuide', 'system-content', 'move-strategy'];

async function renderHeadings(page, blocks) {
  // A character page loads its scripts after the stub, so networkidle can come
  // before the renderer exists.
  await page.waitForFunction(() => typeof window.generateHTMLForBlocks === 'function'
    && typeof window.safeColor === 'function' && !!document.querySelector('.main-content-area'));
  return page.evaluate(({ blocks, contexts }) => contexts.map(ctx => {
    const host = document.createElement('div');
    host.innerHTML = window.generateHTMLForBlocks(blocks, ctx);
    document.querySelector('.main-content-area').appendChild(host);
    const out = [...host.querySelectorAll('.wiki-block-heading')].map(h => ({
      width: getComputedStyle(h).borderLeftWidth,
      color: getComputedStyle(h).borderLeftColor,
      style: h.getAttribute('style') || '',
    }));
    out.ctx = ctx;
    return { ctx, headings: out, imgs: host.querySelectorAll('img').length };
  }), { blocks, contexts: CONTEXTS });
}

test('a heading is drawn the same in every tab, and gets a bar only when it asks for one', async ({ page }) => {
  await page.goto(PAGE, { waitUntil: 'networkidle' });

  const rendered = await renderHeadings(page, [
    { type: 'heading', content: 'Plain', size: 'h3' },
    { type: 'heading', content: 'Barred', size: 'h3', sideBar: '#ff0000' },
  ]);

  for (const { ctx, headings } of rendered) {
    const where = ctx || 'no context';
    expect(headings[0].width, `${where}: no bar unless the block asks`).toBe('0px');
    expect(headings[1].width, `${where}: the bar the block asked for`).toBe('3px');
    expect(headings[1].color, `${where}: in its colour`).toBe('rgb(255, 0, 0)');
  }
});

test('a side bar value that is not a colour draws nothing and cannot leave the style', async ({ page }) => {
  await page.goto(PAGE, { waitUntil: 'networkidle' });

  const rendered = await renderHeadings(page, [
    { type: 'heading', content: 'A', sideBar: 'red; background: url(https://example.com/x.png)' },
    { type: 'heading', content: 'B', sideBar: '"><img src=x onerror="window.__PWN=1">' },
  ]);

  for (const { ctx, headings, imgs } of rendered) {
    for (const h of headings) {
      expect(h.width, `${ctx}: no bar`).toBe('0px');
      expect(h.style).not.toContain('url(');
      expect(h.style).not.toContain('--heading-bar');
    }
    expect(imgs, `${ctx}: no element injected`).toBe(0);
  }
  expect(await page.evaluate(() => window.__PWN)).toBeUndefined();
});

// --- THE SETTING IN THE EDITOR ---

const para = (text) => ({ type: 'paragraph', content: [text], align: 'left' });
const DESC = {
  overview: [para('overview')], strategy: [], extras: [],
  profile: { stats: [], image: '' },
  counterplay: [{ topic: 'Spacing', content: [{ type: 'heading', content: 'Stay out', size: 'h3', align: 'left' }, para('text')] }],
};
const FRAME = { m1s: [], specials: [], skills: [] };

function mockEditor(page, desc = DESC) {
  return page.addInitScript(({ desc, frame }) => {
    try {
      localStorage.setItem('dsl_editor_tutorial_seen', '1');
      localStorage.setItem('dsl_notice_seen_editor', '1');
    } catch (e) { /* ignore */ }
    const rowsFor = (table) => {
      if (table === 'page_data') return { data: { page_id: 'boomcat', desc_data: JSON.parse(JSON.stringify(desc)), frame_data: JSON.parse(JSON.stringify(frame)) }, error: null };
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
  }, { desc, frame: FRAME });
}

async function bootCounterplay(page, desc) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 900 });
  await mockEditor(page, desc);
  await page.goto('/edit.html?char=boomcat&type=character&tab=counterplay', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#block-list .block-card').first()).toBeVisible({ timeout: 45000 });
  return errors;
}

const swatch = (page) => page.locator('#block-list .block-card').first().locator('[data-heading-bar]');
const stored = (page) => page.evaluate(() => window.editorMasterDescData.counterplay[0].content[0].sideBar);
const previewBar = (page) => page.locator('.live-preview-pane #tab-counterplay .wiki-block-heading').first()
  .evaluate(h => ({ width: getComputedStyle(h).borderLeftWidth, color: getComputedStyle(h).borderLeftColor }));

test('Side bar on a Heading Block: pick a colour, see it in the preview, take it off again', async ({ page }) => {
  const errors = await bootCounterplay(page);

  await expect(swatch(page)).toHaveText('None');
  expect((await previewBar(page)).width, 'Counterplay no longer adds a bar of its own').toBe('0px');

  await swatch(page).click();
  const preset = page.locator('.heading-bar-popup .color-preset-btn').first();
  await expect(preset).toBeVisible();
  const picked = await preset.getAttribute('data-color');
  const pickedPainted = await preset.evaluate(el => {
    const probe = document.createElement('span');
    probe.style.color = el.getAttribute('data-color');
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  await preset.click();

  await expect(page.locator('.heading-bar-popup')).toHaveCount(0);
  expect(await stored(page)).toBe(picked);
  await expect.poll(() => previewBar(page)).toEqual({ width: '3px', color: pickedPainted });

  await swatch(page).click();
  await page.locator('.heading-bar-popup [data-heading-bar-none]').click();
  expect(await stored(page)).toBeUndefined();
  await expect(swatch(page)).toHaveText('None');
  await expect.poll(async () => (await previewBar(page)).width).toBe('0px');
  expect(errors).toEqual([]);
});

test('Side bar takes a custom colour', async ({ page }) => {
  const errors = await bootCounterplay(page);

  await swatch(page).click();
  await page.locator('.heading-bar-popup #cp-hex').fill('#00ff88');
  await page.locator('.heading-bar-popup #cp-apply').click();

  expect(String(await stored(page)).toLowerCase()).toBe('#00ff88');
  await expect.poll(() => previewBar(page)).toEqual({ width: '3px', color: 'rgb(0, 255, 136)' });
  expect(errors).toEqual([]);
});

test('a stored side bar that is not a colour shows as None in the editor and injects nothing', async ({ page }) => {
  const hostile = JSON.parse(JSON.stringify(DESC));
  hostile.counterplay[0].content[0].sideBar = 'red;" onmouseover="window.__PWN=1"><img src=x onerror="window.__PWN=1">';
  const errors = await bootCounterplay(page, hostile);

  await expect(swatch(page)).toHaveText('None');
  expect(await page.locator('#block-list .block-card').first().locator('img').count()).toBe(0);
  expect(await swatch(page).getAttribute('style')).toBeNull();
  expect(await page.evaluate(() => window.__PWN)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('a click elsewhere puts the colour popup away without changing anything', async ({ page }) => {
  await bootCounterplay(page);

  await swatch(page).click();
  await expect(page.locator('.heading-bar-popup')).toBeVisible();
  await page.locator('.live-preview-pane').click({ position: { x: 20, y: 20 } });
  await expect(page.locator('.heading-bar-popup')).toHaveCount(0);
  expect(await stored(page)).toBeUndefined();
});
