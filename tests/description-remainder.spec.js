// Coverage for Workstream B Tier 5 (3/4): description.js's remaining inline
// styles (playstyle component, image/video/table/accordion/combo blocks,
// callout tooltip content, system-page tab grid) extracted to CSS classes.
//
// One real JS-hover-simulation replaced with real CSS (table row hover +
// zebra striping, previously onmouseover/onmouseout plus a manually
// alternated background computed in JS - now a plain CSS :hover and
// :nth-child rule). Several other inline styles turned out to be 100%
// redundant with values their own CSS class already provided (profile-card,
// profile-text-wrapper, section-title, wiki-section's box-sizing/margin) -
// simply deleted rather than turned into new classes.
const { test, expect } = require('@playwright/test');

const TEST_BLOCKS = [
  { type: 'table', headers: ['Move', 'Damage'], rows: [['5A', '4'], ['5B', '6'], ['5C', '8']] },
  {
    type: 'accordion', title: 'Test Section',
    content: [{ type: 'paragraph', content: 'Accordion body text' }],
  },
];

test.beforeEach(async ({ page }) => {
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  await page.evaluate((blocks) => {
    const container = document.createElement('div');
    container.id = 'test-blocks-container';
    container.innerHTML = window.generateHTMLForBlocks(blocks);
    document.body.appendChild(container);
  }, TEST_BLOCKS);
});

test('wiki content table: no inline styles, real :hover + :nth-child replace the old onmouseover/onmouseout row simulation', async ({ page }) => {
  const table = page.locator('#test-blocks-container table.update-table.wiki-content-table');
  await expect(table).toHaveCount(1);
  expect(await table.evaluate(el => el.hasAttribute('style'))).toBe(false);

  const rows = table.locator('tbody tr');
  const firstRow = rows.nth(0);
  const secondRow = rows.nth(1);
  expect(await firstRow.evaluate(el => el.hasAttribute('onmouseover') || el.hasAttribute('onmouseout'))).toBe(false);

  // Zebra striping via :nth-child now, not per-row inline background.
  const [bg1, bg2] = await Promise.all([
    firstRow.evaluate(el => getComputedStyle(el).backgroundColor),
    secondRow.evaluate(el => getComputedStyle(el).backgroundColor),
  ]);
  expect(bg1).not.toBe(bg2);

  // Real :hover now controls the highlight.
  const beforeHover = await firstRow.evaluate(el => getComputedStyle(el).backgroundColor);
  await firstRow.hover();
  await page.waitForTimeout(200);
  const afterHover = await firstRow.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(afterHover).not.toBe(beforeHover);
});

test('accordion block: renders with no embedded <style> tag duplication and no inline styles on summary/body', async ({ page }) => {
  const wrapper = page.locator('#test-blocks-container .wiki-accordion-wrapper');
  await expect(wrapper).toHaveCount(1);
  expect(await wrapper.locator('style').count()).toBe(0);

  const summary = wrapper.locator('.wiki-accordion-summary');
  const styleAttr = await summary.getAttribute('style');
  expect(styleAttr.trim()).toBe('text-align: left;'); // only the dynamic align value remains inline

  const body = wrapper.locator('.wiki-accordion-body');
  await expect(body).toHaveCount(1);
  expect(await body.evaluate(el => el.hasAttribute('style'))).toBe(false);
  await expect(body).toContainText('Accordion body text');
});

test('playstyle component renders likes/dislikes with distinct colors and no inline styles', async ({ page }) => {
  const html = await page.evaluate(() => window.generatePlaystyleHTML({
    likes: ['Aggressive rushdown'],
    dislikes: ['Turtling'],
  }));
  await page.evaluate((html) => {
    const container = document.createElement('div');
    container.id = 'playstyle-test';
    container.innerHTML = html;
    document.body.appendChild(container);
  }, html);

  const likeIcon = page.locator('#playstyle-test .playstyle-icon.likes');
  const dislikeIcon = page.locator('#playstyle-test .playstyle-icon.dislikes');
  expect(await likeIcon.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await dislikeIcon.evaluate(el => el.hasAttribute('style'))).toBe(false);
  const [likeColor, dislikeColor] = await Promise.all([
    likeIcon.evaluate(el => getComputedStyle(el).color),
    dislikeIcon.evaluate(el => getComputedStyle(el).color),
  ]);
  expect(likeColor).not.toBe(dislikeColor);
});

test('system page: dynamic tab grid renders with no redundant inline styles duplicating .wiki-section\'s own CSS', async ({ page }) => {
  await page.goto('/systems/framedata/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const section = page.locator('.system-content-grid-section').first();
  if (await section.count() === 0) test.skip(true, 'page has no populated system sections to check');
  const styleAttr = await section.evaluate(el => el.getAttribute('style'));
  // Only the genuinely dynamic width/margin properties should remain inline;
  // box-sizing and margin-bottom were exact duplicates of .wiki-section's
  // own CSS and were deleted outright.
  expect(styleAttr).not.toContain('box-sizing');
  expect(styleAttr).not.toContain('margin-bottom');
});
