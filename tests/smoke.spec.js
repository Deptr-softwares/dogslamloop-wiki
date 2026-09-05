// General page-load smoke coverage across every page family, logged out.
// Catches the class of regression this project has repeatedly hit: a
// script error or broken fetch that silently degrades a page.
const { test, expect } = require('@playwright/test');

const PAGES = [
  { path: '/index.html', label: 'homepage' },
  { path: '/characters/index.html', label: 'character hub' },
  { path: '/systems/index.html', label: 'systems hub' },
  { path: '/characters/Boomcat/index.html', label: 'character page (finished, open)' },
  { path: '/characters/Template/index.html', label: 'character page (elevated)' },
  { path: '/systems/framedata/index.html', label: 'system page (open)' },
  { path: '/systems/tierlist/index.html', label: 'tierlist page (elevated)' },
  { path: '/systems/collaborators/index.html', label: 'locked page, not CMS-wired' },
  { path: '/systems/color-codes/index.html', label: 'locked page, no edit button in markup' },
  { path: '/privacy-policy.html', label: 'privacy policy' },
  { path: '/blog.html', label: 'blog' },
  { path: '/404.html', label: 'custom 404 page' },
];

for (const { path, label } of PAGES) {
  test(`${label} loads with no console errors`, async ({ page }) => {
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

    const response = await page.goto(path, { waitUntil: 'networkidle' });
    expect(response.ok()).toBeTruthy();
    await page.waitForTimeout(500);

    // A page with no page_data row yet gets a 406 from PostgREST, which is the
    // correct answer rather than a fault. The browser reports it as a generic
    // "Failed to load resource" console line carrying no URL, so this filter
    // cannot be narrower than the status code. That limitation belongs to
    // reading the console: page-sweep.spec.js reads the response event instead
    // and needs no allow-list at all.
    //
    // The 404 half of this used to cover the pre-Supabase
    // *_descriptions.json/*_framedata.json fallback, and the site_utils warning
    // came from the same place. Both are deleted, so both are gone from here -
    // a 404 on these pages is now a real broken asset and should fail.
    const KNOWN_NOISE = [/Failed to load resource:.*406/];
    const unexpected = errors.filter(e => !KNOWN_NOISE.some(pattern => pattern.test(e)));

    expect(unexpected, `Unexpected console errors on ${path}`).toEqual([]);
  });
}
