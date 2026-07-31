// Coverage for Workstream B Tier 4: character page template dedupe.
// 9 of the 11 repeated inline-style blocks in characters/*/index.html were
// extracted to CSS classes in style/Layout.css. Two were deliberately left
// alone (see below). A real bug was caught while doing this: .character-nav
// is also reused by js/history.js and systems/tierlist/index.html's static
// nav with a *different* margin convention (margin-bottom, not margin-top)
// - a bare .character-nav rule would have leaked margin-top/align-items
// onto those unrelated elements, since inline styles only override the
// specific properties they set. Fixed by scoping to .character-header
// .character-nav, which only wraps a nav in the character page template.
const { test, expect } = require('@playwright/test');

test('character page: .character-nav inside .character-header gets margin-top and align-items from CSS', async ({ page }) => {
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  const nav = page.locator('header.character-header nav.character-nav');
  await expect(nav).toHaveAttribute('class', 'character-nav'); // no inline style attribute
  const cs = await nav.evaluate(el => ({ marginTop: getComputedStyle(el).marginTop, alignItems: getComputedStyle(el).alignItems }));
  expect(cs.marginTop).toBe('24px'); // 1.5rem
  expect(cs.alignItems).toBe('center');
});

test('tierlist system page: its own static .character-nav (not inside .character-header) is unaffected by the character-page rule', async ({ page }) => {
  await page.goto('/systems/tierlist/index.html', { waitUntil: 'networkidle' });
  const nav = page.locator('#tier-tabs-container.character-nav');
  // This element sets margin-bottom (not margin-top) inline; the shared
  // .character-header .character-nav rule must not add an unrequested
  // margin-top here (the regression this test guards against).
  const marginTop = await nav.evaluate(el => getComputedStyle(el).marginTop);
  expect(marginTop).toBe('0px');
});

test('previously-drifted Vessel/Template .character-nav now render identically to every other character page (align-items fix)', async ({ page }) => {
  for (const slug of ['Vessel', 'Template']) {
    await page.goto(`/characters/${slug}/index.html`, { waitUntil: 'networkidle' });
    const nav = page.locator('header.character-header nav.character-nav');
    const alignItems = await nav.evaluate(el => getComputedStyle(el).alignItems);
    expect(alignItems, `${slug} .character-nav align-items`).toBe('center');
  }
});

test('#btn-edit-current-tab and #btn-edit-current-tab-mobile keep their inline styles (pagebuilder.js clones .style.cssText onto sibling History buttons)', async ({ page }) => {
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  const desktopStyle = await page.locator('#btn-edit-current-tab').getAttribute('style');
  const mobileStyle = await page.locator('#btn-edit-current-tab-mobile').getAttribute('style');
  expect(desktopStyle).toContain('font-size');
  expect(mobileStyle).toContain('font-size');
});
