// Coverage for scripts/generate-pages.js, the v0.9 page-stub generator.
//
// Unlike the rest of this suite these are pure Node tests - no browser. The
// generator is a build-time script, and its safety rules are the kind of
// thing that is invisible until the day one of them is missing and the script
// eats a hand-authored page or wipes the site from an empty query result.
//
// buildPages() is deliberately pure (builds everything in memory, touches no
// disk) so it can be tested without a filesystem fixture.
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const { buildPages, MARKER, NEVER_TOUCH } = require('../scripts/generate-pages.js');
const nav = require('../data/navigation.json');

test('generates a stub for every routable character and system page', () => {
  const { pages, problems } = buildPages(nav);

  expect(problems).toEqual([]);

  // Every stub traces back to a navigation entry - the generator must not
  // invent pages. Template and the bespoke system pages are excluded by
  // NEVER_TOUCH; the hubs are not two-level page paths.
  const navUrls = Object.values(nav).flat().map(entry => String(entry.url || '').replace(/\\/g, '/'));
  for (const page of pages) {
    expect(navUrls, `${page.relPath} was generated but no navigation entry asks for it`)
      .toContain(page.relPath);
  }

  // Floors, not equalities. This used to pin exact totals (30 / 22 / 8), so
  // the day the owner created the first others/ page the suite went red -
  // and because the regeneration job runs the suite before committing, that
  // failure silently stopped every regeneration for three days. A count that
  // tracks content the owner controls does not belong in a test.
  expect(pages.length).toBeGreaterThanOrEqual(30);
  expect(pages.filter(p => p.pageType === 'character').length).toBeGreaterThanOrEqual(22);
  expect(pages.filter(p => p.pageType === 'system').length).toBeGreaterThanOrEqual(8);
});

test('a newly registered page gets a stub without anyone editing the tests', () => {
  // The actual regression being locked down: creating a page is something
  // the owner does from the owner tools, and it must not need a developer.
  const before = buildPages(nav).pages.length;

  const extended = JSON.parse(JSON.stringify(nav));
  const firstCategory = Object.keys(extended)[0];
  extended[firstCategory] = [...extended[firstCategory], {
    id: 'BrandNew',
    name: 'Brand New',
    url: 'others/brand-new/index.html',
    cms_config: { pageType: 'system', pageId: 'brand-new' },
  }];

  const { pages, problems } = buildPages(extended);

  expect(problems).toEqual([]);
  expect(pages).toHaveLength(before + 1);
  expect(pages.map(p => p.relPath)).toContain('others/brand-new/index.html');
});

test('never generates a hand-authored page', () => {
  const { pages } = buildPages(nav);
  const generated = pages.map(p => p.relPath);

  for (const protectedPath of NEVER_TOUCH) {
    expect(generated, `${protectedPath} must never be generated`).not.toContain(protectedPath);
  }
  // Named explicitly as well as via the set, so that shrinking NEVER_TOUCH by
  // accident fails here rather than silently widening what gets overwritten.
  expect(generated).not.toContain('characters/Template/index.html');
  expect(generated).not.toContain('systems/tierlist/index.html');
  expect(generated).not.toContain('systems/collaborators/index.html');
});

test('every generated stub carries the marker that protects hand-authored files', () => {
  const { pages } = buildPages(nav);
  for (const page of pages) {
    expect(page.html, `${page.relPath} is missing the GENERATED marker`).toContain(MARKER);
  }
});

test('refuses to generate a page whose url is not a two-level page path', () => {
  // recent-changes.html was mislabelled pageType "system" until v0.9 despite
  // being a standalone root-level page. This is the guard that caught it.
  const { problems } = buildPages({
    'Site Info': [{
      id: 'stray', name: 'Stray', url: 'stray.html',
      cms_config: { pageType: 'system', pageId: 'stray', editRole: 'locked' },
    }],
  });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('stray.html');
});

test('stubs set PAGE_ROUTE with the pageId from navigation.json, not the folder name', () => {
  const { pages } = buildPages(nav);

  // The two cases where folder name and pageId genuinely diverge - the whole
  // reason the generator reads nav rather than inferring from the path.
  const starterGuide = pages.find(p => p.relPath === 'systems/starter-guide/index.html');
  expect(starterGuide.html).toContain('pageId: "starter_guide"');

  const headHei = pages.find(p => p.relPath === 'characters/Head_hei/index.html');
  expect(headHei.html).toContain('pageId: "head_hei"');
  expect(headHei.html).toContain('title: "Head of the Hei"');
});

test('character and system stubs load the script sets their page type needs', () => {
  const { pages } = buildPages(nav);
  const char = pages.find(p => p.pageType === 'character');
  const sys = pages.find(p => p.pageType === 'system');

  for (const html of [char.html, sys.html]) {
    expect(html).toContain('js/page_router.js');
    expect(html).toContain('js/page_boot.js');
    expect(html).toContain('js/description.js');
  }

  // framedata.js and the KaTeX bundle only matter to character pages; loading
  // them everywhere would be dead weight on every system page.
  expect(char.html).toContain('js/framedata.js');
  expect(char.html).toContain('katex');
  expect(sys.html).not.toContain('js/framedata.js');
  expect(sys.html).not.toContain('katex');
});

test('the committed stubs on disk match what the generator produces', () => {
  // The same check `npm run validate` runs in CI. Duplicated here so a stale
  // stub fails the local suite too, not only on push.
  // Must pass previews: the generator reads them for og:image, so omitting
  // them here compares portrait-less output against portrait-bearing stubs.
  const previews = require('../data/page-previews.json');
  const { pages } = buildPages(nav, previews);
  const stale = pages.filter(page => {
    const abs = path.join(__dirname, '..', page.relPath);
    return !fs.existsSync(abs) || fs.readFileSync(abs, 'utf8') !== page.html;
  });
  expect(stale.map(p => p.relPath)).toEqual([]);
});
