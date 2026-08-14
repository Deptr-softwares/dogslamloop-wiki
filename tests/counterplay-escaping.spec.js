// The counterplay card's header (js/description.js).
//
// It is the same card shape as the matchup header twenty lines above it, which
// was escaped in v0.13 - this one was deliberately left alone at the time to
// keep that PR to its two items, and stayed unescaped through v0.14. Both
// values are contributor-submitted and land in an innerHTML sink.
//
// Fixed 2026-08-15, straight after the shortcode engine turned up three live
// injection holes of exactly this class.

const { test, expect } = require('@playwright/test');

const CRUCIAL_COLOR = 'rgb(239, 68, 68)';
const FALLBACK_COLOR = 'rgb(156, 163, 175)';

const desc = (counterplay) => ({
    overview: [], strategy: [], extras: [], matchups: [], moveStrategies: {},
    counterplay,
});

// Seeded before navigation, deliberately - the same reasoning as
// matchup-tiers.spec.js. Setting it afterwards leaves the page's own boot
// still in flight and its render lands on top, which passes in isolation and
// fails under a loaded suite. The helper is duplicated rather than shared:
// this project prefers a copied five-liner to a new cross-file dependency.
async function renderLive(page, data) {
    await page.addInitScript((d) => { window.currentEditorDescData = d; }, data);
    await page.goto('/characters/Boomcat/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => window.loadPageDescriptions('boomcat'));
}

test('a counterplay topic is escaped, not parsed as markup', async ({ page }) => {
    await renderLive(page, desc([
        { topic: '<img src=x onerror="window.__xss=1">Punish', importance: 'Crucial', content: [] },
    ]));

    const title = page.locator('#tab-counterplay .card-header-title');
    // Visible as the text somebody typed...
    await expect(title).toContainText('<img src=x');
    // ...and not as an element.
    await expect(title.locator('img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('an importance value is escaped too', async ({ page }) => {
    await renderLive(page, desc([
        { topic: 'Spacing', importance: '<img src=x onerror="window.__xss2=1">High', content: [] },
    ]));

    const label = page.locator('#tab-counterplay .card-tier-label');
    await expect(label).toContainText('<img src=x');
    await expect(label.locator('img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss2)).toBeUndefined();
});

test('a quote in either field cannot open a new attribute', async ({ page }) => {
    await renderLive(page, desc([
        { topic: '" onmouseover="window.__xss3=1', importance: '" onmouseover="window.__xss4=1', content: [] },
    ]));

    const handlers = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#tab-counterplay *')).flatMap(el =>
            Array.from(el.attributes)
                .filter(a => a.name.toLowerCase().startsWith('on'))
                .map(a => `${el.tagName.toLowerCase()}[${a.name}]`)));

    expect(handlers).toEqual([]);
});

// The other half of the fix: escaping must not have broken what the header is
// for. importance selects a colour from a hardcoded map rather than supplying
// one, which is why impColor is interpolated unescaped and is allowed to be.
test('importance still picks its colour, and an unknown one falls back', async ({ page }) => {
    await renderLive(page, desc([
        { topic: 'Whiff punish', importance: 'Crucial', content: [] },
        { topic: 'Corner escape', importance: 'Not A Real Importance', content: [] },
    ]));

    const labels = page.locator('#tab-counterplay .card-tier-label');
    await expect(labels).toHaveCount(2);

    expect(await labels.nth(0).evaluate(el => getComputedStyle(el).color)).toBe(CRUCIAL_COLOR);
    expect(await labels.nth(1).evaluate(el => getComputedStyle(el).color)).toBe(FALLBACK_COLOR);

    // A hostile importance cannot smuggle a colour in through the map either.
    await expect(labels.nth(1)).toHaveText('Not A Real Importance');
});

test('a card with no topic says Unknown rather than undefined', async ({ page }) => {
    await renderLive(page, desc([{ importance: 'Low', content: [] }]));

    await expect(page.locator('#tab-counterplay .card-header-title')).toHaveText('Unknown');
});
