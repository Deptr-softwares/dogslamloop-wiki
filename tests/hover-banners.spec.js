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

const BANNERS = {
  boomcat: { image: 'medias/portraits/boomcat.webp', overview: 'Boomcat line, from its Overview.' },
  vessel: { overview: 'Vessel line, no banner yet.' },
};

async function openRoster(page, url = '/characters/index.html', banners = BANNERS) {
  await page.route('**/data/banners.json*', route => route.fulfill({ json: banners }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: 'networkidle' });
  await expect(page.locator('.roster-card[data-page-id="boomcat"]')).toBeVisible();
}
const popup = (page) => page.locator('#roster-banner');

test('hovering a character for a quarter of a second shows its banner, name and Overview line', async ({ page }) => {
  await openRoster(page);
  const card = page.locator('.roster-card[data-page-id="boomcat"]');
  await card.hover();

  // Not at once: a pointer crossing the roster should not flash every banner.
  await page.waitForTimeout(120);
  await expect(popup(page)).toBeHidden();

  await expect(popup(page)).toBeVisible();
  expect(await popup(page).locator('img.roster-banner-image').getAttribute('src')).toMatch(/medias\/portraits\/boomcat\.webp$/);
  await expect.poll(() => popup(page).locator('img.roster-banner-image').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(popup(page).locator('.roster-banner-name')).toHaveText(await card.locator('.roster-card-text').textContent());
  await expect(popup(page).locator('.roster-banner-overview')).toHaveText('Boomcat line, from its Overview.');

  // In the character's own color, and never covering the card it is about.
  const look = await page.evaluate(() => {
    const card = document.querySelector('.roster-card[data-page-id="boomcat"]').getBoundingClientRect();
    const pop = document.getElementById('roster-banner');
    const box = pop.getBoundingClientRect();
    return {
      border: getComputedStyle(pop).borderTopColor,
      want: (() => { const s = document.createElement('span'); s.style.color = document.querySelector('.roster-card[data-page-id="boomcat"]').style.getPropertyValue('--char-color'); document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; })(),
      overlaps: !(box.bottom <= card.top || box.top >= card.bottom || box.right <= card.left || box.left >= card.right),
      onScreen: box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight,
    };
  });
  expect(look.border).toBe(look.want);
  expect(look.overlaps, 'the popup covers its card').toBe(false);
  expect(look.onScreen, 'the popup is on screen').toBe(true);

  // Leaving puts it away.
  await page.mouse.move(5, 5);
  await expect(popup(page)).toBeHidden();
});

test('no banner yet shows the line over the character color; neither shows nothing', async ({ page }) => {
  await openRoster(page);
  await page.locator('.roster-card[data-page-id="vessel"]').hover();
  await expect(popup(page)).toBeVisible();
  await expect(popup(page).locator('img')).toHaveCount(0);
  await expect(popup(page).locator('.roster-banner-band')).toBeVisible();
  await expect(popup(page).locator('.roster-banner-overview')).toHaveText('Vessel line, no banner yet.');

  // A character absent from data/banners.json has no popup at all.
  const absent = await page.evaluate(() => [...document.querySelectorAll('.roster-card[data-page-id]')]
    .map(c => c.dataset.pageId).find(id => id !== 'boomcat' && id !== 'vessel'));
  await page.locator(`.roster-card[data-page-id="${absent}"]`).hover();
  await page.waitForTimeout(600);
  await expect(popup(page)).toBeHidden();
});

test('a keyboard user gets the banner on focus, and a tap gets none', async ({ page }) => {
  await openRoster(page);
  const card = page.locator('.roster-card[data-page-id="boomcat"]');
  await card.focus();
  await expect(popup(page)).toBeVisible();
  await expect(card).toHaveAttribute('aria-describedby', 'roster-banner');
  await card.blur();
  await expect(popup(page)).toBeHidden();

  // A finger has no hover, and a tap opens the page, as it always did.
  await card.dispatchEvent('pointerover', { pointerType: 'touch', bubbles: true });
  await page.waitForTimeout(600);
  await expect(popup(page)).toBeHidden();
});

test('the home page roster has the banners too, and a site without the file still has its roster', async ({ page }) => {
  await openRoster(page, '/index.html');
  await page.locator('.roster-card[data-page-id="boomcat"]').hover();
  await expect(popup(page)).toBeVisible();
  await expect(popup(page).locator('.roster-banner-overview')).toHaveText('Boomcat line, from its Overview.');

  const other = await page.context().newPage();
  await other.route('**/data/banners.json*', route => route.fulfill({ status: 404, body: 'missing' }));
  await other.setViewportSize({ width: 1440, height: 900 });
  await other.goto('/characters/index.html', { waitUntil: 'networkidle' });
  const card = other.locator('.roster-card[data-page-id="boomcat"]');
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
  await mockEditor(page, { image: '/medias/portraits/boomcat.webp', stats: [] });
  await page.goto('/edit.html?char=boomcat&type=character&tab=overview', { waitUntil: 'domcontentloaded' });
  await page.locator('#overview-nav-profile').click({ timeout: 45000 });
  const field = page.locator('#profile-banner-input');
  await expect(field).toBeVisible({ timeout: 45000 });
  const stored = () => page.evaluate(() => window.currentEditorDescData.profile);

  // The banner card sits under the portrait's.
  const order = await page.evaluate(() => {
    const portrait = document.getElementById('profile-image-input').closest('.block-card');
    const banner = document.getElementById('profile-banner-input').closest('.block-card');
    return portrait.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  expect(order).toBeTruthy();

  await field.fill('/medias/portraits/boomcat.webp');
  expect((await stored()).banner).toBe('/medias/portraits/boomcat.webp');
  await expect(page.locator('#profile-banner-img')).toHaveAttribute('src', '/medias/portraits/boomcat.webp');

  // Gone, not an empty string: an untouched page and an emptied field are the
  // same data, so clearing it is not a change to review.
  await field.fill('');
  expect(await stored()).not.toHaveProperty('banner');
  await expect(page.locator('#profile-banner-img')).toHaveCount(0);
});
