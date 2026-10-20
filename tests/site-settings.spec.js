// Site settings (v1.1). Owner, 2026-10-20: "make a user setting to disable
// animated effect, which could set the ground for a site customization feature
// for user in the future." A button beside the account button opens the panel,
// and "Turn off animations" stops everything that moves: the same things the
// device's own reduce-motion setting stops, through one class on <html>
// (js/site_utils.js). Saved per device, signed in or not.
//
// The button shares the account button's row because a row of its own would
// push the account button down, out of sight on a short screen (owner).
const { test, expect } = require('@playwright/test');

const PAGE = '/characters/Ten_shadows/index.html';

async function open(page) {
  await page.goto(PAGE, { waitUntil: 'networkidle' });
  await expect(page.locator('#dock-btn-auth')).toBeVisible();
}

async function setAnimationsOff(page, off) {
  await page.locator('#dock-btn-settings').click();
  const box = page.locator('#site-setting-motion-off');
  await expect(box).toBeVisible();
  if (off) await box.check(); else await box.uncheck();
  await page.locator('[data-site-settings-close]').click();
  await expect(page.locator('#site-settings-overlay')).toBeHidden();
}

// The account button's own hover: how long it takes, and where it ends up.
async function hoverAccount(page) {
  const btn = page.locator('#dock-btn-auth');
  await btn.hover();
  await page.waitForTimeout(300);
  return btn.evaluate(el => {
    const cs = getComputedStyle(el);
    return { longest: Math.max(...cs.transitionDuration.split(',').map(parseFloat)), transform: cs.transform };
  });
}

test('the settings button shares the account button\'s row, so the account button does not move down', async ({ page }) => {
  await open(page);
  const [auth, settings, dock] = await page.evaluate(() => ['#dock-btn-auth', '#dock-btn-settings', '#sidebar-dynamic-dock']
    .map(sel => document.querySelector(sel).getBoundingClientRect().toJSON()));
  expect(Math.abs(settings.top - auth.top)).toBeLessThan(1);
  expect(settings.left).toBeGreaterThan(auth.right);
  // Nothing in the dock below the account row.
  const below = await page.evaluate(bottom => [...document.querySelectorAll('#sidebar-dynamic-dock button, #sidebar-dynamic-dock a')]
    .filter(el => el.getBoundingClientRect().top >= bottom).length, auth.bottom);
  expect(below).toBe(0);
  expect(dock.bottom).toBeGreaterThanOrEqual(auth.bottom);
});

test('Turn off animations stops the hover lift and the transition, and stays off after a reload', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await open(page);

  const moving = await hoverAccount(page);
  expect(moving.longest).toBeGreaterThan(0.05);
  expect(moving.transform).not.toBe('none');

  await page.mouse.move(0, 0);
  await setAnimationsOff(page, true);
  await expect(page.locator('html')).toHaveClass(/\breduce-motion\b/);
  const still = await hoverAccount(page);
  expect(still.longest).toBeLessThan(0.001);
  expect(still.transform).toBe('none');

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveClass(/\breduce-motion\b/);
  await page.locator('#dock-btn-settings').click();
  await expect(page.locator('#site-setting-motion-off')).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.locator('#site-settings-overlay')).toBeHidden();

  await setAnimationsOff(page, false);
  await expect(page.locator('html')).not.toHaveClass(/\breduce-motion\b/);
  expect(errors).toEqual([]);
});

test('with the box unticked, the device\'s own reduce-motion setting still applies', async ({ page }) => {
  await open(page);
  await expect(page.locator('html')).not.toHaveClass(/\breduce-motion\b/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveClass(/\breduce-motion\b/);
  await page.locator('#dock-btn-settings').click();
  await expect(page.locator('#site-setting-motion-off')).not.toBeChecked();
  const still = await page.evaluate(() => getComputedStyle(document.getElementById('dock-btn-auth')).transitionDuration);
  expect(Math.max(...still.split(',').map(parseFloat))).toBeLessThan(0.001);
});

test('a jump from the contents scrolls instantly with animations off, smoothly with them on', async ({ page }) => {
  const jumpBehaviour = async () => {
    await page.evaluate(() => {
      window.__scrolls = [];
      const real = window.scrollTo.bind(window);
      window.scrollTo = (opts) => { window.__scrolls.push(opts && opts.behavior); real(opts); };
    });
    const link = page.locator('#dynamic-toc a.toc-link-major').last();
    await expect(link).toBeVisible();
    await link.click();
    await expect.poll(() => page.evaluate(() => window.__scrolls.length)).toBeGreaterThan(0);
    return page.evaluate(() => window.__scrolls[0]);
  };

  await open(page);
  expect(await jumpBehaviour()).toBe('smooth');

  await setAnimationsOff(page, true);
  expect(await jumpBehaviour()).toBe('auto');
});

test('when the browser blocks saving, the panel says so and the setting still holds on this page', async ({ page }) => {
  await page.addInitScript(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'dsl_site_settings') throw new Error('blocked');
      return real.call(this, key, value);
    };
  });
  await open(page);
  await page.locator('#dock-btn-settings').click();
  await page.locator('#site-setting-motion-off').check();
  await expect(page.locator('.site-settings-error')).toBeVisible();
  await expect(page.locator('.site-settings-error')).toContainText('blocked saving');
  await expect(page.locator('html')).toHaveClass(/\breduce-motion\b/);
});
