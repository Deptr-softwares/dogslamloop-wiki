// Regression coverage for a real bug reported live by the owner: a
// legitimate reviewer clicked from admin.html to recent-changes.html, then
// used the "Back to Previous Page" button - and got kicked to ACCESS
// DENIED every single time, despite a manual refresh of admin.html always
// working fine. That exact pattern (deterministic, refresh always fixes
// it) is the textbook signature of the browser's back-forward cache
// (bfcache) restoring a frozen snapshot of the page on back/forward
// navigation WITHOUT re-running DOMContentLoaded or the RBAC gate at all.
// Fixed with a pageshow/event.persisted listener that forces a real
// reload whenever the page is restored from bfcache - a no-op on every
// normal page load, since event.persisted is only ever true on a bfcache
// restore.
const { test, expect } = require('@playwright/test');

test('real bug fix: admin.html forces a reload when restored from bfcache, not on a normal page load', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => { window.__testMarker = 'not-reloaded'; });

  const navPromise = page.waitForEvent('framenavigated', { timeout: 3000 }).catch(() => null);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  const nav = await navPromise;

  expect(nav).not.toBeNull();
});

test('admin.html does not force-reload on a normal (non-bfcache) pageshow', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => { window.__testMarker = 'not-reloaded'; });

  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
  });
  await page.waitForTimeout(300);

  const marker = await page.evaluate(() => window.__testMarker);
  expect(marker).toBe('not-reloaded');
});

test('owner.html: same bfcache guard applied (identical RBAC-gate pattern, same vulnerability)', async ({ page }) => {
  await page.goto('/owner.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => { window.__testMarker = 'not-reloaded'; });

  const navPromise = page.waitForEvent('framenavigated', { timeout: 3000 }).catch(() => null);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  const nav = await navPromise;

  expect(nav).not.toBeNull();
});
