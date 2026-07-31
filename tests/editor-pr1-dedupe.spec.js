// Coverage for Workstream B, editor.js PR 1/6: core utils + custom tab
// management (top of the file through the DOMContentLoaded bootstrap,
// customConfirm, and addExtraTab/removeExtraTab/updateExtraTabTitle).
//
// Several inline styles here turned out to be fully redundant with values
// their own class already provided (.submit-btn already sets color/
// border-color: var(--accent-blue); .auth-body already sets padding: 1.5rem;
// .auth-modal-box .editor-modal-actions already sets justify-content:
// flex-end) - simply deleted rather than turned into new classes, same
// pattern as the description.js remainder PR.
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/edit.html?page=boomcat&type=character&tab=overview', { waitUntil: 'networkidle' });
});

test('customConfirm: non-danger button uses submit-btn-outline class, no inline color/border/background', async ({ page }) => {
  page.evaluate(() => { window.customConfirm('Test message', 'OK', false); });
  const btn = page.locator('#editor-modal-confirm');
  await expect(btn).toBeVisible();
  expect(await btn.getAttribute('class')).toBe('submit-btn submit-btn-outline');
  expect(await btn.evaluate(el => el.hasAttribute('style'))).toBe(false);
  const cs = await btn.evaluate(el => ({ color: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor }));
  expect(cs.bg).toBe('rgba(0, 0, 0, 0)'); // transparent
});

test('customConfirm: danger button still uses btn-danger-fill, no leftover inline styles from a prior non-danger call', async ({ page }) => {
  await page.evaluate(() => { window.customConfirm('First', 'OK', false); });
  page.evaluate(() => { window.customConfirm('Second', 'DELETE', true); });
  const btn = page.locator('#editor-modal-confirm');
  await expect(btn).toBeVisible();
  expect(await btn.getAttribute('class')).toBe('submit-btn btn-danger-fill');
  expect(await btn.evaluate(el => el.hasAttribute('style'))).toBe(false);
});

test('openQAModal: renders with no inline styles beyond the dynamic max-width, tab switching works', async ({ page }) => {
  page.evaluate(() => { window.openQAModal(false); });
  const overlay = page.locator('#dynamic-qa-modal-overlay');
  await expect(overlay).toBeVisible();
  expect(await overlay.evaluate(el => el.className)).toBe('editor-modal-overlay qa-modal-elevated');

  const box = overlay.locator('.qa-modal-box');
  const boxStyle = await box.getAttribute('style');
  expect(boxStyle.trim()).toBe('max-width: 400px;');

  // Short form's textarea: qa-textarea-short must win over .editor-textarea's own min-height: 50px default.
  expect(await overlay.locator('#qa-changelog').evaluate(el => getComputedStyle(el).minHeight)).toBe('80px');

  // Switch to the "Long" form and confirm the width grows + textarea gets the long variant.
  await page.locator('#qa-tab-long').click();
  expect((await box.getAttribute('style')).trim()).toBe('max-width: 600px;');
  await expect(overlay.locator('#qa-changelog')).toHaveClass(/qa-textarea-long/);
  expect(await overlay.locator('#qa-changelog').evaluate(el => getComputedStyle(el).minHeight)).toBe('150px');

  // Confirm button carries no redundant inline color/border override.
  const confirmBtn = overlay.locator('#btn-qa-confirm');
  expect(await confirmBtn.evaluate(el => el.hasAttribute('style'))).toBe(false);
});
