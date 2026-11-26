// The site's toast (window.showToast, js/utility/site_utils.js): a short message in
// the top right corner that goes by itself. Seven messages that only said something
// worked opened a box that had to be closed, and BADGE EARNED, the one toast there
// was, drew under any open box. Over an open box the toast now lives inside it:
// everything outside a modal box is inert, so a toast drawn over the box from the
// page could be seen and not clicked, and a click on its close button closed the box.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const PAGE = '/search.html';

async function load(page, viewport = { width: 1280, height: 800 }) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize(viewport);
  await page.clock.install();
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.showToast === 'function');
  return errors;
}

const toasts = (page) => page.locator('.site-toast');

// What is under the middle of an element: it, or something drawn over it.
async function onTop(locator) {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el === hit || el.contains(hit);
  });
}

test('a toast shows in the top right corner and goes by itself after 5 seconds', async ({ page }) => {
  const errors = await load(page);
  await page.evaluate(() => window.showToast('Replaced 3 occurrence(s).'));

  const toast = toasts(page);
  await expect(toast).toBeVisible();
  await expect(toast.locator('.site-toast-head')).toHaveText('DONE');
  await expect(toast.locator('.site-toast-msg')).toHaveText('Replaced 3 occurrence(s).');
  // Measured once it has risen into place.
  await expect(toast).not.toHaveClass(/is-new/);
  const box = await toast.boundingBox();
  expect(Math.round(1280 - (box.x + box.width)), 'against the right edge').toBeLessThanOrEqual(24);
  expect(box.y, 'against the top').toBeLessThanOrEqual(24);
  // Green, the colour of done, from the page's own stylesheet.
  await expect(toast).toHaveCSS('border-top-color', 'rgb(34, 197, 94)');

  await page.clock.fastForward(4500);
  await expect(toast).toBeVisible();
  await page.clock.fastForward(1000);
  await expect(toast).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('hovering a toast keeps it, and leaving it starts the wait again', async ({ page }) => {
  await load(page);
  await page.evaluate(() => window.showToast('Revision declined and author notified.'));
  const toast = toasts(page);
  await toast.hover();
  await page.clock.fastForward(12000);
  await expect(toast).toBeVisible();

  await page.mouse.move(200, 600);
  await page.clock.fastForward(4500);
  await expect(toast).toBeVisible();
  await page.clock.fastForward(1000);
  await expect(toast).toHaveCount(0);
});

test('its close button takes it away, the newest is on top, and three show at most', async ({ page }) => {
  await load(page);
  await page.evaluate(() => {
    ['one', 'two', 'three', 'four'].forEach(m => window.showToast(m));
  });
  await expect(toasts(page)).toHaveCount(3);
  await expect(toasts(page).locator('.site-toast-msg')).toHaveText(['four', 'three', 'two']);
  const tops = await toasts(page).evaluateAll(els => els.map(e => e.getBoundingClientRect().top));
  expect(tops[0]).toBeLessThan(tops[1]);
  expect(tops[1]).toBeLessThan(tops[2]);

  await toasts(page).first().getByRole('button', { name: 'Close' }).click();
  await expect(toasts(page).locator('.site-toast-msg')).toHaveText(['three', 'two']);

  // With the last one gone the shelf is closed, its screen reader line with it.
  await toasts(page).first().getByRole('button', { name: 'Close' }).click();
  await toasts(page).first().getByRole('button', { name: 'Close' }).click();
  await expect(toasts(page)).toHaveCount(0);
  await expect(page.locator('.site-toasts')).toHaveCSS('display', 'none');
});

test('over an open box a toast is drawn above it, and closing the toast leaves the box open', async ({ page }) => {
  const errors = await load(page);
  // siteConfirm closes on a click outside: a click landing on the box instead of
  // the toast closes the box.
  await page.evaluate(() => { window.siteConfirm('Delete it?'); });
  const box = page.locator('#site-confirm-modal');
  await expect(box).toBeVisible();

  await page.evaluate(() => window.showToast('Version restored - the page is now live with this content.'));
  const close = toasts(page).getByRole('button', { name: 'Close' });
  await expect(close).toBeVisible();
  expect(await onTop(close), 'the toast is on top of the box and can be clicked').toBe(true);
  await close.click();
  await expect(toasts(page)).toHaveCount(0);
  await expect(box).toBeVisible();
  expect(errors).toEqual([]);
});

test('a box that opens while a toast shows takes it along, and gives it back when it closes', async ({ page }) => {
  await load(page);
  await page.evaluate(() => window.showToast('Successfully merged 2 tickets!'));
  const toast = toasts(page);
  await expect(toast).toBeVisible();

  await page.evaluate(() => { window.siteConfirm('Delete it?'); });
  await expect(page.locator('#site-confirm-modal')).toBeVisible();
  expect(await onTop(toast), 'above the box that opened after it').toBe(true);

  await page.keyboard.press('Escape');
  await expect(page.locator('#site-confirm-modal')).toBeHidden();
  await expect(toast).toBeVisible();
  expect(await onTop(toast)).toBe(true);
});

test('on a phone a toast spans the top of the screen', async ({ page }) => {
  await load(page, { width: 390, height: 844 });
  await page.evaluate(() => window.showToast('Replaced 3 occurrence(s).'));
  await expect(toasts(page)).not.toHaveClass(/is-new/);
  const box = await toasts(page).boundingBox();
  expect(Math.round(box.x)).toBe(12);
  expect(Math.round(box.x + box.width)).toBe(390 - 12);
  expect(Math.round(box.y)).toBe(12);
});

test('a screen reader is told what it says', async ({ page }) => {
  await load(page);
  await page.evaluate(() => window.showToast('Replaced 3 occurrence(s).'));
  const said = page.locator('.site-toasts [role="status"]');
  await page.clock.fastForward(200);
  await expect(said).toHaveText('DONE: Replaced 3 occurrence(s).');
});

test('signing in with a password says so in a toast, not a box', async ({ page }) => {
  const errors = await load(page);
  await page.evaluate(() => {
    window.supabaseClient.auth.signInWithPassword = async () => ({ error: null });
    window.checkActiveSession = async () => {};
    window.openAuthModal();
  });
  await expect(page.locator('#auth-modal-overlay')).toBeVisible();
  await page.locator('#auth-email-login').fill('reader@site.test');
  await page.locator('#auth-password-login').fill('hunter22');
  await page.locator('#btn-auth-action-login').click();

  await expect(toasts(page).locator('.site-toast-msg')).toHaveText('Authentication successful! You are now securely connected.');
  await expect(page.locator('#auth-modal-overlay')).toBeHidden();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('BADGE EARNED is a toast in the same corner, and its LOGIN opens the Sign In box', async ({ page }) => {
  const errors = await load(page);
  // Signed out, so the badge waits on the device and the toast says how to keep it.
  await page.evaluate(() => window.earnBadge('halloween-2026-gold'));
  const toast = page.locator('.site-toast.badge-toast');
  await expect(toast.locator('.site-toast-head')).toHaveText('BADGE EARNED');
  await expect(toast.locator('.site-toast-msg')).toHaveText('DSL Halloween 2026 - Gold Ver');
  await expect(toast).toHaveCSS('border-top-color', 'rgb(242, 201, 76)');
  await expect(toast).not.toHaveClass(/is-new/);
  const box = await toast.boundingBox();
  expect(box.y, 'the top right, with every toast').toBeLessThanOrEqual(24);

  await toast.getByRole('button', { name: 'LOGIN' }).click();
  await expect(page.locator('#auth-modal-overlay')).toBeVisible();
  await expect(toast).toHaveCount(0);
  expect(errors).toEqual([]);
});

// The seven messages that only say something worked. Each is driven through its own
// control in its own spec (find-and-replace, submission-continuation, admin-soft-reject,
// page-kind-from-list, admin-page-history, admin-merge-delta, and the sign-in above);
// this keeps any of them from going back to a box.
test('the success messages are toasts, never boxes', () => {
  const root = path.join(__dirname, '..', 'js');
  const files = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach(d => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) { if (d.name !== 'vendor') walk(p); } else if (p.endsWith('.js')) files.push(p);
  });
  walk(root);
  const source = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
  const SUCCESSES = [
    'Authentication successful!', 'Replaced ${count} occurrence(s).', 'Your submission is updated.',
    'Revision approved and merged', 'Revision declined and author notified.',
    'Version restored - the page is now live', 'Successfully merged ${selectedTicketIds.size} tickets!',
  ];
  for (const words of SUCCESSES) {
    expect(source, `"${words}" is still in the code`).toContain(words);
    const before = source.slice(Math.max(0, source.indexOf(words) - 60), source.indexOf(words));
    expect(before, `"${words}" is shown by showToast`).toMatch(/showToast\(\s*(isSelfEdit\s*\?\s*)?["'`]?$/);
  }
});
