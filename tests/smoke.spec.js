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

    // Known pre-existing conditions, unrelated to any single change here:
    // pages with no live Supabase row yet fall back to fetching a local
    // *_descriptions.json/*_framedata.json that hasn't existed since content
    // moved fully to Supabase (confirmed dead fallback paths, not something
    // this test suite fixes). Browsers report these as a generic "Failed to
    // load resource: 404/406" console message with no URL in the text, so
    // the filter can't be more specific than the status codes themselves.
    const KNOWN_NOISE = [/Failed to load resource:.*40[46]/, /Could not load .* through site_utils/];
    const unexpected = errors.filter(e => !KNOWN_NOISE.some(pattern => pattern.test(e)));

    expect(unexpected, `Unexpected console errors on ${path}`).toEqual([]);
  });
}
