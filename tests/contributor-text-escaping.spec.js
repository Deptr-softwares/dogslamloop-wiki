// Contributor text in frame data, profile stats, system page labels and the
// reviewer's diff titles is written into innerHTML, and until 2026-10-18 none
// of it was escaped. A move name, a stat, a variant label, a track header or a
// matchup name could carry markup, and it ran for every reader of the page and
// for the reviewer who opened the submission, before anyone approved it.
//
// Every surface below is fed the same crafted values and has to show them as
// TEXT. The one tag kept on purpose is <br>: editors type it to break a stat
// value over two lines (133 of them on production that day), so it must still
// produce a line break and nothing else.
const { test, expect } = require('@playwright/test');

// Each one fires the same counter if it ever becomes markup.
const TAG = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
const ATTR = '"><img src=x onerror="window.__xss=(window.__xss||0)+1">';
const QUOTE = "x');window.__xss=(window.__xss||0)+1;('";

const EVIL_FRAME = {
  m1s: [], specials: [],
  skills: [{
    id: QUOTE,
    name: `Evil ${TAG}`,
    input: ATTR, type: ATTR, damageType: ATTR, variant: ATTR,
    stats: [
      { label: `Label ${TAG}`, value: `5 for kick<br>9 for distortion ${TAG}` },
      { label: ATTR, value: ATTR },
    ],
    variants: {
      [QUOTE]: {
        label: `Variant ${TAG}`,
        totalScale: 20,
        bars: [{
          type: 'single',
          headerInfo: `Header ${TAG}`,
          footerInfo: `Footer ${TAG}`,
          headerClass: 'text-red-400" onmouseover="window.__xss=(window.__xss||0)+1',
          phases: [{ duration: 10, styleClass: 'bg-tick-start', label: `Phase ${TAG}` }],
        }],
        inlineLegend: [{ color: 'red;" onmouseover="window.__xss=1', text: `Legend ${TAG}` }],
      },
      second: { label: ATTR, totalScale: 20, bars: [{ type: 'single', phases: [{ duration: 5, styleClass: 'bg-tick-recov', label: 'R' }] }] },
    },
  }],
};

const EVIL_DESC = {
  overview: [],
  profile: { stats: [{ label: `Archetype ${TAG}`, value: `Rushdown<br>Zoner ${TAG}` }], image: '' },
};

// The page's own Supabase client, with page_data answered from the fixture.
function mockReaderPage(page) {
  return page.addInitScript(({ desc, frame }) => {
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          const orig = lib.createClient.bind(lib);
          lib.createClient = (...args) => {
            const client = orig(...args);
            const origFrom = client.from.bind(client);
            client.from = (table) => {
              if (table !== 'page_data') return origFrom(table);
              const chain = {
                select() { return chain; }, eq() { return chain; },
                single: async () => ({ data: { desc_data: desc, frame_data: frame }, error: null }),
              };
              return chain;
            };
            client.auth.getSession = async () => ({ data: { session: null } });
            return client;
          };
          lib.__patched = true;
        }
      },
    });
  }, { desc: EVIL_DESC, frame: EVIL_FRAME });
}

// A whole client for edit.html: an ordinary signed-in contributor, and
// page_data answered from the fixture.
function mockEditor(page, { desc, frame }) {
  return page.addInitScript(({ desc, frame }) => {
    const rowsFor = (table) => {
      if (table === 'page_data') return { data: { page_id: 'boomcat', desc_data: desc, frame_data: frame }, error: null };
      if (['user_roles', 'site_settings', 'page_permissions', 'pending_revisions'].includes(table)) return { data: null, error: null };
      return { data: [], error: null };
    };
    const builder = (table) => {
      const result = rowsFor(table);
      const chain = {
        select() { return chain; }, eq() { return chain; }, in() { return chain; },
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
  }, { desc, frame });
}

async function nothingRan(page) {
  // An injected <img src=x> errors on its own; give it the time to.
  await page.waitForTimeout(600);
  return page.evaluate(() => ({
    fired: window.__xss || 0,
    images: document.querySelectorAll('img[src="x"]').length,
  }));
}

test('a character page shows crafted frame data and profile stats as text', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await mockReaderPage(page);
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  await page.locator('#nav-skills').click();

  const card = page.locator('#tab-skills .skill-entry-card').first();
  await expect(card).toBeVisible();

  // The crafted text is on the page, as text.
  await expect(card.locator('.stat-label').first()).toContainText('<img src=x');
  await expect(card.locator('.bar-header-info').first()).toContainText('Header <img');

  // Every branch tab and the phase tooltip. Dispatched rather than clicked:
  // the page's "On this page" drawer sits over the card at this width, and
  // what is under test is what the handlers write, not where the pointer lands.
  const tabs = card.locator('.btn-manga');
  for (let i = 0; i < await tabs.count(); i++) await tabs.nth(i).dispatchEvent('click');
  await card.locator('.phase-section').first().dispatchEvent('mouseenter');
  await expect(page.locator('#wiki-frame-tooltip')).toContainText('Phase <img');

  const result = await nothingRan(page);
  expect(result.fired, 'no crafted value ran').toBe(0);
  expect(result.images, 'and none became an element').toBe(0);
  expect(errors).toEqual([]);
});

test('a <br> in a stat value still breaks the line, and is the only tag kept', async ({ page }) => {
  await mockReaderPage(page);
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  // Profile card, on the Overview tab.
  const profileValue = page.locator('.profile-stat-val').first();
  await expect(profileValue).toContainText('Rushdown');
  expect(await profileValue.locator('br').count()).toBe(1);
  expect(await profileValue.evaluate(el => el.children.length), 'the <br> is its only element').toBe(1);

  // Move stats, on the Skills tab.
  await page.locator('#nav-skills').click();
  const value = page.locator('#tab-skills .stat-value').first();
  await expect(value).toContainText('9 for distortion');
  expect(await value.locator('br').count()).toBe(1);
  expect(await value.evaluate(el => el.children.length)).toBe(1);
});

test('the frame data editor shows crafted values as text, and its tabs still work', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await mockEditor(page, { desc: EVIL_DESC, frame: EVIL_FRAME });
  await page.goto('/edit.html?char=boomcat&type=character&tab=skills', { waitUntil: 'domcontentloaded' });

  const moveTab = page.locator('[data-move-load]').first();
  await expect(moveTab).toBeVisible({ timeout: 45000 });
  await expect(moveTab).toContainText('Evil <img');

  // The move name went into value= attributes: it has to come back intact.
  await expect(page.locator('.meta-inp[data-field="input"]')).toHaveValue(ATTR);
  await expect(page.locator('.stat-inp[data-field="value"]').nth(1)).toHaveValue(ATTR);

  // The quote-carrying id used to sit inside an inline onclick string.
  await moveTab.click();

  // The variant tabs moved from inline onclick to data- attributes; clicking
  // one must still switch the timeline to it.
  const second = page.locator('[data-daw-path]').nth(1);
  await second.click();
  await expect(page.locator('[data-daw-path].active')).toContainText(ATTR);

  // Select a phase so the inspector renders its label field too.
  await page.locator('[data-daw-path]').first().click();
  await page.locator('.daw-phase-block').first().click();
  await expect(page.locator('#insp-label')).toHaveValue(`Phase ${TAG}`);

  const result = await nothingRan(page);
  expect(result.fired, 'no crafted value ran').toBe(0);
  expect(result.images).toBe(0);
  expect(errors).toEqual([]);
});

test('the system page editor shows crafted tab and section names as text', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await mockEditor(page, {
    frame: null,
    desc: { tabs: [{ tabId: 't', tabLabel: `Tab ${TAG}`, sections: [{ sectionTitle: ATTR, layout: 'full', blocks: [] }] }] },
  });
  await page.goto('/edit.html?char=boomcat&type=system', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.daw-tab-btn').filter({ hasText: 'Tab <img' }).first()).toBeVisible({ timeout: 45000 });
  await expect(page.locator('.system-section-tab-btn').first()).toContainText(ATTR);

  const result = await nothingRan(page);
  expect(result.fired).toBe(0);
  expect(result.images).toBe(0);
  expect(errors).toEqual([]);
});

test('a crafted combo route is a plain title in the reviewer diff view', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const out = await page.evaluate(async ({ tag }) => {
    document.body.innerHTML = `<div class="main-content-area"></div>`;
    // A combo row is titled by its route ("Combo Added: <route>"), which is
    // the contributor's own text.
    const live = { overview: [], comboList: [{ starter: 'M1 Starters', rows: [] }] };
    window.currentQueueData = [{
      id: 'x', page_id: 'boomcat', page_type: 'character', is_delta: true,
      target_scope: 'comboTable', target_key: 'M1 Starters',
      delta_payload: { starter: 'M1 Starters', rows: [{ combo: tag, damage: '10', worksOn: 'All' }] },
    }];
    window.activePreviewRevId = 'x';
    window.activePreviewCharId = 'boomcat';
    window.activePreviewPageType = 'character';
    window.activePreviewMode = null;
    window.currentLiveDescData = JSON.parse(JSON.stringify(live));
    window.currentLiveFrameData = { m1s: [], skills: [], specials: [] };
    window.currentPendingDescData = JSON.parse(JSON.stringify(live));
    window.currentPendingFrameData = { m1s: [], skills: [], specials: [] };
    await switchVersionView('diff');
    await new Promise(r => setTimeout(r, 400));
    const titles = [...document.querySelectorAll('.diff-section-title')].map(h => h.textContent);
    return { titles, fired: window.__xss || 0, images: document.querySelectorAll('img[src="x"]').length };
  }, { tag: TAG });

  expect(out.titles.length, 'the diff rendered a titled block').toBeGreaterThan(0);
  expect(out.titles.join(' ')).toContain('<IMG SRC=X');
  expect(out.fired).toBe(0);
  expect(out.images).toBe(0);
});
