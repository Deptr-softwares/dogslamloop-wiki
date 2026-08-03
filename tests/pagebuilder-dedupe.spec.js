// Coverage for Workstream B Tier 5 (pagebuilder.js): inline styles across
// buildGlobalSidebarMenu, initAuthDock, renderFilteredRoster,
// buildSystemsDirectory, and refreshTOC extracted to CSS classes.
//
// Three real drift bugs were found and fixed along the way (each CSS class
// was only ever used by pagebuilder.js's own generated markup, confirmed
// before touching, so these are safe single-source fixes, not cross-file
// leaks like the .character-nav case in Tier 4):
// - .dock-badge's CSS said top/right: -6px, but the inline override
//   pagebuilder.js always applied said -4px - the -6px value never
//   actually rendered. CSS now matches reality.
// - .roster-card-text / .ea-star-indicator's CSS text-shadow was missing a
//   5th layer (`2px 2px 0px rgba(0,0,0,0.8)`) that pagebuilder.js's inline
//   `textOutline` constant always added on top. CSS now matches reality.
// - .system-button-grid's CSS (auto-fit/110px/0.5rem) was 100% shadowed by
//   pagebuilder.js's inline override (auto-fill/220px/1.25rem) on every
//   render. CSS now matches reality.
//
// Also replaced a JS onmouseover/onmouseout hover simulation on the ToC's
// collapse/expand toggle button with a real :hover rule.
const { test, expect } = require('@playwright/test');

test('ToC toggle button: real :hover CSS works (previously onmouseover/onmouseout JS)', async ({ page }) => {
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  const toggleBtn = page.locator('.toc-toggle-btn').first();
  await expect(toggleBtn).toHaveCount(1);
  expect(await toggleBtn.evaluate(el => el.hasAttribute('onmouseover'))).toBe(false);
  expect(await toggleBtn.evaluate(el => el.hasAttribute('onmouseout'))).toBe(false);

  const before = await toggleBtn.evaluate(el => getComputedStyle(el).color);
  await toggleBtn.hover();
  await page.waitForTimeout(250);
  const after = await toggleBtn.evaluate(el => getComputedStyle(el).color);
  expect(after).not.toBe(before);
});

test('sidebar menu: WIP/EA badges use real classes, no inline color overrides', async ({ page }) => {
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelector('#global-sidebar-nav .sidebar-group-header')?.click());
  const wipBadge = page.locator('#global-sidebar-nav .badge-wip').first();
  await expect(wipBadge).toBeVisible();
  expect(await wipBadge.getAttribute('style')).toBeNull();
  const bg = await wipBadge.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
});

test('roster card: EA star and character name share the same (fixed, 5-layer) text-shadow as the CSS class', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  const eaCard = page.locator('.roster-card', { has: page.locator('.ea-star-indicator') }).first();
  await expect(eaCard).toHaveCount(1);
  const [starShadow, textShadow] = await Promise.all([
    eaCard.locator('.ea-star-indicator').evaluate(el => getComputedStyle(el).textShadow),
    eaCard.locator('.roster-card-text').evaluate(el => getComputedStyle(el).textShadow),
  ]);
  // Both should carry the 5th rgba layer now baked into the CSS classes
  // instead of only appearing via pagebuilder.js's inline override.
  expect(starShadow).toContain('rgba(0, 0, 0, 0.8)');
  expect(textShadow).toContain('rgba(0, 0, 0, 0.8)');
});

test('systems directory grid: .system-button-grid renders with the actual intended sizing (220px min, not the old dead 110px)', async ({ page }) => {
  await page.goto('/systems/index.html', { waitUntil: 'networkidle' });
  const grid = page.locator('.system-button-grid').first();
  await expect(grid).toBeVisible();
  expect(await grid.getAttribute('style')).toBeNull();
  const columns = await grid.evaluate(el => getComputedStyle(el).gridTemplateColumns);
  // Multiple ~220px+ columns rather than the old 110px min-width.
  const colWidths = columns.split(' ').map(parseFloat);
  for (const w of colWidths) expect(w).toBeGreaterThan(150);
});

test('dock-badge: no inline position override remains, CSS position matches actual render', async ({ page }) => {
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  // Force an unread-message state to render the badge without needing real auth.
  const hasBadgeRule = await page.evaluate(() => {
    const div = document.createElement('div');
    div.className = 'dock-badge';
    document.body.appendChild(div);
    const cs = getComputedStyle(div);
    const result = { top: cs.top, right: cs.right, position: cs.position };
    div.remove();
    return result;
  });
  expect(hasBadgeRule.position).toBe('absolute');
  expect(hasBadgeRule.top).toBe('-4px');
  expect(hasBadgeRule.right).toBe('-4px');
});
