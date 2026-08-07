// Coverage for the sitewide footer added in v0.8. The site had no <footer>
// element anywhere at all, and the MIT LICENSE at the repo root was linked
// from nothing. Rather than editing 41 HTML files, the footer is injected by
// js/pagebuilder.js's buildSiteFooter on DOMContentLoaded.
const { test, expect } = require('@playwright/test');

// The links are built from window.getRootPath(), which resolves differently
// per folder depth - a footer that works on the homepage and 404s from a
// character page would be worse than no footer.
const DEPTHS = [
  { label: 'root', url: '/index.html', prefix: './' },
  { label: 'one level deep', url: '/systems/index.html', prefix: '../' },
  { label: 'two levels deep', url: '/characters/Boomcat/index.html', prefix: '../../' },
];

for (const { label, url, prefix } of DEPTHS) {
  test(`footer renders at ${label} with correctly depth-resolved links`, async ({ page }) => {
    await page.goto(url, { waitUntil: 'networkidle' });

    const footer = page.locator('#site-footer');
    await expect(footer).toBeAttached();

    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#site-footer a')).map(a => a.getAttribute('href'))
    );
    expect(hrefs).toContain(`${prefix}privacy-policy.html`);
    expect(hrefs).toContain(`${prefix}LICENSE`);
  });
}

test('the privacy policy link actually resolves from a deep page (not a 404)', async ({ page }) => {
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#site-footer')).toBeAttached();

  const href = await page.locator('#site-footer a[href$="privacy-policy.html"]').getAttribute('href');
  const response = await page.request.get(new URL(href, page.url()).toString());
  expect(response.status()).toBe(200);
});

test('editor-family pages are excluded (their layout could never scroll to a footer)', async ({ page }) => {
  // edit.html/admin.html/owner.html are the only 3 pages without .site-layout,
  // and they load editor.css's unconditional body { overflow: hidden } - a
  // footer appended there would exist but be permanently unreachable.
  for (const url of ['/edit.html', '/admin.html', '/owner.html']) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    expect(await page.locator('#site-footer').count(), `${url} should not get a footer`).toBe(0);
  }
});

test('buildSiteFooter is idempotent (a second call does not duplicate the footer)', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => { window.buildSiteFooter(); window.buildSiteFooter(); });
  await expect(page.locator('#site-footer')).toHaveCount(1);
});
