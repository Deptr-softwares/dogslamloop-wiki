// One line under every title (owner, 2026-11-16): "currently the site is using
// two different divider for its section and the section title, I suggest only
// use one". The pick was solid under every title, with dashed left for the
// lines between the rows of a list.
//
// The elements are built here, with the classes the pages use, so the check
// reads the stylesheet and not whatever content the owner has on a page today.
const { test, expect } = require('@playwright/test');

async function lineUnder(page, html, selector) {
  return page.evaluate(({ html, selector }) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    const cs = getComputedStyle(host.querySelector(selector));
    const seen = { style: cs.borderBottomStyle, width: cs.borderBottomWidth, top: cs.borderTopStyle };
    host.remove();
    return seen;
  }, { html, selector });
}

const TITLES = [
  ['a section title', '<h2 class="section-title">T</h2>', '.section-title'],
  ['a sidebar title', '<h3 class="sidebar-master-title">T</h3>', '.sidebar-master-title'],
  ['a group title on the Systems page', '<div class="system-category-block"><h3 class="sidebar-master-title">T</h3></div>', '.sidebar-master-title'],
  ['a group title in a dashboard column', '<h3 class="column-subgroup-title">T</h3>', '.column-subgroup-title'],
  ['the Contributors title', '<div class="contributors-header">T</div>', '.contributors-header'],
  ['an Update Log part title', '<h4 class="update-changes-heading">T</h4>', '.update-changes-heading'],
  // Its line takes the callout's colour from a variable the block sets inline.
  ['a tooltip title', '<strong class="callout-tooltip-title" style="--tooltip-accent: #3b82f6;">T</strong>', '.callout-tooltip-title'],
];

test('every title has a solid line under it', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  for (const [name, html, selector] of TITLES) {
    const seen = await lineUnder(page, html, selector);
    expect(seen.style, name).toBe('solid');
    expect(parseFloat(seen.width), `${name} still has a line`).toBeGreaterThan(0);
  }
});

test('the lines between the rows of a list stay dashed', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  const row = await lineUnder(page, '<ul><li class="recent-edit-row">a</li><li class="recent-edit-row">b</li></ul>', '.recent-edit-row');
  expect(row.style).toBe('dashed');
  const faq = await lineUnder(page, '<div class="faq-content">a</div>', '.faq-content');
  expect(faq.top).toBe('dashed');
});

// The real page, once: the group titles in the dashboard's columns are the
// ones the owner was looking at.
test('the dashboard draws its group titles with that solid line', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  const titles = page.locator('#systems-grid .sidebar-master-title, .column-subgroup-title');
  await expect(titles.first()).toBeVisible({ timeout: 15000 });
  const styles = await titles.evaluateAll(nodes => Array.from(new Set(nodes.map(el => getComputedStyle(el).borderBottomStyle))));
  expect(styles).toEqual(['solid']);
});
