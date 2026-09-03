// The Others column is one column holding several sub-groups.
//
// The owner's model: a page belongs to Gamemodes, Servers or Misc directly.
// There is no "Others" category - "Others" is the column, and the sub-groups
// are the categories. That is why the first page created was already filed
// correctly under Gamemodes.
//
// The assertion that matters most is the last one: a category the column
// renders but OWN_COLUMN_CATEGORIES omits would appear twice on the same
// screen, once here and once in the Side Dashboard's directory.
const { test, expect } = require('@playwright/test');

// buildCategoryColumn reads data/navigation.json through fetchJson, which
// caches - so the route has to be in place before the page loads.
function mockNav(page, nav) {
  return page.route('**/data/navigation.json*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(nav) }));
}

const NAV = {
  Characters: [{ id: 'B', name: 'Boomcat', url: 'characters/Boomcat/index.html', cms_config: { pageType: 'character', pageId: 'boomcat' } }],
  Gamemodes: [
    { id: 'Roulette', name: 'Roulette', url: 'others/roulette/index.html', isWip: true, cms_config: { pageType: 'system', pageId: 'roulette' } },
    { id: 'Duels', name: 'Duels', url: 'others/duels/index.html', cms_config: { pageType: 'system', pageId: 'duels' } },
  ],
  Servers: [
    { id: 'Private', name: 'Private Servers', url: 'others/private-servers/index.html', cms_config: { pageType: 'system', pageId: 'private-servers' } },
  ],
  Misc: [],
  Tools: [
    { id: 'IDReader', name: 'ID Reader', url: 'tools/id-reader/index.html', cms_config: { pageType: 'tool', pageId: 'id-reader' } },
  ],
  Guides: [{ id: 'M1', name: 'M1 Trading', url: 'systems/m1-trading/index.html', cms_config: { pageType: 'system', pageId: 'm1-trading' } }],
};

test('the sub-groups are the categories, in the order declared', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const groups = await page.evaluate(() => ({
    others: window.OTHERS_SUBGROUPS,
    tools: window.TOOLS_SUBGROUPS,
  }));
  expect(groups.others).toEqual(['Gamemodes', 'Servers', 'Misc']);
  expect(groups.tools).toEqual(['Tools', 'Creators', 'Community']);
});

test('the Others column renders a heading per populated sub-group', async ({ page }) => {
  await mockNav(page, NAV);
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const column = page.locator('#others-grid');
  await expect(column.locator('.column-subgroup-title')).toHaveText(['Gamemodes', 'Servers']);

  // Misc is declared but empty, so it renders nothing at all - a bare heading
  // promises content that is not there.
  await expect(column.locator('.column-subgroup-title', { hasText: 'Misc' })).toHaveCount(0);
});

test('every page lands under its own sub-group', async ({ page }) => {
  await mockNav(page, NAV);
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const column = page.locator('#others-grid');
  await expect(column.locator('.system-directory-btn')).toHaveText([
    /Roulette/, /Duels/, /Private Servers/,
  ]);

  // NO WIP badge here any more (owner, 2026-09-03: "kinda off and not fitting.
  // The WIP tag being on the left sidebar navigation is good enough"). This
  // used to assert the opposite.
  //
  // Asserted against a page that IS work-in-progress, so it cannot pass by the
  // fixture simply having no WIP pages in it: NAV marks Roulette isWip.
  await expect(column.locator('.system-directory-btn').first()).toContainText('Roulette');
  await expect(column.locator('.update-badge')).toHaveCount(0);
});

test('the WIP badge is still in the left sidebar', async ({ page }) => {
  // The paired positive. Removing it from the column must not quietly remove
  // it from the one place the owner asked to keep it - the sidebar is where a
  // reader picks from the full list and needs the warning.
  await mockNav(page, NAV);
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const sidebar = page.locator('#global-sidebar-nav');
  // The groups render collapsed, so the badge is in the DOM but not on screen
  // until somebody opens the group. Open it, the way a reader would - a badge
  // that exists inside a container nobody can expand is not a warning.
  await sidebar.locator('.sidebar-group-header', { hasText: 'Gamemodes' }).click();
  await expect(sidebar.locator('.badge-wip').first()).toBeVisible();
});

test('a single-group column renders no heading', async ({ page }) => {
  // "Tools" inside a section already titled Tools is noise.
  await mockNav(page, NAV);
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const tools = page.locator('#tools-grid');
  await expect(tools.locator('.system-directory-btn')).toHaveText([/ID Reader/]);
  await expect(tools.locator('.column-subgroup-title')).toHaveCount(0);
});

test('a column with nothing in any group says so once', async ({ page }) => {
  await mockNav(page, { ...NAV, Gamemodes: [], Servers: [], Misc: [] });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('#others-grid')).toContainText('Nothing here yet');
  await expect(page.locator('#others-grid .column-subgroup-title')).toHaveCount(0);
});

test('the buttons navigate', async ({ page }) => {
  await mockNav(page, NAV);
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await page.locator('#others-grid .system-directory-btn', { hasText: 'Duels' }).click();
  await expect.poll(() => new URL(page.url()).pathname).toContain('others/duels');
});

test('a sub-group page is never listed twice on the same screen', async ({ page }) => {
  // The failure this guards: the Side Dashboard directory renders every
  // category except the ones the columns own. Add a sub-group to the column
  // and forget OWN_COLUMN_CATEGORIES, and the page appears in both.
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const owned = await page.evaluate(() => window.OWN_COLUMN_CATEGORIES);
  for (const group of ['Gamemodes', 'Servers', 'Misc', 'Tools']) {
    expect(owned, `${group} must be excluded from the systems directory`).toContain(group);
  }

  await mockNav(page, NAV);
  await page.goto('/systems/index.html', { waitUntil: 'domcontentloaded' });

  const directory = page.locator('#systems-grid');
  await expect(directory).toContainText('M1 Trading');
  for (const name of ['Roulette', 'Duels', 'Private Servers', 'ID Reader']) {
    await expect(directory, `${name} belongs to a column, not the directory`).not.toContainText(name);
  }
});

test('the Tools column is sub-grouped by audience, like the Others column', async ({ page }) => {
  // The first two tool pages were filed under Creators and Community. A
  // category the column does not list is not merely missing from it - it
  // falls through to the Side Dashboard's generic directory instead, which
  // is where both of them landed.
  await mockNav(page, {
    ...NAV,
    Creators: [{ id: 'IDReader', name: 'Skill Builder ID Reader', url: 'tools/skill-builder-id-reader/index.html', cms_config: { pageType: 'tool', pageId: 'skill_builder_id_reader' } }],
    Community: [{ id: 'FreeTier', name: 'Free Submit Tier List', url: 'tools/free-submit-tier-list/index.html', cms_config: { pageType: 'tool', pageId: 'free_submit_tier_list' } }],
    Tools: [],
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const tools = page.locator('#tools-grid');
  await expect(tools.locator('.column-subgroup-title')).toHaveText(['Creators', 'Community']);
  await expect(tools.locator('.system-directory-btn')).toHaveText([
    /Skill Builder ID Reader/, /Free Submit Tier List/,
  ]);

  // And the same "never listed twice" rule the Others column has.
  const owned = await page.evaluate(() => window.OWN_COLUMN_CATEGORIES);
  for (const group of ['Creators', 'Community']) {
    expect(owned, `${group} must be excluded from the systems directory`).toContain(group);
  }
});
