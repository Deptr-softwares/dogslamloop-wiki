// The editor's and the site's message and confirm boxes open, show and close, and
// the old box overlay (a div shown and hidden by class) is not used again.
const { test, expect } = require('@playwright/test');

test('edit.html: editorAlert modal actually becomes visible when opened', async ({ page }) => {
  await page.goto('/edit.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => window.editorAlert('test'));
  await expect(page.locator('#editor-alert-modal')).toBeVisible();
  await expect(page.locator('#editor-alert-modal')).toHaveCSS('display', 'flex');
});

test('edit.html: ACKNOWLEDGE closes the editor message box', async ({ page }) => {
  await page.goto('/edit.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => window.editorAlert('test'));
  const box = page.locator('#editor-alert-modal');
  await expect(box).toBeVisible();
  await box.getByRole('button', { name: 'ACKNOWLEDGE' }).click();
  await expect(box).toBeHidden();
});

test('the system message box closes on ACKNOWLEDGE', async ({ page }) => {
  await page.goto('/privacy-policy.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => window.showSystemAlert('test'));
  const box = page.locator('#alert-modal-overlay');
  await expect(box).toBeVisible();
  await expect(box.locator('#alert-modal-msg')).toHaveText('test');
  await box.getByRole('button', { name: 'ACKNOWLEDGE' }).click();
  await expect(box).toBeHidden();
});

test('edit.html: customConfirm modal actually becomes visible when opened', async ({ page }) => {
  await page.goto('/edit.html', { waitUntil: 'networkidle' });
  page.evaluate(() => { window.customConfirm('test'); }); // fire and forget, don't await the promise
  await expect(page.locator('#editor-custom-modal')).toBeVisible();
  await expect(page.locator('#editor-custom-modal')).toHaveCSS('display', 'flex');
});

test('no page, script or stylesheet uses the old box overlay: every box is a dialog', () => {
  // The old family (a full-screen div shown and hidden by class, with a z-index
  // per box) is gone; a box built on it again would sit under any open dialog.
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..');
  const OLD = /\b(editor-modal-overlay|editor-modal-box|editor-modal-actions|auth-modal-box|auth-header|auth-body|editor-notice-overlay|modal-danger|modal-warning|modal-actions-centered)\b/;
  const files = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', '.git', 'tests', 'vendor', 'test-results', 'supabase', 'medias', 'devlogs'].includes(e.name) && !e.name.startsWith('.')) walk(p); }
    else if (/\.(js|html|css)$/.test(e.name)) files.push(p);
  });
  ['js', 'style'].forEach(d => walk(path.join(root, d)));
  fs.readdirSync(root).filter(n => n.endsWith('.html')).forEach(n => files.push(path.join(root, n)));
  const hits = files.filter(p => OLD.test(fs.readFileSync(p, 'utf8'))).map(p => path.relative(root, p));
  expect(files.length, 'the scan reached the code').toBeGreaterThan(50);
  expect(hits).toEqual([]);
});
