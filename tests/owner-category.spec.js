// site_pages.category is free-form text with no CHECK constraint, so the
// database has always accepted a new category. owner.html's hardcoded
// four-option <select> was the only thing preventing one, which meant a new
// nav section could not be created from the UI at all.
//
// navigation.json is keyed by the category string and js/pagebuilder.js
// renders one sidebar group per key, verbatim - so "Guides" and "guides "
// would become two separate groups. That is what canonicaliseCategory guards.
const { test, expect } = require('@playwright/test');

async function setupPagesForm(page, pages) {
  await page.goto('/owner.html', { waitUntil: 'networkidle' });
  await page.evaluate((rows) => {
    document.body.innerHTML = `
      <input type="text" id="new-page-name">
      <select id="new-page-type"><option value="system">system</option></select>
      <input type="text" id="new-page-category" list="page-category-options">
      <datalist id="page-category-options"></datalist>
      <p id="new-page-category-note"></p>
      <select id="new-page-position"><option value="">At the end of the category</option></select>
      <div id="pages-results"></div>
      <div id="pages-list"></div>
    `;

    window.__inserted = null;
    window.supabaseClient = {
      from() {
        return {
          select() { return this; },
          order() { return this; },
          then: undefined,
          insert: async (rows2) => { window.__inserted = rows2[0]; return { error: null }; },
        };
      },
    };
    window.adminConfirm = async () => true;

    // loadSitePages does the fetch; the cache is what everything else reads,
    // so seed it directly and drive the same refresh path.
    window.__seed = rows;
  }, pages);

  // cachedSitePages is module-scoped, so reach it the way the page does.
  // wireCategoryField is called for the same reason the page calls it at
  // boot: the listener belongs to the element, and this form was just rebuilt.
  await page.evaluate(() => {
    // eslint-disable-next-line no-eval
    eval('cachedSitePages = window.__seed');
    populateCategoryOptions();
    populatePositionOptions();
    updateCategoryNote();
    wireCategoryField();
  });
}

const PAGES = [
  { page_id: 'sukuna', name: 'Sukuna', category: 'Characters', sort_order: 10 },
  { page_id: 'hud', name: 'HUD', category: 'Guides', sort_order: 10 },
  { page_id: 'faq', name: 'FAQ', category: 'Site Info', sort_order: 10 },
];

test('the category field offers what already exists instead of a fixed list', async ({ page }) => {
  await setupPagesForm(page, PAGES);

  const options = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#page-category-options option')).map(o => o.value));

  // Derived from the data, not hardcoded - so a category added last week is
  // offered today without a code change.
  expect(options).toEqual(['Characters', 'Guides', 'Site Info']);
});

test('a genuinely new category is allowed, and says so before it is created', async ({ page }) => {
  await setupPagesForm(page, PAGES);

  const input = page.locator('#new-page-category');
  await input.fill('Others');

  const note = await page.locator('#new-page-category-note').textContent();
  expect(note, 'the owner is told this creates a new sidebar section').toContain('New category');
  expect(note).toContain('Others');

  await page.fill('#new-page-name', 'Emotes');
  await page.evaluate(() => createSitePage());

  const inserted = await page.evaluate(() => window.__inserted);
  expect(inserted.category, 'the new category reaches the database').toBe('Others');
});

test('a category that differs only by case or spacing adopts the existing spelling', async ({ page }) => {
  await setupPagesForm(page, PAGES);

  // Two sidebar groups differing only by case is the failure this prevents.
  await page.fill('#new-page-category', '  guides  ');

  const note = await page.locator('#new-page-category-note').textContent();
  expect(note, 'recognised as the existing section, not a new one').toContain('existing "Guides"');

  await page.fill('#new-page-name', 'Movement');
  await page.evaluate(() => createSitePage());

  const inserted = await page.evaluate(() => window.__inserted);
  expect(inserted.category).toBe('Guides');
});

test('position options follow the typed category, matching it canonically', async ({ page }) => {
  await setupPagesForm(page, PAGES);

  await page.fill('#new-page-category', 'characters');
  const opts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#new-page-position option')).map(o => o.textContent));

  // Matched case-insensitively, so the siblings show up even though the typed
  // spelling differs from the stored one.
  expect(opts).toEqual(['At the end of the category', 'After: Sukuna']);
});

test('an empty category is refused rather than creating a nameless sidebar group', async ({ page }) => {
  await setupPagesForm(page, PAGES);

  // A <select> could never be empty; a text field can, and an empty string
  // would key navigation.json on "" and render a group with no heading.
  await page.fill('#new-page-name', 'Orphan');
  await page.fill('#new-page-category', '   ');
  await page.evaluate(() => createSitePage());

  const result = await page.evaluate(() => ({
    inserted: window.__inserted,
    message: document.getElementById('pages-results').textContent,
  }));

  expect(result.inserted, 'nothing was written').toBeNull();
  expect(result.message).toContain('Pick a category');
});

test('a contributor-visible category name cannot inject markup into the datalist', async ({ page }) => {
  await setupPagesForm(page, [
    { page_id: 'x', name: 'X', category: '"><img src=x onerror="window.__catXss=1">', sort_order: 10 },
  ]);

  const result = await page.evaluate(() => ({
    xss: !!window.__catXss,
    injected: !!document.querySelector('#page-category-options img'),
    optionCount: document.querySelectorAll('#page-category-options option').length,
  }));

  expect(result.xss).toBe(false);
  expect(result.injected).toBe(false);
  expect(result.optionCount).toBe(1);
});
