// Site settings (v1.1). Owner, 2026-10-20: "make a user setting to disable
// animated effect, which could set the ground for a site customization feature
// for user in the future." A button beside the account button opens the panel,
// and "Turn off animations" stops everything that moves: the same things the
// device's own reduce-motion setting stops, through one class on <html>
// (js/utility/site_utils.js). Saved per device, signed in or not.
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
  await page.locator('#site-settings-overlay [data-dialog-close]').click();
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

// v1.2: the Classic look (owner, 2026-11-19), one more key in the same store.
// Picking it repaints the page at once, it is still picked after a reload, and
// Default takes it back. tests/look-classic.spec.js covers what it looks like.
test('Look: Classic repaints the page at once and stays after a reload; Default takes it back', async ({ page }) => {
  const ground = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await open(page);
  const usual = await ground();
  await page.locator('#dock-btn-settings').click();
  await expect(page.locator('#site-setting-look-default')).toBeChecked();
  await expect(page.locator('#site-setting-look-default')).toBeFocused();

  await page.locator('#site-setting-look-classic').check();
  await expect(page.locator('html')).toHaveClass(/\blook-classic\b/);
  expect(await ground()).toBe('rgb(16, 20, 24)');
  await page.keyboard.press('Escape');

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveClass(/\blook-classic\b/);
  expect(await ground()).toBe('rgb(16, 20, 24)');
  await page.locator('#dock-btn-settings').click();
  await expect(page.locator('#site-setting-look-classic')).toBeChecked();

  await page.locator('#site-setting-look-default').check();
  await expect(page.locator('html')).not.toHaveClass(/\blook-classic\b/);
  expect(await ground()).toBe(usual);
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

// Every page applies the stored settings in <head>, from one generated block
// (window.applySiteSettings, scripts/page-scripts.js), so nothing a reader picked
// shows its default first. The staff pages had no block until v1.3, so a Classic
// reader could see a frame of Default there.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { settingsTag } = require('../scripts/page-scripts.js');

const ROOT = path.join(__dirname, '..');
const STAFF = ['edit.html', 'overseer.html', 'owner.html', 'tier-editor.html', 'post-editor.html'];

test('every page a reader can stay on carries the settings block in <head>, after its stylesheets', () => {
  const block = settingsTag().trim();
  const pages = execSync('git ls-files "*.html"', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
    .map(rel => ({ rel, html: fs.readFileSync(path.join(ROOT, rel), 'utf8') }))
    // A moved page's stub forwards before anything paints.
    .filter(({ html }) => /<link\b[^>]*rel="stylesheet"/.test(html) && !html.includes('dsl-moved-page'));
  expect(pages.map(p => p.rel)).toEqual(expect.arrayContaining([...STAFF, 'index.html', 'characters/Boomcat/index.html']));
  const wrong = [];
  for (const { rel, html } of pages) {
    const at = html.indexOf(block);
    const lastSheet = [...html.matchAll(/<link\b[^>]*rel="stylesheet"/g)].pop().index;
    if (at < 0 || html.indexOf(block, at + 1) >= 0) wrong.push(`${rel}: not exactly once`);
    else if (at < lastSheet) wrong.push(`${rel}: before a stylesheet`);
    else if (at > html.indexOf('</head>')) wrong.push(`${rel}: outside <head>`);
  }
  expect(wrong).toEqual([]);
});

test('the stored look and motion are on <html> before <body> arrives, on the staff pages too', async ({ page }) => {
  await page.route('**/rest/v1/**', r => r.abort());
  await page.addInitScript(() => {
    try { localStorage.setItem('dsl_site_settings', JSON.stringify({ look: 'classic', motionOff: true })); } catch (e) {}
    // An init script runs before <html> exists: watch the document.
    new MutationObserver((_, obs) => {
      if (!document.body) return;
      window.__classAtBody = document.documentElement.className;
      obs.disconnect();
    }).observe(document, { childList: true, subtree: true });
  });
  const seen = {};
  for (const rel of [...STAFF, 'index.html', 'characters/Boomcat/index.html']) {
    await page.goto(`/${rel}`, { waitUntil: 'domcontentloaded' });
    seen[rel] = await page.evaluate(() => window.__classAtBody.split(/\s+/).filter(c => /^(look-classic|reduce-motion)$/.test(c)).sort().join(' '));
  }
  const want = Object.fromEntries(Object.keys(seen).map(rel => [rel, 'look-classic reduce-motion']));
  expect(seen).toEqual(want);
});

test('a device that asks for less motion has it before <body> arrives, with nothing stored', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    new MutationObserver((_, obs) => {
      if (!document.body) return;
      window.__classAtBody = document.documentElement.className;
      obs.disconnect();
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto('/terms.html', { waitUntil: 'domcontentloaded' });
  expect(await page.evaluate(() => window.__classAtBody)).toMatch(/\breduce-motion\b/);
  expect(await page.evaluate(() => window.__classAtBody)).not.toMatch(/\blook-classic\b/);
});

// The box is js/utility/site_settings.js, loaded the first time it opens: every
// page carries only the store and its opener.
test('the box\'s file loads on the first open, once, with the page\'s stamp, and not before', async ({ page }) => {
  const asked = [];
  page.on('request', r => { if (/js\/utility\/site_settings\.js/.test(r.url())) asked.push(r.url()); });
  await open(page);
  expect(asked).toEqual([]);
  expect(await page.evaluate(() => typeof window.showSiteSettings)).toBe('undefined');

  await page.locator('#dock-btn-settings').click();
  await expect(page.locator('#site-setting-look-default')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#site-settings-overlay')).toBeHidden();
  await page.locator('#dock-btn-settings').click();
  await expect(page.locator('#site-settings-overlay')).toBeVisible();

  expect(asked).toHaveLength(1);
  const stamp = await page.evaluate(() => new URL(document.querySelector('script[src*="js/utility/site_utils.js"]').src).search);
  expect(new URL(asked[0]).search).toBe(stamp);
  expect(await page.locator('#site-settings-overlay').count()).toBe(1);
});

test('a box whose file cannot load says so', async ({ page }) => {
  await page.route('**/js/utility/site_settings.js*', r => r.abort());
  await open(page);
  await page.locator('#dock-btn-settings').click();
  await expect(page.locator('#alert-modal-overlay')).toBeVisible();
  await expect(page.locator('#alert-modal-msg')).toHaveText('Could not open Site settings. Try refreshing.');
});

test('the Classic hint says the look reaches every page', async ({ page }) => {
  await open(page);
  await page.locator('#dock-btn-settings').click();
  const hint = page.locator('label[for="site-setting-look-classic"] .site-setting-hint');
  await expect(hint).toHaveText('A plain, dark wiki look.');
});
