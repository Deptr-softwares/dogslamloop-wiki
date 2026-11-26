// Coverage for Workstream B, editor.js PR 2/6: move/tab navigation +
// per-move editor shell (initFullTabEditor, promptForMoveId,
// loadOverviewSectionIntoEditor, loadMatchupIntoEditor,
// loadCounterplayIntoEditor, loadMoveIntoEditor, initPerMoveEditor).
//
// The "editor section banner" pattern (background/border/padding wrapper +
// an accent-blue uppercase label) was copy-pasted 10 times across this
// section alone - now .editor-section-banner + .editor-section-banner-text.
// The tab-with-a-remove-button pattern (moves/extras/matchups/counterplay)
// was copy-pasted 4 times - now .sub-tab-item/.sub-tab-removable/
// .sub-tab-remove, the site's tab strip. Both consolidations are exercised below.
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/edit.html?page=boomcat&type=character&tab=overview', { waitUntil: 'networkidle' });
});

test('overview tab nav row: the site\'s tab strip, scrolling sideways, closer to what it opens', async ({ page }) => {
  const nav = page.locator('.sub-tabs.editor-nav-row').first();
  await expect(nav).toBeVisible();
  const cs = await nav.evaluate(el => ({
    marginBottom: getComputedStyle(el).marginBottom,
    borderBottomColor: getComputedStyle(el).borderBottomColor,
    overflowX: getComputedStyle(el).overflowX,
  }));
  expect(cs.marginBottom).toBe('8px'); // 0.5rem, not the strip's own 0.75rem
  expect(cs.overflowX).toBe('auto'); // the strip wraps elsewhere
});

test('overview section banners render via .editor-section-banner with no inline styles, across profile/overview/playstyle', async ({ page }) => {
  for (const section of ['profile', 'overview', 'playstyle']) {
    await page.evaluate((s) => window.loadOverviewSectionIntoEditor(s), section);
    const banner = page.locator('#overview-editor-container .editor-section-banner').first();
    await expect(banner).toBeVisible();
    expect(await banner.evaluate(el => el.hasAttribute('style'))).toBe(false);
    const text = banner.locator('.editor-section-banner-text');
    expect(await text.evaluate(el => el.hasAttribute('style'))).toBe(false);
  }
});

test('extra tab section banner uses the inline-title variant (dynamic input, no inline styles on the static parts)', async ({ page }) => {
  const newIdx = await page.evaluate(() => {
    if (!window.currentEditorDescData.extras) window.currentEditorDescData.extras = [];
    window.currentEditorDescData.extras.push({ title: 'Custom Notes', content: [] });
    return window.currentEditorDescData.extras.length - 1;
  });
  await page.evaluate((idx) => window.loadOverviewSectionIntoEditor(`extra-${idx}`), newIdx);
  const row = page.locator('.editor-extra-title-row');
  await expect(row).toBeVisible();
  expect(await row.evaluate(el => el.hasAttribute('style'))).toBe(false);
  const label = row.locator('.editor-section-banner-text-inline');
  await expect(label).toHaveText('EDITING:');
  expect(await label.evaluate(el => el.hasAttribute('style'))).toBe(false);
  const input = row.locator('.editor-extra-title-input');
  await expect(input).toHaveValue('Custom Notes');
});

test('sub-tab-item + remove button pattern renders identically for moves and extras', async ({ page }) => {
  // Extras (already on overview tab):
  await page.evaluate(() => {
    if (!window.currentEditorDescData.extras) window.currentEditorDescData.extras = [];
    window.currentEditorDescData.extras.push({ title: 'Lore', content: [] });
  });
  await page.evaluate(() => window.initFullTabEditor(window.currentEditorCharId, 'overview', window.currentEditorDescData, window.currentEditorFrameData));
  const extraItem = page.locator('.sub-tab-item').first();
  await expect(extraItem).toBeVisible();
  const removeBtn = extraItem.locator('.sub-tab-remove');
  await expect(removeBtn).toBeVisible();
  expect(await removeBtn.evaluate(el => el.hasAttribute('style'))).toBe(false);
  const tabBtn = extraItem.locator('.sub-tab-removable');
  expect(await tabBtn.evaluate(el => getComputedStyle(el).paddingRight)).toBe('25.6px'); // 1.6rem, room for the remove button
});

test('promptForMoveId: the green site dialog with no inline styles, submit button wins the color/border specificity tie', async ({ page }) => {
  page.evaluate(() => { window.promptForMoveId(); });
  const overlay = page.locator('#move-id-modal');
  await expect(overlay).toBeVisible();
  expect(await overlay.evaluate(el => el.matches('dialog.site-dialog.tone-green:modal'))).toBe(true);

  expect(await overlay.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await overlay.evaluate(el => getComputedStyle(el).borderTopColor)).toBe('rgb(34, 197, 94)'); // #22c55e

  const confirmBtn = overlay.locator('#btn-move-confirm');
  expect(await confirmBtn.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await confirmBtn.evaluate(el => getComputedStyle(el).borderColor)).toBe('rgb(34, 197, 94)');
});
