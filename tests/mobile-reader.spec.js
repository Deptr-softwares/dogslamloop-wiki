// The reader's pages on a phone (owner's board, v1.2: "Add proper mobile layout
// to the wiki"). "Mobile users have been neglected for the longest time", and
// the card lists what was wrong. This spec holds the parts built so far, each
// under the line of the card it answers. Picks are the owner's, 2026-11-16.
//
// Styles are read off elements built here with the pages' own classes, so the
// checks follow the stylesheet and not what a page happens to hold today.
const { test, expect } = require('@playwright/test');

const PHONE = { hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } };
const DESKTOP = { viewport: { width: 1280, height: 900 } };

async function open(browser, device, url = '/index.html') {
  const context = await browser.newContext(device);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return { context, page };
}

// Builds markup in the page and reads something off it.
function withMarkup(page, html, read) {
  return page.evaluate(({ html, read }) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.querySelector('.main-content-area, main, body').appendChild(host);
    const result = new Function('host', read)(host);
    host.remove();
    return result;
  }, { html, read });
}

// --- "Texts are too large" ---------------------------------------------------

const TEXT = `
  <p class="strategy-paragraph">Reading text.</p>
  <h2 class="section-title">Section</h2>
  <h1 class="character-title">Name</h1>
  <h2 class="skill-title">Skill</h2>
  <h2 class="wiki-block-heading">Heading Block</h2>`;
const SIZES = `
  const px = (sel) => getComputedStyle(host.querySelector(sel)).fontSize;
  return { body: px('.strategy-paragraph'), section: px('.section-title'), name: px('.character-title'),
           skill: px('.skill-title'), heading: parseFloat(px('.wiki-block-heading')) };`;

test('a phone reads 14px text under titles two steps down', async ({ browser }) => {
  const { context, page } = await open(browser, PHONE);
  const sizes = await withMarkup(page, TEXT, SIZES);

  expect(sizes.body).toBe('14px');
  expect(sizes.section).toBe('18px');
  expect(sizes.name).toBe('24px');
  expect(sizes.skill).toBe('20px');
  // A Heading Block sits under a section title, so it is never the bigger one.
  expect(sizes.heading).toBeLessThan(18);
  expect(sizes.heading).toBeGreaterThan(14);
  await context.close();
});

test('a desktop keeps its text sizes', async ({ browser }) => {
  const { context, page } = await open(browser, DESKTOP);
  const sizes = await withMarkup(page, TEXT, SIZES);

  expect(sizes.body).toBe('16px');
  expect(sizes.section).toBe('24px');
  expect(sizes.skill).toBe('28px');
  await context.close();
});

// --- ".section-wiki popping up when pressed on should be disabled" ------------

const PANEL = `<section class="wiki-section" id="probe-panel" style="height: 120px;">Panel</section>`;

async function hoverPanel(page) {
  await page.evaluate((html) => {
    const host = document.createElement('div');
    host.id = 'probe-host';
    host.innerHTML = html;
    document.querySelector('.main-content-area, main, body').prepend(host);
  }, PANEL);
  const panel = page.locator('#probe-panel');
  await panel.scrollIntoViewIfNeeded();
  // A phone keeps :hover on whatever was touched last. Moving the pointer in
  // is the same state, reached without depending on how a tap is emulated.
  await panel.hover();
  await page.waitForTimeout(250);
  return panel.evaluate(el => ({ hovered: el.matches(':hover'), transform: getComputedStyle(el).transform }));
}

test('a panel under a finger stays where it is', async ({ browser }) => {
  const { context, page } = await open(browser, PHONE);
  expect(await page.evaluate(() => matchMedia('(hover: hover)').matches), 'the emulated phone cannot hover').toBe(false);

  const seen = await hoverPanel(page);
  expect(seen.hovered).toBe(true);
  expect(seen.transform).toBe('none');
  await context.close();
});

test('a panel under a mouse still pops', async ({ browser }) => {
  const { context, page } = await open(browser, DESKTOP);
  const seen = await hoverPanel(page);
  expect(seen.hovered).toBe(true);
  expect(seen.transform).not.toBe('none');
  await context.close();
});

// --- "Tables should just be able to scroll horizontally within its own box" ---

const SENTENCE = 'A long sentence about how this tech is done, when it works and what punishes it. '.repeat(4);
const BIG_TABLE = `
  <div class="wiki-table-wrapper"><table class="update-table wiki-content-table">
    <thead><tr><th>Name</th><th>How</th><th>Notes</th></tr></thead>
    <tbody>${[1, 2, 3].map(() => `<tr><td>Tech</td><td>${SENTENCE}</td><td>${SENTENCE}</td></tr>`).join('')}</tbody>
  </table></div>`;
const SMALL_TABLE = `
  <div class="wiki-table-wrapper"><table class="update-table wiki-content-table">
    <tbody><tr><td>A</td><td>1</td></tr></tbody>
  </table></div>`;
const TABLE = `
  const wrap = host.querySelector('.wiki-table-wrapper'), table = wrap.querySelector('table');
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return {
    box: wrap.clientWidth, table: Math.round(table.getBoundingClientRect().width), height: Math.round(table.getBoundingClientRect().height),
    scrollsInBox: wrap.scrollWidth > wrap.clientWidth + 1,
    widestColumn: Math.max(...[...table.rows[table.rows.length - 1].cells].map(c => c.getBoundingClientRect().width)) / rem,
    pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
  };`;

test('on a phone a table of sentences scrolls sideways in its own box', async ({ browser }) => {
  const { context, page } = await open(browser, PHONE);
  const seen = await withMarkup(page, BIG_TABLE, TABLE);

  expect(seen.scrollsInBox, 'the table is wider than its box').toBe(true);
  expect(seen.pageOverflow, 'and the page itself does not scroll sideways').toBeLessThanOrEqual(0);
  // 16rem of text plus the cell's own padding.
  expect(seen.widestColumn).toBeLessThanOrEqual(18.5);
  expect(seen.widestColumn, 'a column of sentences gets room to be read').toBeGreaterThan(12);

  // The same table squeezed into the box is what the card complained about.
  const squeezed = await withMarkup(page, BIG_TABLE.replace('wiki-table-wrapper', 'wiki-table-wrapper" style="display:block'), `
    const t = host.querySelector('table'); t.style.width = '100%'; t.style.minWidth = '0';
    for (const c of t.querySelectorAll('td, th')) c.style.maxWidth = 'none';
    return Math.round(t.getBoundingClientRect().height);`);
  expect(seen.height, 'much shorter than the squeezed table').toBeLessThan(squeezed * 0.7);
  await context.close();
});

test('on a phone a small table still fills its box', async ({ browser }) => {
  const { context, page } = await open(browser, PHONE);
  const seen = await withMarkup(page, SMALL_TABLE, TABLE);

  expect(seen.scrollsInBox).toBe(false);
  expect(seen.table).toBeGreaterThanOrEqual(seen.box - 1);
  await context.close();
});

test('on a desktop a table stays inside its box', async ({ browser }) => {
  const { context, page } = await open(browser, DESKTOP);
  const seen = await withMarkup(page, BIG_TABLE, TABLE);
  expect(seen.scrollsInBox).toBe(false);
  await context.close();
});

// --- "No quick way to start searching", the account, Site Settings, Ko-fi ----

const bar = (page) => page.locator('#mobile-bottom-bar');

// These load a real character page, sign-in dock and all, and a busy machine
// took most of the default 30 seconds doing only that.
test.beforeEach(async ({}, testInfo) => { testInfo.setTimeout(90000); });

async function openBoomcat(browser, device, init) {
  const context = await browser.newContext(device);
  const page = await context.newPage();
  if (init) await init(page);
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#site-search-input')).toBeAttached({ timeout: 20000 });
  return { context, page };
}

test('a phone has a bottom bar with Search, Ko-fi, Settings and the account', async ({ browser }) => {
  const { context, page } = await openBoomcat(browser, PHONE);

  await expect(bar(page)).toBeVisible();
  await expect(bar(page).locator('.mobile-bottom-btn')).toHaveText(['Search', 'Ko-fi', 'Settings', 'Login']);

  // Fixed to the bottom edge, full width, and the page ends above it.
  const place = await page.evaluate(() => {
    const r = document.getElementById('mobile-bottom-bar').getBoundingClientRect();
    return { bottomGap: window.innerHeight - r.bottom, width: r.width, height: r.height,
             room: parseFloat(getComputedStyle(document.body).paddingBottom), screen: window.innerWidth };
  });
  expect(Math.abs(place.bottomGap)).toBeLessThan(1);
  expect(place.width).toBe(place.screen);
  expect(place.room, 'the page makes room, so its last lines are not under the bar').toBeGreaterThanOrEqual(place.height - 1);
  await context.close();
});

test('Search opens the navigation drawer with the search box ready to type in', async ({ browser }) => {
  const { context, page } = await openBoomcat(browser, PHONE);

  await bar(page).locator('[data-bottom="search"]').tap();
  await expect(page.locator('#master-sidebar')).toHaveClass(/mobile-open/);
  await expect(page.locator('#site-search-input')).toBeFocused();
  await context.close();
});

test('Settings opens Site Settings, and the account button opens the sign-in box', async ({ browser }) => {
  const { context, page } = await openBoomcat(browser, PHONE);

  await bar(page).locator('[data-bottom="settings"]').tap();
  await expect(page.locator('#site-settings-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const o = document.getElementById('site-settings-overlay'); if (o) o.remove(); });

  await bar(page).locator('[data-bottom="account"]').tap();
  await expect(page.locator('#auth-modal-overlay')).toBeVisible();
  await context.close();
});

test('Ko-fi goes where the page\'s own Ko-fi button goes', async ({ browser }) => {
  const { context, page } = await openBoomcat(browser, PHONE);

  // The resolved address of each: the page writes "Ko-fi.com", and a browser
  // reads a host back in lower case.
  const own = await page.locator('.kofi-btn-wrapper a').first().evaluate(a => a.href);
  const link = bar(page).locator('[data-bottom="kofi"]');
  expect(own).toMatch(/^https:\/\/ko-fi\.com\/\w+/);
  expect(await link.evaluate(a => a.href)).toBe(own);
  await expect(link).toHaveAttribute('target', '_blank');
  await context.close();
});

test('the edit button sits above the bar, not under it', async ({ browser }) => {
  const { context, page } = await openBoomcat(browser, PHONE);
  await page.evaluate(() => {
    const fab = document.createElement('a');
    fab.className = 'mobile-edit-fab';
    document.body.appendChild(fab);
  });

  const clear = await page.evaluate(() => {
    const fab = document.querySelector('.mobile-edit-fab').getBoundingClientRect();
    const bar = document.getElementById('mobile-bottom-bar').getBoundingClientRect();
    return bar.top - fab.bottom;
  });
  expect(clear).toBeGreaterThan(4);
  await context.close();
});

test('a signed-in reader sees Account, not Login', async ({ browser }) => {
  const { context, page } = await openBoomcat(browser, PHONE, (page) => page.addInitScript(() => {
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (!lib || !lib.createClient || lib.__patched) return;
        lib.__patched = true;
        const orig = lib.createClient.bind(lib);
        lib.createClient = (...args) => {
          const client = orig(...args);
          client.auth.getSession = async () => ({ data: { session: { user: { id: 'u1', email: 'reader@site.test' }, access_token: 't' } } });
          const origFrom = client.from.bind(client);
          client.from = (table) => {
            if (table !== 'user_roles' && table !== 'user_notifications') return origFrom(table);
            const chain = {
              select() { return chain; }, eq() { return chain; },
              single: () => Promise.resolve({ data: null, error: null }),
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
              then(resolve) { return Promise.resolve({ data: [], count: 0, error: null }).then(resolve); },
            };
            return chain;
          };
          client.rpc = async () => ({ data: null, error: null });
          return client;
        };
      },
    });
  }));

  await expect(bar(page).locator('[data-bottom="account"]')).toHaveText('Account', { timeout: 15000 });
  await context.close();
});

test('a desktop has no bottom bar, and its page makes no room for one', async ({ browser }) => {
  const { context, page } = await openBoomcat(browser, DESKTOP);

  await expect(bar(page)).toBeHidden();
  expect(await page.evaluate(() => getComputedStyle(document.body).paddingBottom)).toBe('0px');
  await context.close();
});

// "not counting the editor and review queue": the card is about readers.
test('the editor has no bottom bar and keeps its own text size', async ({ browser }) => {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  await page.goto('/edit.html?char=boomcat&type=character', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await expect(bar(page)).toHaveCount(0);
  expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe('16px');
  await context.close();
});
