// getRootPath is the base for every data fetch and asset path on the site,
// so it has to be right for a directory that does not exist yet. It used to
// test for '/characters/' and '/systems/' by name and return './' for
// anything else - meaning a page under others/ or tools/ would resolve
// navigation.json, portraits and stylesheets against the wrong root.
//
// Asserted through real page loads where a real page exists, and through the
// function directly for the directories that are not built yet.
const { test, expect } = require('@playwright/test');

const CASES = [
  { path: '/', expected: './', why: 'the homepage' },
  { path: '/index.html', expected: './', why: 'the homepage by filename' },
  { path: '/characters/', expected: '../', why: 'a hub' },
  { path: '/characters/index.html', expected: '../', why: 'a hub by filename' },
  { path: '/characters/Template/', expected: '../../', why: 'a character page' },
  { path: '/characters/Template/index.html', expected: '../../', why: 'a character page by filename' },
  { path: '/systems/', expected: '../', why: 'the systems hub' },
  { path: '/systems/tierlist/index.html', expected: '../../', why: 'a system page' },
];

for (const c of CASES) {
  test(`getRootPath resolves ${c.why} (${c.path})`, async ({ page }) => {
    await page.goto(c.path, { waitUntil: 'domcontentloaded' });
    const root = await page.evaluate(() => window.getRootPath());
    expect(root).toBe(c.expected);
  });
}

test('directories that do not exist yet resolve correctly too', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // The whole reason for the change: others/ and tools/ are coming, and the
  // named-directory version returned './' for both, which would have sent
  // every fetch on those pages to the wrong place.
  const results = await page.evaluate(() => {
    const call = (pathname) => {
      const segments = pathname.split('/').filter(Boolean);
      if (segments.length && segments[segments.length - 1].includes('.')) segments.pop();
      return segments.length ? '../'.repeat(segments.length) : './';
    };
    // Mirror of the implementation is not the test - drive the real function
    // by faking the location it reads.
    const real = window.getRootPath;
    const out = {};
    for (const p of ['/others/emotes/index.html', '/others/emotes/', '/tools/id-reader/index.html', '/others/index.html']) {
      history.replaceState({}, '', p);
      out[p] = real();
    }
    history.replaceState({}, '', '/');
    return { out, sanity: call('/others/emotes/index.html') };
  });

  expect(results.out['/others/emotes/index.html']).toBe('../../');
  expect(results.out['/others/emotes/']).toBe('../../');
  expect(results.out['/tools/id-reader/index.html']).toBe('../../');
  expect(results.out['/others/index.html'], 'a hub one level down').toBe('../');
});

test('a real page under a nested directory loads its data through the resolved root', async ({ page }) => {
  // The consequence that matters: a wrong root is not a wrong string, it is a
  // 404 on navigation.json and an empty sidebar.
  const failed = [];
  page.on('response', r => { if (r.status() === 404) failed.push(r.url()); });

  await page.goto('/characters/Template/', { waitUntil: 'networkidle' });

  const navLoaded = await page.evaluate(async () => {
    const data = await window.fetchNavigationData();
    return data && Object.keys(data).length > 0;
  });

  expect(navLoaded, 'navigation.json resolved from a two-deep page').toBe(true);
  expect(failed.filter(u => u.includes('navigation.json'))).toEqual([]);
});
