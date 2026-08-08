// Coverage for the OG/social metadata added in v0.9.
//
// Before this, the site had zero social or SEO tags, so a wiki link pasted in
// Discord unfurled as nothing at all.
//
// The critical detail these tests exist to protect: the tags must be in the
// SERVED HTML. Discord, Twitter and Facebook unfurlers do not execute
// JavaScript, so anything js/site_meta.js injected at runtime would be
// invisible to them - the preview would look fine when tested in a browser
// and still show nothing in Discord.
//
// So every assertion here reads the raw HTTP response body, never the
// rendered DOM. Using page.goto + a DOM query would happily pass for
// JS-injected tags and defeat the whole point.
const { test, expect } = require('@playwright/test');

const ORIGIN = 'https://dogslamloop.com';
const EXPECTED_IMAGE = `${ORIGIN}/medias/images/DogslamloopIconGay.webp`;

// A generated character page, a generated system page, and the three
// hand-authored pages people are most likely to actually share.
const PAGES = [
  { url: '/characters/Vessel/index.html', title: 'Vessel', type: 'article', generated: true },
  { url: '/systems/framedata/index.html', title: 'Frame data', type: 'article', generated: true },
  { url: '/index.html', title: 'Dogslamloop Wiki', type: 'website', generated: false },
  { url: '/characters/index.html', title: 'Character Dashboard', type: 'website', generated: false },
  { url: '/systems/index.html', title: 'Systems &amp; Guides Hub', type: 'website', generated: false },
];

function metaContent(html, attrName, attrValue) {
  // Tolerant of attribute order, which differs between the generator's output
  // and the hand-written tags.
  const re = new RegExp(
    `<meta[^>]*${attrName}=["']${attrValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`,
    'i'
  );
  const tag = html.match(re);
  if (!tag) return null;
  const content = tag[0].match(/content=["']([^"']*)["']/i);
  return content ? content[1] : null;
}

for (const page of PAGES) {
  test(`${page.url}: social tags are present in the served HTML`, async ({ request }) => {
    const response = await request.get(page.url);
    expect(response.ok()).toBeTruthy();
    const html = await response.text();

    expect(metaContent(html, 'property', 'og:title')).toBe(page.title);
    expect(metaContent(html, 'property', 'og:type')).toBe(page.type);
    expect(metaContent(html, 'property', 'og:site_name')).toBe('Dogslamloop Wiki');
    expect(metaContent(html, 'name', 'twitter:card')).toBe('summary');

    const description = metaContent(html, 'name', 'description');
    expect(description, 'description must not be empty').toBeTruthy();
    expect(metaContent(html, 'property', 'og:description')).toBe(description);
  });

  test(`${page.url}: og:image and og:url are absolute`, async ({ request }) => {
    const html = await (await request.get(page.url)).text();

    // Relative URLs are the classic mistake here: an unfurler has no page
    // context to resolve them against, so the image silently never loads.
    const image = metaContent(html, 'property', 'og:image');
    expect(image).toBe(EXPECTED_IMAGE);

    const ogUrl = metaContent(html, 'property', 'og:url');
    expect(ogUrl.startsWith(`${ORIGIN}/`), `og:url must be absolute, got "${ogUrl}"`).toBe(true);

    const canonical = html.match(/<link[^>]*rel=["']canonical["'][^>]*>/i);
    expect(canonical, 'missing canonical link').toBeTruthy();
    expect(canonical[0]).toContain(ORIGIN);
  });
}

test('every generated page gets social tags, not just the sampled ones', async ({ request }) => {
  const { buildPages } = require('../scripts/generate-pages.js');
  const nav = require('../data/navigation.json');
  const { pages } = buildPages(nav);

  const missing = pages.filter(p =>
    !p.html.includes('property="og:title"') ||
    !p.html.includes('property="og:image"') ||
    !p.html.includes('rel="canonical"')
  );
  expect(missing.map(p => p.relPath)).toEqual([]);
  expect(pages.length).toBe(30);
});

test('social tags are static, not injected by JavaScript', async ({ request }) => {
  // js/site_meta.js is a runtime string-injector. If OG tags ever migrate
  // into it, previews break everywhere while still looking correct in a
  // browser - the exact failure this whole approach exists to avoid.
  const siteMetaJs = await (await request.get('/js/site_meta.js')).text();
  expect(siteMetaJs).not.toContain('og:title');
  expect(siteMetaJs).not.toContain('og:image');
  expect(siteMetaJs).not.toContain('twitter:card');
});
