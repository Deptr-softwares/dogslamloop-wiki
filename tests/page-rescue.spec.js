// A page that exists in the registry but has no generated file yet.
//
// Creating a page writes a site_pages row immediately, but GitHub Pages serves
// a URL only if a real file sits at that path - and those files come from a
// workflow, not from the save. So the page 404s until the next regeneration
// run, which is exactly the gap the owner hit within minutes of creating their
// first Others page: "I have no idea why there is this regeneration thing here
// that is blocking my feedback loop."
//
// 404.html is served for any unmatched path, so it asks the registry what
// belongs at the requested URL and renders it if the answer is a live page.
//
// What it must NOT do is pretend the page is published: the response is still
// HTTP 404, nothing will index or unfurl it, and the banner says so.
const { test, expect } = require('@playwright/test');

// .from('site_pages').select(...).in('url', [...])
function mockRegistry(page, rows, { pageData = {} } = {}) {
  return page.addInitScript(({ rows, pageData }) => {
    window.__registryQueries = [];

    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          const orig = lib.createClient.bind(lib);
          lib.createClient = (...args) => {
            const client = orig(...args);
            const origFrom = client.from.bind(client);

            client.from = (table) => {
              if (table === 'site_pages') {
                const chain = {
                  select() { return chain; },
                  in(_col, values) {
                    window.__registryQueries.push(values);
                    return Promise.resolve({
                      data: rows.filter(r => values.includes(r.url)),
                      error: null,
                    });
                  },
                };
                return chain;
              }
              if (table === 'page_data') {
                const chain = {
                  select() { return chain; }, eq() { return chain; },
                  single: async () => ({ data: pageData, error: null }),
                  maybeSingle: async () => ({ data: pageData, error: null }),
                };
                return chain;
              }
              return origFrom(table);
            };

            client.auth.getSession = async () => ({ data: { session: null } });
            return client;
          };
          lib.__patched = true;
        }
      },
    });
  }, { rows, pageData });
}

// GitHub Pages serves 404.html for any unmatched path; the local test server
// serves its own error page instead, so a spec cannot reach the rescue by
// navigating to a missing URL. It loads 404.html and hands it the path Pages
// would have been asked for - which is the only part of the chain the local
// server cannot reproduce. Everything after that is the real code.
//
// history.replaceState first, so anything reading location.pathname (and the
// asset paths that fall out of it) sees the deep URL rather than /404.html.
//
// networkidle, not domcontentloaded: 404.html boots its own sidebar from
// navigation.json, and starting the rescue while that is still in flight
// makes the result depend on which finishes first. It held locally and lost
// under load - 3 failures in 32 runs at 8 workers - and the tests it lost
// were the ones asserting the plain 404 survives, including one that reads
// the sidebar the boot had not built yet.
async function rescueAt(page, pathname) {
  await page.goto('/404.html', { waitUntil: 'networkidle' });
  await page.evaluate(async (p) => {
    history.replaceState({}, '', p);
    await window.initPageRescue(p);
  }, pathname);
}

const LIVE_SYSTEM_PAGE = {
  page_id: 'gamemodes',
  name: 'Gamemodes',
  url: 'others/gamemodes/index.html',
  page_type: 'system',
  status: 'live',
};

test('every URL form of the same page is looked up', async ({ page }) => {
  // People paste all three, and GitHub Pages resolves a directory to its
  // index.html - so a lookup that only understood one form would rescue the
  // page for some visitors and not others.
  await page.goto('/404.html', { waitUntil: 'networkidle' });

  const forms = await page.evaluate(() => ({
    withIndex: window.rescueCandidatePaths('/others/gamemodes/index.html'),
    trailing: window.rescueCandidatePaths('/others/gamemodes/'),
    bare: window.rescueCandidatePaths('/others/gamemodes'),
    root: window.rescueCandidatePaths('/'),
  }));

  for (const key of ['withIndex', 'trailing', 'bare']) {
    expect(forms[key], key).toContain('others/gamemodes/index.html');
    expect(forms[key], key).toContain('others/gamemodes');
  }
  expect(forms.root, 'the site root is not a missing page').toEqual([]);
});

test('a live page with no file yet renders instead of 404ing', async ({ page }) => {
  await mockRegistry(page, [LIVE_SYSTEM_PAGE], {
    pageData: {
      desc_data: {
        tabs: [{
          tabId: 'overview', tabLabel: 'Overview',
          sections: [{ sectionTitle: 'What this is', blocks: [{ type: 'paragraph', content: 'Every gamemode, explained.' }] }],
        }],
      },
    },
  });

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await rescueAt(page, '/others/gamemodes/index.html');

  await expect(page.locator('.home-main-title')).toHaveText('Gamemodes');
  await expect(page.locator('.main-content-area')).toContainText('Every gamemode, explained.');

  // The 404's own copy is gone rather than sitting underneath the real page.
  await expect(page.locator('text=404 — Page Not Found')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the rescued page says it is not published yet', async ({ page }) => {
  // It still returns HTTP 404, so nothing will index or unfurl it. Letting it
  // pass for published is how someone ends up wondering why their Discord
  // link shows nothing.
  await mockRegistry(page, [LIVE_SYSTEM_PAGE], { pageData: { desc_data: { tabs: [] } } });
  await rescueAt(page, '/others/gamemodes/');

  const banner = page.locator('#rescue-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Not published yet');
  await expect(banner).toContainText('regeneration');
});

test('a genuinely wrong URL still gets the ordinary 404', async ({ page }) => {
  await mockRegistry(page, [LIVE_SYSTEM_PAGE]);
  await rescueAt(page, '/characters/Not_A_Real_Character/');

  await expect(page.locator('.home-main-title')).toHaveText('404 — Page Not Found');
  await expect(page.locator('#rescue-banner')).toHaveCount(0);
  // And the 404's own navigation still boots.
  await expect(page.locator('#global-sidebar-nav .sidebar-group-header').first()).toBeVisible();
});

test('an archived page keeps its tombstone rather than being resurrected', async ({ page }) => {
  // Archiving is an explicit decision; rescuing it would quietly undo one.
  await mockRegistry(page, [{ ...LIVE_SYSTEM_PAGE, status: 'archived' }]);
  await rescueAt(page, '/others/gamemodes/');

  await expect(page.locator('.home-main-title')).toHaveText('404 — Page Not Found');
});

test('a registry that cannot be reached falls back to the plain 404', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          const orig = lib.createClient.bind(lib);
          lib.createClient = (...args) => {
            const client = orig(...args);
            client.from = (table) => {
              if (table === 'site_pages') throw new Error('registry unreachable');
              return { select() { return this; }, eq() { return this; }, single: async () => ({ data: null, error: null }) };
            };
            client.auth.getSession = async () => ({ data: { session: null } });
            return client;
          };
          lib.__patched = true;
        }
      },
    });
  });

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await rescueAt(page, '/others/gamemodes/');

  await expect(page.locator('.home-main-title')).toHaveText('404 — Page Not Found');
  expect(errors, 'a failed lookup must not throw out of the handler').toEqual([]);
});

test('a rescued character page gets the full character skeleton', async ({ page }) => {
  // The rescue reuses the real router, so a character page has to arrive with
  // its tab strip rather than a system page's single column.
  await mockRegistry(page, [{
    page_id: 'newcomer', name: 'Newcomer',
    url: 'characters/Newcomer/index.html', page_type: 'character', status: 'live',
  }], {
    pageData: {
      desc_data: { overview: [{ type: 'paragraph', content: 'Brand new.' }], matchups: [], counterplay: [] },
      frame_data: { m1s: [], skills: [], specials: [] },
    },
  });

  await rescueAt(page, '/characters/Newcomer/index.html');

  // Longer than the 5s default on purpose. A character page boots its
  // fetches concurrently with a deliberate 500ms TOC delay (js/page_boot.js),
  // so this content arrives well after initPageRescue resolves - and on a
  // loaded runner the default was the binding constraint rather than
  // anything being wrong. This was the last failure left in this file at
  // 8 workers, and the one CI failed on.
  const booted = { timeout: 15000 };
  await expect(page.locator('.character-title')).toHaveText('Newcomer', booted);
  // Count read from the page's own vocabulary (js/character_tabs.js), not
  // pinned: the claim is that the rescue builds a character strip at all, and
  // a literal would fail every time a tab is added for reasons unrelated to
  // the rescue path.
  const expectedTabs = await page.evaluate(() => window.getCharacterTabIds().length);
  await expect(page.locator('.character-nav .btn-manga')).toHaveCount(expectedTabs, booted);
  await expect(page.locator('#tab-overview')).toContainText('Brand new.', booted);
});

test('the rescued page resolves its assets from the site root', async ({ page }) => {
  // 404.html is served for a URL at any depth and carries <base href="/">, so
  // the router's usual "two levels up" is the wrong root here. Getting this
  // wrong is a page with no sidebar and no data.
  const notFound = [];
  page.on('response', r => { if (r.status() === 404 && !r.url().includes('/others/')) notFound.push(r.url()); });

  await mockRegistry(page, [LIVE_SYSTEM_PAGE], { pageData: { desc_data: { tabs: [] } } });
  await rescueAt(page, '/others/gamemodes/index.html');

  await expect(page.locator('#global-sidebar-nav .sidebar-group-header').first()).toBeVisible();
  expect(notFound, 'every asset resolved').toEqual([]);
});
