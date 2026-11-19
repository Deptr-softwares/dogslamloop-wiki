// Hover Banners (v1.2, the owner's Kanban card "Hover Banners for every
// characters"):
//
// "When hovering above a character box icon in the roster selection section
// for about 0.25s, a banner pop up that have a custom wide stretch image
// (different from the portrait) with a cut-off Overview. This custom banner is
// editable via the editor. Another big idea for this is that, it will replace
// the embed that will show up in Discord."
//
// Owner, 2026-11-19: "the banner image is uploaded and edited by editors, no
// need for me. Like the character portrait." So the banner is
// desc_data.profile.banner, set in the Profile tab, and the nightly
// regeneration (scripts/fetch-banners.js) mirrors it with the Overview's first
// line into data/banners.json, which the roster and each page's Discord
// preview read.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const { overviewLine, bannerSources, MAX_LINE } = require('../scripts/fetch-banners.js');
const { buildPages } = require('../scripts/generate-pages.js');

// The site's own shortcode stripper, as the script uses it.
const strip = (() => {
  const fakeWindow = {};
  new Function('window', fs.readFileSync(path.join(__dirname, '..', 'js', 'character_tabs.js'), 'utf8'))(fakeWindow);
  return fakeWindow.stripStyleShortcodes;
})();

const para = (content) => ({ type: 'paragraph', content });

// --- THE OVERVIEW LINE ---

test("the Overview line is the first paragraph's words, tags gone", () => {
  expect(overviewLine([
    { type: 'heading', content: 'Not this' },
    para('   '),
    para('A [b]strong[/b] pick with [color=#ff0000]red[/color] [icon=accolade/qte] QTEs, see [url=#sec-tech]Tech[/url].'),
    para('Not the second paragraph.'),
  ], strip)).toBe('A strong pick with red QTEs, see Tech.');

  // A paragraph's lines are one line here.
  expect(overviewLine([para(['First line.', 'Second line.'])], strip)).toBe('First line. Second line.');
  expect(overviewLine([], strip)).toBe(null);
  expect(overviewLine(undefined, strip)).toBe(null);
});

test('a long Overview is cut at a word, under the limit, with "..."', () => {
  const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
  const line = overviewLine([para(words)], strip);
  expect(line.endsWith('...')).toBe(true);
  expect(line.length).toBeLessThanOrEqual(MAX_LINE + 3);
  const kept = line.slice(0, -3);
  expect(words.startsWith(kept)).toBe(true);
  // Whole words only: the next character in the original is the space.
  expect(words.charAt(kept.length)).toBe(' ');
  // A sentence that ends at the cut does not get its full stop before the dots.
  expect(overviewLine([para(`${'a'.repeat(155)}. More words that run past the limit.`)], strip)).toBe(`${'a'.repeat(155)}...`);
});

test('only a character page with a banner or an Overview is listed, and only a web address is a banner', () => {
  const rows = [
    { page_id: 'alpha', desc_data: { profile: { banner: 'https://cdn.example/alpha.webp' }, overview: [para('Alpha line.')] } },
    { page_id: 'beta', desc_data: { profile: { banner: '/medias/images/beta.webp' }, overview: [para('Beta line.')] } },
    { page_id: 'gamma', desc_data: { profile: {}, overview: [] } },
    { page_id: 'a_system_page', desc_data: { tabs: [] } },
    { page_id: 'delta', desc_data: { profile: { banner: 'javascript:alert(1)' } } },
  ];
  expect(bannerSources(rows, strip)).toEqual({
    alpha: { source: 'https://cdn.example/alpha.webp', overview: 'Alpha line.' },
    beta: { overview: 'Beta line.' },
  });
});

// --- THE DISCORD PREVIEW ---

const NAV = {
  Characters: [
    { name: 'Alpha', url: 'characters/Alpha/index.html', cms_config: { pageType: 'character', pageId: 'alpha' } },
    { name: 'Beta', url: 'characters/Beta/index.html', cms_config: { pageType: 'character', pageId: 'beta' } },
    { name: 'Gamma', url: 'characters/Gamma/index.html', cms_config: { pageType: 'character', pageId: 'gamma' } },
  ],
  'Site Info': [
    { name: 'Template & Guide', url: 'characters/Template/index.html', cms_config: { pageType: 'character', pageId: 'template' } },
  ],
};
const meta = (html, attr, name) => new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`).exec(html)[1];

test("a character's Discord preview is its banner and its Overview line, else the portrait and today's line", () => {
  const previews = { alpha: 'https://storage.example/alpha-portrait.webp', beta: 'https://storage.example/beta-portrait.webp' };
  const banners = {
    alpha: { image: 'medias/banners/alpha.webp', overview: 'Alpha & "friends" line.' },
    beta: { overview: 'Beta line.' },
    template: { image: 'medias/banners/template.webp', overview: 'Template line.' },
  };
  const { pages, problems } = buildPages(NAV, previews, {}, new Set(), new Set(), {}, banners);
  expect(problems).toEqual([]);
  const html = (id) => pages.find(p => p.pageId === id).html;

  expect(meta(html('alpha'), 'property', 'og:image')).toBe('https://dogslamloop.com/medias/banners/alpha.webp');
  expect(meta(html('alpha'), 'property', 'og:description')).toBe('Alpha &amp; &quot;friends&quot; line.');
  expect(meta(html('alpha'), 'name', 'description')).toBe('Alpha &amp; &quot;friends&quot; line.');
  expect(meta(html('alpha'), 'name', 'twitter:card')).toBe('summary_large_image');

  // No banner: the portrait, as before, with the Overview line.
  expect(meta(html('beta'), 'property', 'og:image')).toBe('https://storage.example/beta-portrait.webp');
  expect(meta(html('beta'), 'property', 'og:description')).toBe('Beta line.');

  // Neither: exactly as before.
  expect(meta(html('gamma'), 'property', 'og:description')).toBe('Frame data, matchups, and strategy for Gamma in Jujutsu Shenanigans.');

  // The Template is a character page filed under Site Info, not a character.
  expect(meta(html('template'), 'property', 'og:image')).not.toContain('banners');
  expect(meta(html('template'), 'property', 'og:description')).not.toBe('Template line.');
});

// --- THE ROSTER ---

// The first two characters on the roster, whoever they are today: a test that
// named one would go red the day the owner renamed or removed it. The banner
// is the site's logo, a file that is always there.
const LOGO = 'medias/images/DogslamloopIcon.webp';

async function openRoster(page, { url = '/characters/index.html', width = 1440, height = 900 } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'networkidle' });
  const cards = page.locator('.roster-card[data-page-id]');
  await expect(cards.first()).toBeVisible();
  const [withBanner, lineOnly] = await cards.evaluateAll(list => list.slice(0, 2).map(c => c.dataset.pageId));
  // data/banners.json is fetched on the first hover, so a route set now is in
  // time, and a route a test sets after this one wins.
  await page.route('**/data/banners.json*', route => route.fulfill({ json: {
    [withBanner]: { image: LOGO, overview: 'A line from the Overview.' },
    [lineOnly]: { overview: 'A line, and no banner yet.' },
  } }));
  return { withBanner, lineOnly, card: (id) => page.locator(`.roster-card[data-page-id="${id}"]`) };
}
const popup = (page) => page.locator('#roster-banner');

// Where the popup is against its card, in the window's own pixels.
const geometry = (page, id) => page.evaluate((id) => {
  const card = document.querySelector(`.roster-card[data-page-id="${id}"]`).getBoundingClientRect();
  const box = document.getElementById('roster-banner').getBoundingClientRect();
  return {
    card: { top: card.top, bottom: card.bottom, center: card.left + card.width / 2 },
    box: { top: box.top },
    overlaps: !(box.bottom <= card.top || box.top >= card.bottom || box.right <= card.left || box.left >= card.right),
    onScreen: box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight,
  };
}, id);

// Room to scroll whatever the roster's length, then a card this many pixels
// from the top of the window.
const cardAt = (page, id, top) => page.evaluate(({ id, top }) => {
  document.body.style.paddingBottom = '2000px';
  const card = document.querySelector(`.roster-card[data-page-id="${id}"]`);
  window.scrollBy({ top: card.getBoundingClientRect().top - top, behavior: 'instant' });
}, { id, top });

test('hovering a character for a quarter of a second shows its banner, name and Overview line', async ({ page }) => {
  const { withBanner, card } = await openRoster(page);
  await card(withBanner).hover();

  // Not at once: a pointer crossing the roster should not flash every banner.
  await page.waitForTimeout(120);
  await expect(popup(page)).toBeHidden();

  await expect(popup(page)).toBeVisible();
  expect(await popup(page).locator('img.roster-banner-image').getAttribute('src')).toMatch(/medias\/images\/DogslamloopIcon\.webp$/);
  await expect.poll(() => popup(page).locator('img.roster-banner-image').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(popup(page).locator('.roster-banner-name')).toHaveText(await card(withBanner).locator('.roster-card-text').textContent());
  await expect(popup(page).locator('.roster-banner-overview')).toHaveText('A line from the Overview.');

  // In the character's own color, and never covering the card it is about.
  const color = await page.evaluate((id) => {
    const s = document.createElement('span');
    s.style.color = document.querySelector(`.roster-card[data-page-id="${id}"]`).style.getPropertyValue('--char-color');
    document.body.appendChild(s);
    const want = getComputedStyle(s).color;
    s.remove();
    return { want, border: getComputedStyle(document.getElementById('roster-banner')).borderTopColor };
  }, withBanner);
  expect(color.border).toBe(color.want);
  const at = await geometry(page, withBanner);
  expect(at.overlaps, 'the popup covers its card').toBe(false);
  expect(at.onScreen, 'the popup is on screen').toBe(true);

  // Leaving puts it away.
  await page.mouse.move(5, 5);
  await expect(popup(page)).toBeHidden();
});

test('no banner yet shows the line over the character color; neither shows nothing', async ({ page }) => {
  const { withBanner, lineOnly, card } = await openRoster(page);
  await card(lineOnly).hover();
  await expect(popup(page)).toBeVisible();
  await expect(popup(page).locator('img')).toHaveCount(0);
  await expect(popup(page).locator('.roster-banner-band')).toBeVisible();
  await expect(popup(page).locator('.roster-banner-overview')).toHaveText('A line, and no banner yet.');

  // A character absent from data/banners.json has no popup at all.
  const absent = await page.evaluate((known) => [...document.querySelectorAll('.roster-card[data-page-id]')]
    .map(c => c.dataset.pageId).find(id => !known.includes(id)), [withBanner, lineOnly]);
  await card(absent).hover();
  await page.waitForTimeout(600);
  await expect(popup(page)).toBeHidden();
});

test('the Overview line is shown as text, never as HTML', async ({ page }) => {
  const { withBanner, card } = await openRoster(page);
  // Contributor text: the nightly run strips the site's own tags, not HTML.
  const hostile = '<img src=x onerror="window.__bannerPwned = 1">Fast & <b>loud</b>';
  await page.route('**/data/banners.json*', route => route.fulfill({ json: { [withBanner]: { overview: hostile } } }));
  await card(withBanner).hover();
  await expect(popup(page).locator('.roster-banner-overview')).toHaveText(hostile);
  await expect(popup(page).locator('.roster-banner-overview *')).toHaveCount(0);
  expect(await page.evaluate(() => window.__bannerPwned)).toBeUndefined();
});

test('leaving before the banners have loaded opens nothing', async ({ page }) => {
  const { withBanner, card } = await openRoster(page);
  // The first hover fetches the file. On a slow connection the pointer can be
  // gone before it arrives, and nothing may open for a card it has left.
  let arrive;
  const arrived = new Promise(resolve => { arrive = resolve; });
  await page.route('**/data/banners.json*', async route => {
    await arrived;
    await route.fulfill({ json: { [withBanner]: { overview: 'A late line.' } } });
  });
  await card(withBanner).hover();
  await page.waitForTimeout(400); // the quarter second is up, the file is not here
  await page.mouse.move(5, 5);
  const response = page.waitForResponse('**/data/banners.json*');
  arrive();
  await response;
  await page.waitForTimeout(300);
  await expect(popup(page)).toBeHidden();
});

test('a keyboard user gets the banner on focus', async ({ page }) => {
  const { withBanner, lineOnly, card } = await openRoster(page);
  // Real keyboard focus: from the second card back to the first.
  await card(lineOnly).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(card(withBanner)).toBeFocused();
  await expect(popup(page)).toBeVisible();
  await expect(popup(page).locator('.roster-banner-overview')).toHaveText('A line from the Overview.');
  await expect(card(withBanner)).toHaveAttribute('aria-describedby', 'roster-banner');
  await card(withBanner).blur();
  await expect(popup(page)).toBeHidden();
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true });

  test('a tap opens the page with no popup on the way, and a finger held down shows none', async ({ page }) => {
    const { withBanner, card } = await openRoster(page);
    // Stay on the roster, to see what the tap left behind.
    await page.evaluate(() => document.addEventListener('click', e => e.preventDefault(), true));
    await card(withBanner).tap();
    await expect(card(withBanner), 'the tap reached the card').toBeFocused();
    await page.waitForTimeout(600);
    await expect(popup(page)).toBeHidden();

    // A finger held on the card, through the browser's own touch input.
    const box = await card(withBanner).boundingBox();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
    await page.waitForTimeout(600);
    await expect(popup(page)).toBeHidden();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  });
});

test('near the top of the window the popup opens below its card, and in a narrow window it stays inside', async ({ page }) => {
  const wide = await openRoster(page);
  await cardAt(page, wide.withBanner, 40);
  await wide.card(wide.withBanner).hover();
  await expect(popup(page)).toBeVisible();
  let at = await geometry(page, wide.withBanner);
  expect(at.box.top, 'below the card').toBeGreaterThanOrEqual(at.card.bottom);
  expect(at.onScreen, 'on screen').toBe(true);

  // Here the first card of a row sits near the window's left edge.
  const narrow = await openRoster(page, { width: 800 });
  await narrow.card(narrow.withBanner).hover();
  await expect(popup(page)).toBeVisible();
  at = await geometry(page, narrow.withBanner);
  expect(at.card.center - 180, 'a 360px popup centered on this card would cross the 16px edge').toBeLessThan(16);
  expect(at.onScreen, 'on screen').toBe(true);
  expect(at.overlaps, 'clear of its card').toBe(false);
});

test('a popup that is showing follows its card when the page scrolls', async ({ page }) => {
  const { withBanner, card } = await openRoster(page);
  await cardAt(page, withBanner, 200);
  await card(withBanner).hover();
  await expect(popup(page)).toBeVisible();
  const before = await geometry(page, withBanner);

  await page.evaluate(() => window.scrollBy({ top: 20, behavior: 'instant' }));
  await expect.poll(async () => {
    const now = await geometry(page, withBanner);
    return { moved: Math.round(before.card.top - now.card.top), gap: Math.round(now.box.top - now.card.top) };
  }).toEqual({ moved: 20, gap: Math.round(before.box.top - before.card.top) });
});

test('a filter pressed from the keyboard under a popup puts it away', async ({ page }) => {
  // Tall enough that nothing scrolls: the roster stays where the pointer is.
  const { card } = await openRoster(page, { height: 1400 });
  // The last card: once EA Only leaves the Early Access characters alone in
  // the first row, nothing is where it was.
  const last = await page.locator('.roster-card[data-page-id]').last().getAttribute('data-page-id');
  await page.route('**/data/banners.json*', route => route.fulfill({ json: { [last]: { overview: 'A line.' } } }));
  await card(last).hover();
  await expect(popup(page)).toBeVisible();
  const box = await card(last).boundingBox();

  // The pointer rests on the card while the keyboard presses EA Only: the card
  // goes, and no pointer event says so.
  await page.locator('#filter-ea').evaluate(button => button.focus({ preventScroll: true }));
  await page.keyboard.press('Space');
  await expect(page.locator('#filter-ea')).toHaveClass(/\bactive\b/);
  const cardUnderPointer = await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.roster-card')),
    { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(cardUnderPointer, 'no card is left under the pointer, or this test proves nothing').toBe(false);
  await expect(popup(page)).toBeHidden();
});

test('the home page roster has the banners too, and a site without the file still has its roster', async ({ page }) => {
  // The home page roster sits below the fold, so reaching a card is a scroll.
  const home = await openRoster(page, { url: '/index.html' });
  await home.card(home.withBanner).hover();
  await expect(popup(page)).toBeVisible();
  await expect(popup(page).locator('.roster-banner-overview')).toHaveText('A line from the Overview.');

  const other = await page.context().newPage();
  await other.route('**/data/banners.json*', route => route.fulfill({ status: 404, body: 'missing' }));
  await other.setViewportSize({ width: 1440, height: 900 });
  await other.goto('/characters/index.html', { waitUntil: 'networkidle' });
  const card = other.locator('.roster-card[data-page-id]').first();
  await card.hover();
  await other.waitForTimeout(600);
  await expect(other.locator('#roster-banner')).toBeHidden();
  await expect(card).toBeVisible();
});

// --- THE EDITOR ---

function mockEditor(page, profile) {
  return page.addInitScript((profile) => {
    const desc = { profile, overview: [{ type: 'paragraph', content: 'Hi.' }] };
    const rowsFor = (table) => {
      if (table === 'page_data') return { data: { page_id: 'boomcat', desc_data: desc, frame_data: { m1s: [], skills: [], specials: [] } }, error: null };
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
  }, profile);
}

test("the Profile tab's Banner field sets the banner, previews it, and an emptied field removes it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // A saved banner that would break out of the field if it were not escaped.
  const hostile = '"><img id="pwned-banner" src=x>';
  await mockEditor(page, { image: `/${LOGO}`, banner: hostile, stats: [] });
  await page.goto('/edit.html?char=boomcat&type=character&tab=overview', { waitUntil: 'domcontentloaded' });
  await page.locator('#overview-nav-profile').click({ timeout: 45000 });
  const field = page.locator('#profile-banner-input');
  await expect(field).toBeVisible({ timeout: 45000 });
  await expect(field).toHaveValue(hostile);
  await expect(page.locator('#pwned-banner')).toHaveCount(0);
  const stored = () => page.evaluate(() => window.currentEditorDescData.profile);

  // The banner card sits under the portrait's.
  const order = await page.evaluate(() => {
    const portrait = document.getElementById('profile-image-input').closest('.block-card');
    const banner = document.getElementById('profile-banner-input').closest('.block-card');
    return portrait.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  expect(order).toBeTruthy();

  await field.fill(`/${LOGO}`);
  expect((await stored()).banner).toBe(`/${LOGO}`);
  await expect(page.locator('#profile-banner-img')).toHaveAttribute('src', `/${LOGO}`);

  // Gone, not an empty string: an untouched page and an emptied field are the
  // same data, so clearing it is not a change to review. Spaces alone too.
  await field.fill('');
  expect(await stored()).not.toHaveProperty('banner');
  await expect(page.locator('#profile-banner-img')).toHaveCount(0);
  await field.fill('   ');
  expect(await stored()).not.toHaveProperty('banner');
});
