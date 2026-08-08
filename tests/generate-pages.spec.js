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
  // 22 character pages + 8 system pages. Template and the four bespoke system
  // pages are excluded by NEVER_TOUCH; the hubs are not two-level page paths.
  expect(pages).toHaveLength(30);
  expect(pages.filter(p => p.pageType === 'character')).toHaveLength(22);
  expect(pages.filter(p => p.pageType === 'system')).toHaveLength(8);
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
  const { pages } = buildPages(nav);
  const stale = pages.filter(page => {
    const abs = path.join(__dirname, '..', page.relPath);
    return !fs.existsSync(abs) || fs.readFileSync(abs, 'utf8') !== page.html;
  });
  expect(stale.map(p => p.relPath)).toEqual([]);
});
