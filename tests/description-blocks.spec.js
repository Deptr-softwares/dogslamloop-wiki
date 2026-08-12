// Coverage for Workstream B Tier 3: description.js divider variants +
// callout button cleanup. Both moved from inline styles to CSS classes;
// the callout also had a *real bug*: Alerts.css already had a proper
// .inline-callout-btn rule (including a :hover state), but description.js
// always set matching properties inline, so the CSS was 100% shadowed and
// the badge was actually driven by onmouseover/onmouseout JS with slightly
// different values. Removing the inline styles lets the real CSS take over.
const { test, expect } = require('@playwright/test');

const TEST_BLOCKS = [
  { type: 'divider', style: 'solid', padding: 'small' },
  { type: 'divider', style: 'dotted' },
  { type: 'divider', style: 'circle' },
  { type: 'divider', style: 'diamond' },
  { type: 'callout', intent: 'warning', content: 'Test warning text' },
];

test.beforeEach(async ({ page }) => {
  // Any page that loads description.js; Boomcat is the established safe test subject.
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  await page.evaluate((blocks) => {
    const container = document.createElement('div');
    container.id = 'test-blocks-container';
    container.innerHTML = window.generateHTMLForBlocks(blocks);
    document.body.appendChild(container);
  }, TEST_BLOCKS);
});

test('divider "solid" with "small" padding renders via CSS classes, not inline styles', async ({ page }) => {
  const wrapper = page.locator('#test-blocks-container .wiki-divider').first();
  await expect(wrapper).toHaveClass(/wiki-divider-pad-small/);
  const line = wrapper.locator('.wiki-divider-line-solid');
  await expect(line).toHaveCount(1);
  expect(await line.evaluate(el => el.getAttribute('style'))).toBeNull();
  expect(await wrapper.evaluate(el => getComputedStyle(el).marginTop)).toBe('16px'); // 1rem
});

test('divider "circle"/"diamond" ornaments render with no inline styles', async ({ page }) => {
  const dot = page.locator('#test-blocks-container .wiki-divider-circle-dot');
  const diamond = page.locator('#test-blocks-container .wiki-divider-diamond-mark');
  await expect(dot).toHaveCount(1);
  await expect(diamond).toHaveCount(1);
  expect(await dot.evaluate(el => el.getAttribute('style'))).toBeNull();
  expect(await diamond.evaluate(el => el.getAttribute('style'))).toBeNull();
  expect(await diamond.evaluate(el => getComputedStyle(el).transform)).not.toBe('none');
});

test('callout badge has no inline layout styles and no onmouseover/onmouseout handlers', async ({ page }) => {
  const badge = page.locator('#test-blocks-container .inline-callout-btn');
  const styleAttr = await badge.getAttribute('style');
  // Only --callout-color should remain inline.
  expect(styleAttr.trim()).toBe('--callout-color: #fb923c;');
  expect(await badge.evaluate(el => el.hasAttribute('onmouseover'))).toBe(false);
  expect(await badge.evaluate(el => el.hasAttribute('onmouseout'))).toBe(false);
});

test('callout badge picks up real :hover CSS from Alerts.css using --callout-color', async ({ page }) => {
  const badge = page.locator('#test-blocks-container .inline-callout-btn');

  const beforeTopBorder = await badge.evaluate(el => getComputedStyle(el).borderTopColor);
  const leftBorder = await badge.evaluate(el => getComputedStyle(el).borderLeftColor);
  // border-left is always tinted by --callout-color (#fb923c -> rgb(251, 146, 60)), even unhovered.
  expect(leftBorder).toBe('rgb(251, 146, 60)');
  // border-top uses the neutral --border-color before hover, so it differs from the left edge.
  expect(beforeTopBorder).not.toBe(leftBorder);

  await badge.hover();

  // Polled, not slept. This was a flat 250ms wait for a 0.15s transition,
  // which assumes the transition starts the instant hover() returns - true on
  // a fast machine, false on a loaded CI runner where the hover is processed
  // late, and the read then lands mid-transition on a colour that is neither
  // the start nor the end. Waiting for the value the rule actually produces
  // needs no estimate of how long it takes to get there.
  //
  // On hover, Alerts.css's :hover rule tints every edge with --callout-color.
  await expect
    .poll(() => badge.evaluate(el => getComputedStyle(el).borderTopColor), { timeout: 5000 })
    .toBe('rgb(251, 146, 60)');
});
