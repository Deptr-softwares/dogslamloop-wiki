// Coverage for Workstream B Tier 5 (4/4): js/tierlist.js's LIVE RENDERER
// section (fetchTierRoster, getCharPortraitHTML, loadTierList,
// switchLiveTierTab) - the public tierlist page and the tier-list branch
// reused by history.html. The EDITOR BUILDER section (contributor
// drag-and-drop tier editor) is deliberately deferred as its own future
// pass, same precedent as editor.js in the original architecture plan.
//
// Real bug caught by the visual-regression suite itself: .tier-nav-overall-btn
// and .tier-nav-matchup-btn set `padding`/`border-color`, properties
// .btn-manga's own base rule also sets at the *same* specificity (both are
// single-class selectors) - a bare class rule only wins by source-order
// luck. It actually lost here: the "Overall" tab button rendered 16px
// shorter than intended (0.35rem base padding instead of the intended
// 0.85rem), shrinking the whole page. Fixed with compound selectors
// (.btn-manga.tier-nav-overall-btn) for a guaranteed, order-independent win.
//
// Also removed 5 confirmed-dead CSS classes (.tier-tabs/.tier-row/
// .tier-label/.tier-characters/.tier-char-tooltip) that had zero references
// anywhere in the codebase - leftover from an earlier iteration of this
// feature that current tierlist.js markup doesn't use.
const { test, expect } = require('@playwright/test');

test('tier-nav-overall-btn: compound selector wins over .btn-manga\'s base padding (the exact bug caught by the visual suite)', async ({ page }) => {
  await page.goto('/systems/tierlist/index.html', { waitUntil: 'networkidle' });
  const btn = page.locator('.tier-nav-overall-btn');
  await expect(btn).toHaveCount(1);
  const padding = await btn.evaluate(el => getComputedStyle(el).paddingTop);
  expect(padding).toBe('13.6px'); // 0.85rem, not .btn-manga's base 0.35rem (5.6px)
});

test('tier-nav-matchup-btn: border-color comes from the per-character --tier-nav-color custom property, not .btn-manga\'s default', async ({ page }) => {
  await page.goto('/systems/tierlist/index.html', { waitUntil: 'networkidle' });
  const buttons = page.locator('.tier-nav-matchup-btn');
  const count = await buttons.count();
  expect(count).toBeGreaterThan(0);
  const firstBorder = await buttons.first().evaluate(el => getComputedStyle(el).borderTopColor);
  const lastBorder = await buttons.last().evaluate(el => getComputedStyle(el).borderTopColor);
  // Different opponents have different character colors, so these should differ
  // (proves the custom property is actually driving the border, not a shared default).
  expect(firstBorder).not.toBe(lastBorder);
});

test('tier portrait renders at the correct fixed size with no inline styles beyond the dynamic background color', async ({ page }) => {
  await page.goto('/systems/tierlist/index.html', { waitUntil: 'networkidle' });
  const portrait = page.locator('.tier-portrait').first();
  await expect(portrait).toBeVisible();
  const styleAttr = await portrait.getAttribute('style');
  expect(styleAttr.trim()).toMatch(/^background-color: .+;$/);
  const size = await portrait.evaluate(el => ({ w: getComputedStyle(el).width, h: getComputedStyle(el).height }));
  expect(size.w).toBe('60px');
  expect(size.h).toBe('60px');
});

test('dead CSS cleanup: .tier-tabs/.tier-row/.tier-label/.tier-characters/.tier-char-tooltip no longer exist in the stylesheet', async ({ page }) => {
  await page.goto('/systems/tierlist/index.html', { waitUntil: 'networkidle' });
  const found = await page.evaluate(() => {
    const testEl = document.createElement('div');
    testEl.className = 'tier-row';
    document.body.appendChild(testEl);
    const bg = getComputedStyle(testEl).backgroundColor;
    testEl.remove();
    // The old .tier-row rule set background: var(--bg-secondary) - a real
    // background color. If the dead rule were still present this would not
    // be transparent.
    return bg;
  });
  expect(found).toBe('rgba(0, 0, 0, 0)');
});

test('tier list row and changelog render with no inline styles beyond the dynamic tier color', async ({ page }) => {
  await page.goto('/systems/tierlist/index.html', { waitUntil: 'networkidle' });
  const row = page.locator('.tier-list-row').first();
  await expect(row).toBeVisible();
  expect(await row.evaluate(el => el.hasAttribute('style'))).toBe(false);

  const label = row.locator('.tier-list-row-label');
  const styleAttr = await label.getAttribute('style');
  expect(styleAttr.trim()).toMatch(/^--tier-row-color: .+;$/);

  const changelogNotes = page.locator('.tier-changelog-notes').first();
  if (await changelogNotes.count() > 0) {
    expect(await changelogNotes.evaluate(el => el.hasAttribute('style'))).toBe(false);
  }
});
