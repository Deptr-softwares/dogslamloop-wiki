// Baseline screenshots for the pages most at risk during the inline-CSS
// extraction pass (Workstream B). Run `npx playwright test visual.spec.js
// --update-snapshots` on a clean main before starting a CSS tier, then run
// it again after - any unintended visual change shows up as a diff instead
// of being caught by eye (or missed).
const { test, expect } = require('@playwright/test');

const PAGES = [
  { path: '/index.html', name: 'homepage' },
  { path: '/characters/Boomcat/index.html', name: 'character-page' },
  { path: '/systems/framedata/index.html', name: 'system-page' },
  { path: '/systems/tierlist/index.html', name: 'tierlist-page' },
  { path: '/admin.html', name: 'admin-logged-out' },
  { path: '/edit.html', name: 'edit-logged-out' },
];

for (const { path, name } of PAGES) {
  test(`visual: ${name}`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000); // let async widgets/theme settle
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });
}
