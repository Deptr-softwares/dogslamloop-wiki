// Regression coverage for a real pre-existing bug found while converting
// system pages to the v0.9 router.
//
// js/pagebuilder.js's initTabEditorButtons adds the class
// `sidebar-tab-header-stacked` to the right sidebar's header container so the
// title stacks above the Edit/History buttons instead of sitting beside them.
// But the rule that does the stacking is a COMPOUND selector -
// `.sidebar-tab-header.sidebar-tab-header-stacked` (style/Layout.css) - and
// every system page styled that container with an inline `style` attribute
// rather than the `.sidebar-tab-header` class. So the compound selector never
// matched, the container stayed flex-direction: row, and the EDIT PAGE button
// was pushed off the right edge of the screen: measured at 1494px on a 1440px
// viewport, 54px out of view, on desktop.
//
// Character pages used the class and were unaffected, which is why this went
// unnoticed - the two templates diverged on exactly the attribute that made
// the rule apply.
//
// Fixed by the router emitting one skeleton that uses the class for both page
// types.
const { test, expect } = require('@playwright/test');

// All 8 routed system pages - every one of them carried this bug. The four
// bespoke system pages (collaborators, tierlist, updatelog, color-codes) are
// deliberately excluded: they are hand-authored and outside the router, so
// they are not covered by this fix.
const ROUTED_SYSTEM_PAGES = [
  'evasive', 'framedata', 'fundamentals', 'hud',
  'm1-trading', 'starter-guide', 'terminologies', 'writing_guide',
];
const CHARACTER_PAGES = ['Boomcat', 'Vessel'];

for (const dir of ROUTED_SYSTEM_PAGES) {
  test(`real bug fix: ${dir}'s sidebar header stacks, keeping the edit button on screen`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/systems/${dir}/index.html`, { waitUntil: 'networkidle' });
    // initTabEditorButtons runs async (it awaits navigation data) before it
    // adds the class and injects the History button.
    await expect(page.locator('#btn-history-current-tab')).toBeAttached();

    const result = await page.evaluate(() => {
      const header = document.querySelector('.local-sidebar-right > div');
      const editBtn = document.getElementById('btn-edit-current-tab');
      return {
        hasBaseClass: header.classList.contains('sidebar-tab-header'),
        flexDirection: getComputedStyle(header).flexDirection,
        editBtnRight: editBtn.getBoundingClientRect().right,
        viewportWidth: window.innerWidth,
      };
    });

    // The base class is what makes the compound rule match at all.
    expect(result.hasBaseClass).toBe(true);
    expect(result.flexDirection).toBe('column');
    expect(result.editBtnRight).toBeLessThanOrEqual(result.viewportWidth);
  });
}

for (const dir of CHARACTER_PAGES) {
  test(`${dir}: character pages keep the stacking they already had`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/characters/${dir}/index.html`, { waitUntil: 'networkidle' });
    await expect(page.locator('#btn-history-current-tab')).toBeAttached();

    const result = await page.evaluate(() => {
      const header = document.querySelector('.local-sidebar-right > div');
      const editBtn = document.getElementById('btn-edit-current-tab');
      return {
        flexDirection: getComputedStyle(header).flexDirection,
        editBtnRight: editBtn.getBoundingClientRect().right,
        viewportWidth: window.innerWidth,
      };
    });

    expect(result.flexDirection).toBe('column');
    expect(result.editBtnRight).toBeLessThanOrEqual(result.viewportWidth);
  });
}
