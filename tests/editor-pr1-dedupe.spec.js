// Coverage for Workstream B, editor.js PR 1/6: core utils + custom tab
// management (top of the file through the DOMContentLoaded bootstrap,
// customConfirm, and addExtraTab/removeExtraTab/updateExtraTabTitle).
//
// Several inline styles here turned out to be fully redundant with values
// their own class already provided (.submit-btn already sets color/
// border-color: var(--accent-blue); .auth-body already sets padding: 1.5rem;
// .auth-modal-box .editor-modal-actions already sets justify-content:
// flex-end) - simply deleted rather than turned into new classes, same
// pattern as the page_render.js remainder PR.
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/edit.html?page=boomcat&type=character&tab=overview', { waitUntil: 'networkidle' });
});

// v1.1: the confirm button is a .btn-sys like every other system button. It
// wore the legacy .submit-btn alias, which copied the old look by hand and so
// could not take the restyle.
test('customConfirm: non-danger button is a blue .btn-sys, no inline color/border/background', async ({ page }) => {
  page.evaluate(() => { window.customConfirm('Test message', 'OK', false); });
  const btn = page.locator('#editor-modal-confirm');
  await expect(btn).toBeVisible();
  expect(await btn.getAttribute('class')).toBe('btn-sys btn-sys-blue');
  expect(await btn.evaluate(el => el.hasAttribute('style'))).toBe(false);
  // Painted by the shared button: the cut corner, not a plain box.
  expect(await btn.evaluate(el => getComputedStyle(el).clipPath)).toContain('polygon');
});

test('customConfirm: danger button still uses btn-danger-fill, no leftover inline styles from a prior non-danger call', async ({ page }) => {
  await page.evaluate(() => { window.customConfirm('First', 'OK', false); });
  // Answered first: a box already asking refuses a second question.
  await page.locator('#editor-modal-cancel').click();
  await expect(page.locator('#editor-custom-modal')).toBeHidden();
  page.evaluate(() => { window.customConfirm('Second', 'DELETE', true); });
  const btn = page.locator('#editor-modal-confirm');
  await expect(btn).toBeVisible();
  expect(await btn.getAttribute('class')).toBe('btn-sys btn-sys-red btn-danger-fill');
  expect(await btn.evaluate(el => el.hasAttribute('style'))).toBe(false);
});

test('openQAModal: the site dialog with no inline styles, 400 wide for Short and 650 for Long, tab switching works', async ({ page }) => {
  page.evaluate(() => { window.openQAModal(false); });
  const overlay = page.locator('#dynamic-qa-modal-overlay');
  await expect(overlay).toBeVisible();
  expect(await overlay.evaluate(el => el.matches('dialog.site-dialog:modal'))).toBe(true);
  expect(await overlay.evaluate(el => el.hasAttribute('style'))).toBe(false);
  const width = () => overlay.evaluate(el => Math.round(el.getBoundingClientRect().width));
  expect(await width()).toBe(400);

  // Short form's textarea: qa-textarea-short must win over .editor-textarea's own min-height: 50px default.
  expect(await overlay.locator('#qa-changelog').evaluate(el => getComputedStyle(el).minHeight)).toBe('80px');

  // Switch to the "Long" form and confirm the width grows + textarea gets the long variant.
  await page.locator('#qa-tab-long').click();
  expect(await width()).toBe(650);
  await expect(overlay.locator('#qa-changelog')).toHaveClass(/qa-textarea-long/);
  expect(await overlay.locator('#qa-changelog').evaluate(el => getComputedStyle(el).minHeight)).toBe('150px');

  // Confirm button carries no redundant inline color/border override.
  const confirmBtn = overlay.locator('#btn-qa-confirm');
  expect(await confirmBtn.evaluate(el => el.hasAttribute('style'))).toBe(false);
});

// edit.html carried a second submit box that nothing opened, with the live box's
// field ids, so a lookup by id could find the dead box's field first.
test('the submit box is the only thing on the page with its field ids', async ({ page }) => {
  page.evaluate(() => { window.openQAModal(false); });
  await expect(page.locator('#dynamic-qa-modal-overlay')).toBeVisible();
  const counts = await page.evaluate(() => ['qa-changelog', 'qa-confidence', 'qa-evidence']
    .map(id => [id, document.querySelectorAll(`#${id}`).length]));
  for (const [id, n] of counts) expect(n, `#${id} at most once`).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => {
    const field = document.getElementById('qa-changelog');
    return !!field && !!field.closest('#dynamic-qa-modal-overlay');
  }), 'a lookup by id finds the field in the box that is open').toBe(true);
});
