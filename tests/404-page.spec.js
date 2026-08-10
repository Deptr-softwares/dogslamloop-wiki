// Coverage for the custom 404 page added in v0.8. GitHub Pages serves a
// root-level 404.html automatically for any unmatched path on a custom domain
// (see CNAME) - before this the site had none, so a bad link produced
// GitHub's generic branded error page with no way back into the wiki.
const { test, expect } = require('@playwright/test');

test('404.html renders the full site chrome so a lost visitor can navigate out', async ({ page }) => {
  await page.goto('/404.html', { waitUntil: 'networkidle' });

  await expect(page.locator('.home-main-title')).toContainText('404');
  // The real navigation menu, not just a dead-end error message.
  await expect(page.locator('#global-sidebar-nav')).not.toContainText('Loading menu');
  await expect(page.locator('#global-sidebar-nav a').first()).toBeAttached();
});

test('404.html links to all three hubs', async ({ page }) => {
  await page.goto('/404.html', { waitUntil: 'networkidle' });

  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('main a.btn-sys')).map(a => a.getAttribute('href'))
  );
  expect(hrefs).toEqual(expect.arrayContaining([
    '/index.html', '/characters/index.html', '/systems/index.html',
  ]));
});

test('404.html resolves its assets from the site root regardless of the URL depth that triggered it', async ({ page }) => {
  // The whole point of the <base href="/"> tag: this one file gets served for
  // /nonsense, /characters/Bogus/index.html, /a/b/c/d alike, and relative
  // paths would otherwise resolve against whichever depth the visitor hit.
  await page.goto('/404.html', { waitUntil: 'networkidle' });

  const resolved = await page.evaluate(() => ({
    base: document.querySelector('base')?.getAttribute('href'),
    // .href (not getAttribute) gives the browser's fully-resolved URL.
    firstHubLink: document.querySelector('main a.btn-sys').href,
    logo: document.querySelector('.sidebar-site-logo').src,
  }));

  expect(resolved.base).toBe('/');
  expect(new URL(resolved.firstHubLink).pathname).toBe('/index.html');
  expect(new URL(resolved.logo).pathname).toBe('/medias/images/DogslamloopIcon.webp');
});

test('404.html gets the sitewide footer like any other content page', async ({ page }) => {
  await page.goto('/404.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#site-footer')).toBeAttached();
});
