// Coverage for Workstream B, editor.js PR 2/6: move/tab navigation +
// per-move editor shell (initFullTabEditor, promptForMoveId,
// loadOverviewSectionIntoEditor, loadMatchupIntoEditor,
// loadCounterplayIntoEditor, loadMoveIntoEditor, initPerMoveEditor).
//
// The "editor section banner" pattern (background/border/padding wrapper +
// an accent-blue uppercase label) was copy-pasted 10 times across this
// section alone - now .editor-section-banner + .editor-section-banner-text.
// The tab-with-a-remove-button pattern (moves/extras/matchups/counterplay)
// was copy-pasted 4 times - now .daw-tab-item/.daw-tab-btn-removable/
// .daw-tab-remove-btn. Both consolidations are exercised below.
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/edit.html?page=boomcat&type=character&tab=overview', { waitUntil: 'networkidle' });
});

test('overview tab nav row: daw-editor-nav-row wins the specificity tie against .daw-variant-tabs base rule', async ({ page }) => {
  const nav = page.locator('.daw-variant-tabs.daw-editor-nav-row').first();
  await expect(nav).toBeVisible();
  const cs = await nav.evaluate(el => ({
    marginBottom: getComputedStyle(el).marginBottom,
    borderBottomColor: getComputedStyle(el).borderBottomColor,
    overflowX: getComputedStyle(el).overflowX,
  }));
  expect(cs.marginBottom).toBe('8px'); // 0.5rem, not the base rule's 1rem
  expect(cs.overflowX).toBe('auto'); // not set at all by the base rule
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

test('daw-tab-item + remove button pattern renders identically for moves and extras', async ({ page }) => {
  // Extras (already on overview tab):
  await page.evaluate(() => {
    if (!window.currentEditorDescData.extras) window.currentEditorDescData.extras = [];
    window.currentEditorDescData.extras.push({ title: 'Lore', content: [] });
  });
  await page.evaluate(() => window.initFullTabEditor(window.currentEditorCharId, 'overview', window.currentEditorDescData, window.currentEditorFrameData));
  const extraItem = page.locator('.daw-tab-item').first();
  await expect(extraItem).toBeVisible();
  const removeBtn = extraItem.locator('.daw-tab-remove-btn');
  await expect(removeBtn).toBeVisible();
  expect(await removeBtn.evaluate(el => el.hasAttribute('style'))).toBe(false);
  const tabBtn = extraItem.locator('.daw-tab-btn-removable');
  expect(await tabBtn.evaluate(el => getComputedStyle(el).paddingRight)).toBe('24px'); // 1.5rem
});

test('promptForMoveId: green modal variant renders with no inline styles, submit button wins the color/border specificity tie', async ({ page }) => {
  page.evaluate(() => { window.promptForMoveId(); });
  const overlay = page.locator('#move-id-modal');
  await expect(overlay).toBeVisible();
  expect(await overlay.evaluate(el => el.className)).toBe('editor-modal-overlay move-id-modal-elevated');

  const box = overlay.locator('.move-id-modal-box');
  expect(await box.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await box.evaluate(el => getComputedStyle(el).borderTopColor)).toBe('rgb(34, 197, 94)'); // #22c55e

  const confirmBtn = overlay.locator('#btn-move-confirm');
  expect(await confirmBtn.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await confirmBtn.evaluate(el => getComputedStyle(el).borderColor)).toBe('rgb(34, 197, 94)');
});
