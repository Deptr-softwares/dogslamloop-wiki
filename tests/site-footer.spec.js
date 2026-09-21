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
    expect(hrefs).toContain(`${prefix}terms.html`);
    // v0.20: two licences now - MIT for the code, CC BY-NC-SA for the content -
    // so the footer points at CONTENT-LICENSE.md, which states both and links
    // to LICENSE. The bare `LICENSE` link this asserted until v0.19 is gone.
    expect(hrefs).toContain(`${prefix}CONTENT-LICENSE.md`);
  });
}

test('every footer link actually resolves from a deep page (not a 404)', async ({ page }) => {
  // Was the privacy link alone. Widened when Terms and the content licence were
  // added, because "the link is in the markup" is not the claim this file
  // exists to make - a footer that 404s does it on every page of the site at
  // once, and the depth-resolution above is exactly the thing that gets it
  // wrong.
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#site-footer')).toBeAttached();

  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#site-footer a')).map(a => a.getAttribute('href'))
  );
  expect(hrefs.length).toBeGreaterThan(0);

  for (const href of hrefs) {
    const response = await page.request.get(new URL(href, page.url()).toString());
    expect(response.status(), `${href} resolves`).toBe(200);
  }
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
