// Regression coverage for a real bug caught during Workstream B Tier 1:
// editor.css had its own separate .editor-modal-overlay rule (loaded after
// style/Modals.css's shared one) that set display:none. The original inline
// style.display='flex' toggling always won on specificity, masking the
// conflict. Converting to classList.remove('hidden') exposed it - every
// modal using .editor-modal-overlay (editor.js AND admin.js, both load
// editor.css) rendered display:none even when "open". Fixed by removing the
// conflicting declaration from editor.css. This test would have caught it.
const { test, expect } = require('@playwright/test');

test('edit.html: editorAlert modal actually becomes visible when opened', async ({ page }) => {
  await page.goto('/edit.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => window.editorAlert('test'));
  await expect(page.locator('#editor-alert-modal')).toBeVisible();
  await expect(page.locator('#editor-alert-modal')).toHaveCSS('display', 'flex');
});

test('edit.html: customConfirm modal actually becomes visible when opened', async ({ page }) => {
  await page.goto('/edit.html', { waitUntil: 'networkidle' });
  page.evaluate(() => { window.customConfirm('test'); }); // fire and forget, don't await the promise
  await expect(page.locator('#editor-custom-modal')).toBeVisible();
  await expect(page.locator('#editor-custom-modal')).toHaveCSS('display', 'flex');
});

test('.editor-modal-overlay class resolves to display:flex when unhidden (shared by editor.js and admin.js)', async ({ page }) => {
  // Both edit.html and admin.html load editor.css; this checks the class
  // itself rather than any specific page's auth-gated modal.
  await page.goto('/edit.html', { waitUntil: 'networkidle' });
  const display = await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'editor-modal-overlay';
    document.body.appendChild(el);
    const d = getComputedStyle(el).display;
    el.remove();
    return d;
  });
  expect(display).toBe('flex');
});
