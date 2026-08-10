// page_type 'gallery' and 'tool', added in v0.12.
//
// A gallery is a *simplified* system page - one flat searchable list of media
// rather than tabs of authored blocks - built for the Emotes page, where the
// content is ~100 short clips and the only navigation anyone wants is typing
// a name. A tool page hosts one of the owner's own tools rather than linking
// out to someone else's.
//
// Both are generated rather than hand-authored like the tierlist, which does
// not scale to a gallery per gamemode or a page per tool.
const { test, expect } = require('@playwright/test');
const { buildPages, PAGE_DIRECTORIES } = require('../scripts/generate-pages.js');

const NAV = {
  Others: [{
    name: 'Emotes',
    url: 'others/emotes/index.html',
    cms_config: { pageId: 'emotes', pageType: 'gallery' },
  }],
  Tools: [{
    name: 'Skill Builder ID Reader',
    url: 'tools/id-reader/index.html',
    cms_config: { pageId: 'id_reader', pageType: 'tool' },
  }],
};

test('the generator produces stubs for gallery and tool pages', () => {
  const { pages, problems } = buildPages(NAV, {}, {});

  expect(problems).toEqual([]);
  expect(pages.map(p => p.relPath).sort()).toEqual([
    'others/emotes/index.html',
    'tools/id-reader/index.html',
  ]);

  const gallery = pages.find(p => p.relPath === 'others/emotes/index.html');
  const tool = pages.find(p => p.relPath === 'tools/id-reader/index.html');

  // Each loads its own renderer, and neither drags in the character stack.
  expect(gallery.html).toContain('pageType: "gallery"');
  expect(gallery.html).toContain('js/gallery.js');
  expect(gallery.html).not.toContain('js/framedata.js');

  expect(tool.html).toContain('pageType: "tool"');
  expect(tool.html).toContain('js/tool_page.js');

  // The description is what a search result and a Discord unfurl say, so
  // "a guide to Emotes" would be wrong for both of these.
  expect(gallery.html).toContain('searchable');
  expect(tool.html).toContain('a Jujutsu Shenanigans tool');
});

test('a page type with no renderer is still skipped, not generated blindly', () => {
  const { pages } = buildPages({
    Misc: [
      { name: 'Tier List', url: 'systems/tierlist/index.html', cms_config: { pageId: 'tierlist', pageType: 'tierlist' } },
      { name: 'Discord', url: 'https://discord.gg/x', cms_config: { pageId: 'discord', pageType: 'external' } },
    ],
  }, {}, {});

  // tierlist is hand-authored and in NEVER_TOUCH; external has no page at all.
  expect(pages).toEqual([]);
});

test('the directory list still covers every folder a page can be created in', () => {
  expect(PAGE_DIRECTORIES).toContain('others');
  expect(PAGE_DIRECTORIES).toContain('tools');
});

// --- the gallery renderer ------------------------------------------------

async function mountGallery(page, items, intro = []) {
  // A system page for the shared stack (site_utils, description.js), then the
  // real gallery renderer injected - no generated gallery page exists yet, and
  // hand-editing navigation.json to make one would be editing a generated file.
  await page.goto('/systems/hud/', { waitUntil: 'networkidle' });
  await page.addScriptTag({ path: 'js/gallery.js' });
  return page.evaluate(async ({ items: rows, intro: introBlocks }) => {
    document.body.innerHTML = '<main class="main-content-area"></main>';
    window.supabaseClient = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle: async () => ({ data: { desc_data: { intro: introBlocks, items: rows } }, error: null }),
        };
      },
    };
    await window.renderGalleryPage('emotes');
  }, { items, intro });
}

const ITEMS = [
  { name: 'Wave', src: '/medias/videos/wave.mp4', tags: ['greeting'] },
  { name: 'Salute', src: '/medias/videos/salute.webm' },
  { name: 'Sit', src: '/medias/images/sit.gif', note: 'Loops forever' },
  { name: 'Point', src: '/medias/images/point.png' },
];

test('a gallery renders every item, video and image alike', async ({ page }) => {
  await mountGallery(page, ITEMS);

  const result = await page.evaluate(() => ({
    cards: document.querySelectorAll('.gallery-card').length,
    videos: document.querySelectorAll('.gallery-card video').length,
    images: document.querySelectorAll('.gallery-card img').length,
    // Videos are built lazy - a gallery is the one page where loading
    // everything at once genuinely matters. Checked on a freshly built card
    // rather than on the grid: initLazyMedia promotes data-lazy-src to src as
    // soon as an element is on screen, and in a test viewport they all are, so
    // asserting the attribute on the rendered grid would be asserting that
    // lazy loading had *failed*.
    builtLazy: window.galleryInternals
      .buildGalleryCard({ name: 'X', src: '/a.mp4' })
      .querySelector('video')
      .hasAttribute('data-lazy-src'),
    // <video> has no alt attribute; the label has to go somewhere real.
    ariaLabels: Array.from(document.querySelectorAll('.gallery-card video')).map(v => v.getAttribute('aria-label')),
    count: document.getElementById('gallery-count').textContent,
  }));

  expect(result.cards).toBe(4);
  expect(result.videos, '.mp4 and .webm').toBe(2);
  expect(result.images, '.gif stays an image, and .png').toBe(2);
  expect(result.builtLazy, 'a card is built armed for the lazy observer').toBe(true);

  // Retrying assertions, not a one-shot read: initLazyMedia promotes
  // data-lazy-src via an IntersectionObserver callback, which fires
  // asynchronously after layout. Reading src straight after render passed
  // locally and failed on the slower CI runner, where the observer had not
  // run yet - the same race as the v0.11 skip-link geometry read.
  await expect(page.locator('.gallery-card video').first())
    .toHaveAttribute('src', '/medias/videos/wave.mp4');
  await expect(page.locator('.gallery-card video').nth(1))
    .toHaveAttribute('src', '/medias/videos/salute.webm');
  expect(result.ariaLabels).toEqual(['Wave', 'Salute']);
  expect(result.count).toBe('4 total');
});

test('the search box filters the grid as you type', async ({ page }) => {
  await mountGallery(page, ITEMS);

  // The reason a gallery exists rather than a system page: finding one clip
  // among a hundred by typing, not by scrolling tabs.
  await page.fill('#gallery-search', 'sal');

  let visible = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.gallery-card-name')).map(n => n.textContent));
  expect(visible).toEqual(['Salute']);
  await expect(page.locator('#gallery-count')).toHaveText('1 of 4');

  // Tags and notes are searchable too, not just names.
  await page.fill('#gallery-search', 'greeting');
  visible = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.gallery-card-name')).map(n => n.textContent));
  expect(visible, 'matched on a tag').toEqual(['Wave']);

  await page.fill('#gallery-search', 'loops');
  visible = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.gallery-card-name')).map(n => n.textContent));
  expect(visible, 'matched on a note').toEqual(['Sit']);

  // Escape clears, which is what a live filter should do.
  await page.locator('#gallery-search').press('Escape');
  visible = await page.evaluate(() => document.querySelectorAll('.gallery-card').length);
  expect(visible).toBe(4);
});

test('a search matching nothing says so instead of rendering an empty grid', async ({ page }) => {
  await mountGallery(page, ITEMS);
  await page.fill('#gallery-search', 'zzzzz');

  await expect(page.locator('#gallery-grid')).toContainText('Nothing matches');
  expect(await page.locator('.gallery-card').count()).toBe(0);
});

test('gallery item names are contributor-submitted and never parsed as markup', async ({ page }) => {
  await mountGallery(page, [
    { name: '<img src=x onerror="window.__galleryXss=1">Sneaky', src: '/medias/images/a.png', note: '<b>bold</b>' },
  ]);

  const result = await page.evaluate(() => ({
    name: document.querySelector('.gallery-card-name').textContent,
    note: document.querySelector('.gallery-card-note').textContent,
    injected: document.querySelectorAll('.gallery-card-caption img, .gallery-card-caption b').length,
    xss: !!window.__galleryXss,
  }));

  expect(result.name).toContain('Sneaky');
  expect(result.name).toContain('<img');
  expect(result.note).toBe('<b>bold</b>');
  expect(result.injected).toBe(0);
  expect(result.xss).toBe(false);
});

test('an empty gallery invites the first entry rather than rendering nothing', async ({ page }) => {
  await mountGallery(page, []);
  await expect(page.locator('#gallery-grid')).toContainText('Nothing here yet');
});

// --- the tool renderer ---------------------------------------------------

async function mountTool(page, descData) {
  await page.goto('/systems/hud/', { waitUntil: 'networkidle' });
  await page.addScriptTag({ path: 'js/tool_page.js' });
  return page.evaluate(async (data) => {
    document.body.innerHTML = '<main class="main-content-area"></main>';
    window.PAGE_ROUTE = { pageId: 'id_reader', pageType: 'tool', title: 'ID Reader' };
    window.supabaseClient = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle: async () => ({ data: { desc_data: data }, error: null }),
        };
      },
    };
    await window.renderToolPage('id_reader');
  }, descData);
}

test('a tool with its own script takes over the page', async ({ page }) => {
  // The reason tool pages are a host rather than a renderer: a tool is an
  // application, not a document. The Certified Tier List has its own data
  // model and submission flow; only the ID Reader is genuinely just a link.
  await page.goto('/systems/hud/', { waitUntil: 'networkidle' });
  await page.addScriptTag({ path: 'js/tool_page.js' });

  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<main class="main-content-area"></main>';
    window.PAGE_ROUTE = { pageId: 'certified_tierlist', pageType: 'tool', title: 'Certified Tier List' };
    window.supabaseClient = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle: async () => ({ data: { desc_data: { tool: { url: 'https://example.test' } } }, error: null }),
        };
      },
    };

    let receivedCtx = null;
    window.registerWikiTool('certified_tierlist', async (mount, ctx) => {
      receivedCtx = ctx;
      mount.innerHTML = '<div id="my-tool">the real tool</div>';
    });

    await window.renderToolPage('certified_tierlist');
    return {
      rendered: !!document.getElementById('my-tool'),
      // The fallback must not also render - the tool owns the mount.
      fallbackLink: !!document.querySelector('.tool-launch-btn'),
      ctxPageId: receivedCtx && receivedCtx.pageId,
      // Config reaches the tool, so it is configurable from owner tools
      // without a code change.
      ctxUrl: receivedCtx && receivedCtx.config.url,
    };
  });

  expect(result.rendered).toBe(true);
  expect(result.fallbackLink, 'a registered tool owns its mount').toBe(false);
  expect(result.ctxPageId).toBe('certified_tierlist');
  expect(result.ctxUrl).toBe('https://example.test');
});

test('a tool that throws does not take the page prose down with it', async ({ page }) => {
  await page.goto('/systems/hud/', { waitUntil: 'networkidle' });
  await page.addScriptTag({ path: 'js/tool_page.js' });

  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<main class="main-content-area"></main>';
    window.PAGE_ROUTE = { pageId: 'broken_tool', pageType: 'tool', title: 'Broken' };
    window.supabaseClient = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle: async () => ({ data: { desc_data: { tool: { url: 'https://example.test' } } }, error: null }),
        };
      },
    };
    window.registerWikiTool('broken_tool', async () => { throw new Error('boom'); });
    await window.renderToolPage('broken_tool');
    return {
      saidSo: document.getElementById('tool-mount').textContent.includes('failed to load'),
      // The link still renders, so the page is not a dead end.
      fallbackLink: !!document.querySelector('.tool-launch-btn'),
    };
  });

  expect(result.saidSo).toBe(true);
  expect(result.fallbackLink).toBe(true);
});

test('a tool page links out by default and does not embed', async ({ page }) => {
  await mountTool(page, { tool: { url: 'https://tools.example.test/id-reader' } });

  const result = await page.evaluate(() => {
    const link = document.querySelector('.tool-launch-btn');
    return {
      embedded: !!document.querySelector('.tool-embed'),
      href: link ? link.getAttribute('href') : null,
      target: link ? link.getAttribute('target') : null,
      rel: link ? link.getAttribute('rel') : null,
      label: link ? link.textContent.trim() : null,
    };
  });

  // Embedding is opt-in: a tool served with X-Frame-Options renders as a
  // permanently blank box the page cannot detect, which is worse than a link.
  expect(result.embedded).toBe(false);
  expect(result.href).toBe('https://tools.example.test/id-reader');
  expect(result.target).toBe('_blank');
  expect(result.rel).toContain('noopener');
  expect(result.label).toBe('Open the tool');
});

test('an embedded tool is sandboxed, and still offers the link as an escape hatch', async ({ page }) => {
  await mountTool(page, {
    tool: { url: 'https://tools.example.test/id-reader', embed: true, height: 500, launchLabel: 'Open in a new tab' },
  });

  const result = await page.evaluate(() => {
    const frame = document.querySelector('.tool-embed');
    return {
      src: frame.getAttribute('src'),
      height: frame.getAttribute('height'),
      sandbox: frame.getAttribute('sandbox'),
      hasTitle: !!frame.getAttribute('title'),
      link: document.querySelector('.tool-launch-btn')?.textContent.trim(),
    };
  });

  expect(result.src).toBe('https://tools.example.test/id-reader');
  expect(result.height).toBe('500');
  expect(result.sandbox, 'a different origin even when it is the owner\'s').toContain('allow-scripts');
  expect(result.hasTitle, 'an iframe needs a title to be reachable').toBe(true);
  expect(result.link, 'the escape hatch survives the embed').toBe('Open in a new tab');
});

test('a tool page with no tool yet says what to do about it', async ({ page }) => {
  await mountTool(page, {});
  await expect(page.locator('#tool-mount')).toContainText('No tool linked yet');
});
