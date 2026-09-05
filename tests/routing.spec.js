// Coverage for the pageId/editRole routing unification (architecture pass
// A-1/A-3): navigation.json is the single source of truth for whether a
// page's Edit button renders, and loadPageAlerts must match pages by their
// canonical pageId, not the old display-name-ish id field.
const { test, expect } = require('@playwright/test');
const { VALID_PAGE_TYPES, VALID_EDIT_ROLES } = require('../scripts/page-types.js');

test('navigation.json validates cleanly', async ({ page }) => {
  const response = await page.goto('/data/navigation.json');
  const nav = await response.json();

  const seen = new Set();
  for (const entries of Object.values(nav)) {
    for (const entry of entries) {
      expect(entry.cms_config.pageId, `${entry.id} missing pageId`).toBeTruthy();
      expect(seen.has(entry.cms_config.pageId), `duplicate pageId ${entry.cms_config.pageId}`).toBeFalsy();
      seen.add(entry.cms_config.pageId);
      // From scripts/page-types.js, not restated. This line held a fourth
      // copy of the vocabulary and was the last thing standing between the
      // owner and a working regeneration run: it went stale exactly like the
      // two validators did, and only failed once navigation.json actually
      // contained a gallery page.
      expect([...VALID_PAGE_TYPES]).toContain(entry.cms_config.pageType);
      expect([...VALID_EDIT_ROLES]).toContain(entry.cms_config.editRole);
    }
  }
});

test('editRole gate: locked page hides the Edit button, open page shows it', async ({ page }) => {
  // Boomcat's page has the edit button elements in its DOM already, so we
  // can exercise initTabEditorButtons() directly against different pageIds
  // on the same page/button without needing a locked page that actually
  // calls it (none currently do - this tests the gate mechanism itself).
  //
  // The button's hidden-by-default state now comes entirely from its own
  // .tab-editor-btn-sidebar class (style/Layout.css), not an inline style -
  // js/pagebuilder.js un-hides it via classList.add('is-active') rather
  // than a direct style.display write (mobile-support pass). So this test
  // resets to that true default via classList.remove instead of forcing an
  // inline display: none, which a bare classList toggle correctly can't
  // override (inline styles always beat a non-!important class rule) - and
  // Boomcat's own page bootstrap already ran initTabEditorButtons('boomcat',
  // 'character') once before this test's manual calls even start, since
  // it's an open page.
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    const btn = document.getElementById('btn-edit-current-tab');
    btn.classList.remove('is-active');
    const beforeAny = getComputedStyle(btn).display;

    await window.initTabEditorButtons('collaborators', 'system'); // editRole: locked
    const afterLocked = getComputedStyle(btn).display;

    await window.initTabEditorButtons('boomcat', 'character'); // editRole: open
    const afterOpen = getComputedStyle(btn).display;

    return { beforeAny, afterLocked, afterOpen };
  });

  expect(result.beforeAny).toBe('none'); // true default, no inline style needed
  expect(result.afterLocked).toBe('none'); // locked gate early-returns, leaves it untouched
  expect(result.afterOpen).toBe('flex');
});

test('elevated pages (template, tierlist) still show the Edit button', async ({ page }) => {
  await page.goto('/characters/Template/index.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#btn-edit-current-tab')).toBeVisible();

  await page.goto('/systems/tierlist/index.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#btn-edit-current-tab')).toBeVisible();
});

test('loadPageAlerts renders the WIP banner for a WIP page', async ({ page }) => {
  // Crow Charmer is isWip:true in navigation.json; its page passes the
  // canonical pageId ('crow_charmer'), not the old id field ('Sus-Sister').
  await page.goto('/characters/Crow_charmer/index.html', { waitUntil: 'networkidle' });
  await expect(page.locator('.alert-wip')).toBeVisible();
});

test('homepage roster and sidebar render every navigation.json entry', async ({ page }) => {
  const navResponse = await page.goto('/data/navigation.json');
  const nav = await navResponse.json();
  const totalEntries = Object.values(nav).reduce((sum, arr) => sum + arr.length, 0);

  // Hidden characters are private-server-only and filtered OUT of the roster by
  // default - renderFilteredRoster in js/pagebuilder.js, where the "Show Hidden"
  // toggle lets them back in. Counting the raw Characters length asserted the
  // opposite of that feature, so this passed only while no page was hidden. The
  // first one the owner ticked failed it, and because the regeneration job runs
  // this suite before it commits, it blocked every regeneration rather than
  // merely going red. Derived from the data, not hardcoded, so it stays true
  // whether or not anything is hidden today.
  const characters = nav['Characters'];
  const visible = characters.filter(c => !c.isHidden);

  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#roster-grid > *')).toHaveCount(visible.length);
  // The sidebar is a directory, not the roster: hiding is a roster filter and
  // nothing more, so every entry is still listed there.
  await expect(page.locator('#global-sidebar-nav a')).toHaveCount(totalEntries);

  // And when something IS hidden, prove it is the hidden one that is missing
  // rather than an off-by-one that happens to add up.
  const hidden = characters.filter(c => c.isHidden);
  if (hidden.length > 0) {
    const rendered = await page.locator('#roster-grid > *').allTextContents();
    for (const c of hidden) {
      expect(rendered.join(' '), `${c.name} is hidden from the roster`).not.toContain(c.name);
    }
  }
});
