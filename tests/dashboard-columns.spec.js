// The two Main Dashboard columns: "Others" under Guides & Such, "Tools" under
// Recent Changes, which pushes Game Info to the right of that row.
//
// Both fill from navigation.json by category, so nothing here needs a new data
// source - a page created in owner tools with category "Others" lands in this
// column after the next regeneration run.
const { test, expect } = require('@playwright/test');

// "Others" is the column, not a category. A page belongs to one of the
// sub-groups (Gamemodes, Servers, Misc) directly, which is why these fixtures
// file pages under Gamemodes rather than Others. tests/others-column.spec.js
// owns the sub-grouping behaviour itself.

test('the dashboard has an Others and a Tools column, in the right places', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });

  const layout = await page.evaluate(() => {
    const grid = document.querySelector('.grid-layout-3col');
    const ids = Array.from(grid.children).map(el => el.id);
    return {
      ids,
      othersHeading: document.querySelector('#others-section h2')?.textContent.trim(),
      toolsHeading: document.querySelector('#tools-section h2')?.textContent.trim(),
    };
  });

  expect(layout.othersHeading).toBe('Others');
  expect(layout.toolsHeading).toBe('Tools');

  // Structural, not pixel geometry: in a 3-column grid, DOM order is the
  // layout. Others must be the 4th cell (under Guides & Such) and Tools the
  // 5th (under Recent Changes), which leaves Game Info 6th - to their right.
  expect(layout.ids).toEqual([
    'navigation-section', 'updates-section', 'blog-section',
    'others-section', 'tools-section', 'gameinfo-section',
  ]);
});

test('a column lists the pages in its category, as working links', async ({ page }) => {
  await page.route('**/data/navigation.json*', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      Characters: [],
      Gamemodes: [
        { id: 'Emotes', name: 'Emotes', url: 'others/emotes/index.html', cms_config: { pageId: 'emotes', pageType: 'gallery' } },
        { id: 'Duels', name: 'Duels', url: 'others/duels/index.html', isWip: true, cms_config: { pageId: 'duels', pageType: 'system' } },
      ],
      Tools: [
        { id: 'ID-Reader', name: 'Skill Builder ID Reader', url: 'tools/id-reader/index.html', cms_config: { pageId: 'id_reader', pageType: 'tool' } },
      ],
    }),
  }));

  await page.goto('/', { waitUntil: 'networkidle' });

  const others = await page.locator('#others-grid .system-directory-btn').allTextContents();
  const tools = await page.locator('#tools-grid .system-directory-btn').allTextContents();

  // Whitespace-normalised: the WIP badge is a separate span, so its text
  // arrives with the space that separates it visually.
  expect(others.map(t => t.replace(/\s+/g, ' ').trim())).toEqual(['Emotes', 'Duels WIP']);
  expect(tools.map(t => t.trim())).toEqual(['Skill Builder ID Reader']);

  // The link has to actually go somewhere - a column of dead buttons is worse
  // than no column.
  const href = await page.locator('#others-grid .system-directory-btn').first().getAttribute('data-href');
  expect(href).toBe('./others/emotes/index.html');
});

test('column categories are not listed twice, in their column and in Guides & Such', async ({ page }) => {
  await page.route('**/data/navigation.json*', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      Characters: [],
      Guides: [{ id: 'HUD', name: 'HUD', url: 'systems/hud/index.html', cms_config: { pageId: 'hud', pageType: 'system' } }],
      Gamemodes: [{ id: 'Emotes', name: 'Emotes', url: 'others/emotes/index.html', cms_config: { pageId: 'emotes', pageType: 'gallery' } }],
      Tools: [{ id: 'ID-Reader', name: 'ID Reader', url: 'tools/id-reader/index.html', cms_config: { pageId: 'id_reader', pageType: 'tool' } }],
    }),
  }));

  await page.goto('/', { waitUntil: 'networkidle' });

  // buildSystemsDirectory renders every non-Character category, so without an
  // exclusion these would appear in both places on the same screen.
  const systemsBoxHeadings = await page.locator('#systems-grid .system-category-block h3').allTextContents();
  expect(systemsBoxHeadings).toEqual(['Guides']);
  // The sub-group name is the category, so that is what must not reappear.
  expect(systemsBoxHeadings).not.toContain('Gamemodes');
  expect(systemsBoxHeadings).not.toContain('Tools');
});

test('an empty column says so rather than rendering a blank box', async ({ page }) => {
  await page.route('**/data/navigation.json*', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ Characters: [], Guides: [] }),
  }));

  await page.goto('/', { waitUntil: 'networkidle' });

  // A column that exists but is not filled yet should read as deliberate.
  await expect(page.locator('#others-grid')).toContainText('Nothing here yet');
  await expect(page.locator('#tools-grid')).toContainText('Nothing here yet');
});

test('page names in a column are escaped', async ({ page }) => {
  await page.route('**/data/navigation.json*', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      Characters: [],
      Gamemodes: [{ id: 'x', name: '<img src=x onerror="window.__colXss=1">Sneaky', url: 'others/x/index.html', cms_config: { pageId: 'x', pageType: 'system' } }],
    }),
  }));

  await page.goto('/', { waitUntil: 'networkidle' });

  // Names come from site_pages, which an admin edits through owner.html.
  const result = await page.evaluate(() => ({
    injected: !!document.querySelector('#others-grid img'),
    xss: !!window.__colXss,
  }));

  expect(result.injected).toBe(false);
  expect(result.xss).toBe(false);
});
