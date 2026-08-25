// v0.16 fine-tuning 1: "Call it Combo Card everywhere."
//
// This was filed as a request to ADD a block that has existed since v0.15. The
// Add Block menu creates one, labelled "+ Combo Card"; the type selector on
// every card built its options from `Object.keys(blockTemplates)` uppercased, so
// it printed the raw template key `THEORYBOX`. The owner went looking for the
// name their dropdown kept showing them and did not find it.
//
// Every type had the problem - PARAGRAPH, YOUTUBE, THEORYBOX - because nothing
// ever mapped keys to names. The fix is one map both surfaces read, so the test
// that matters is the two-way one: the menu and the dropdown must offer the same
// vocabulary. A consistency check in one direction would have passed happily
// while the dropdown said THEORYBOX and the menu said Combo Card.
const { test, expect } = require('@playwright/test');

const EDITOR = '/edit.html?char=boomcat&type=character&tab=overview';

async function openWorkspace(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto(EDITOR, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    window.currentEditorPageType = 'character';
    window.currentEditorCharId = 'testchar';
    window.currentOverviewSection = null;
    window.currentEditorDescData = {
      overview: [{ type: 'theorybox', title: 'A card', sequence: [], content: [] },
                 { type: 'paragraph', content: 'text' }],
      strategy: [], extras: [], matchups: [], counterplay: [], moveStrategies: {},
      profile: { image: '', stats: [] }, playstyle: { likes: [], dislikes: [] },
    };
    window.currentEditorFrameData = { m1s: [], skills: [], specials: [] };
    initFullTabEditor('testchar', 'overview', window.currentEditorDescData, window.currentEditorFrameData);
    window.loadOverviewSectionIntoEditor('overview');
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    (window.getActiveBlocks() || []).forEach(b => window.setEditorBlockExpanded(b, true));
    window.renderBlockList();
  });
  await page.waitForTimeout(600);
  return errors;
}

test('the type dropdown says Combo Card, not THEORYBOX', async ({ page }) => {
  const errors = await openWorkspace(page);

  const seen = await page.evaluate(() => {
    const sel = document.querySelector('#block-list .block-type-selector');
    // initializeMangaSelects hides the native <select> behind a custom
    // dropdown, so the trigger is the text the owner actually read when they
    // went looking for "THEORYBOX" in the Add Block menu. Assert that, not just
    // the option the browser has selected underneath it.
    const trigger = sel.parentNode.querySelector('.manga-select-trigger');
    return {
      options: Array.from(sel.options).map(o => o.textContent),
      // The VALUE has to stay the template key, or selecting a type stops
      // matching anything in blockTemplates and the block silently breaks.
      values: Array.from(sel.options).map(o => o.value),
      selectedLabel: sel.options[sel.selectedIndex].textContent,
      onScreen: trigger ? trigger.textContent.trim() : null,
    };
  });

  expect(seen.onScreen, 'what the dropdown shows on screen').toBe('Combo Card');
  expect(seen.selectedLabel, 'the card the owner was looking at').toBe('Combo Card');
  expect(seen.options, 'no raw template keys left in the dropdown')
    .not.toContain('THEORYBOX');
  expect(seen.values, 'and the values are still the keys the templates use')
    .toContain('theorybox');
  expect(seen.options, 'the other types read as names too').toContain('Paragraph');
  expect(seen.options).toContain('YouTube');
  expect(errors).toEqual([]);
});

test('the Add Block menu and the type dropdown offer the same vocabulary', async ({ page }) => {
  // Both directions. "Everything the menu offers, the dropdown names" was true
  // for eleven of thirteen types before the fix, and the two it missed were the
  // whole bug.
  await openWorkspace(page);

  const seen = await page.evaluate(() => {
    const menu = Array.from(document.querySelectorAll('#add-block-popup .add-block-btn'));
    const sel = document.querySelector('#block-list .block-type-selector');
    return {
      menuTypes: menu.map(b => b.getAttribute('data-type')),
      menuLabels: menu.map(b => b.textContent.replace(/^\+\s*/, '').trim()),
      selTypes: Array.from(sel.options).map(o => o.value),
      selLabels: Array.from(sel.options).map(o => o.textContent.trim()),
    };
  });

  expect(seen.menuTypes.length, 'setup: the menu rendered').toBeGreaterThan(5);

  // Same set of types, and the same name for each one.
  expect([...seen.menuTypes].sort(), 'the menu offers exactly what the dropdown does')
    .toEqual([...seen.selTypes].sort());

  const menuByType = Object.fromEntries(seen.menuTypes.map((t, i) => [t, seen.menuLabels[i]]));
  const selByType = Object.fromEntries(seen.selTypes.map((t, i) => [t, seen.selLabels[i]]));
  expect(menuByType, 'and calls each one the same thing').toEqual(selByType);
});

test('picking a type by its new label still changes the block', async ({ page }) => {
  // The label map must not have broken the thing the dropdown is for.
  const errors = await openWorkspace(page);

  // Driven through the custom dropdown, because the native <select> is hidden
  // behind it and nobody can click that.
  const card = page.locator('#block-list .block-card').nth(1);
  await card.locator('.block-type-selector + .manga-select-wrapper .manga-select-trigger').click();
  await card.locator('.manga-select-options .manga-option', { hasText: /^Callout$/ }).click();
  await page.waitForTimeout(500);

  const after = await page.evaluate(() => {
    const sel = document.querySelectorAll('#block-list .block-type-selector')[1];
    return {
      type: window.getActiveBlocks()[1].type,
      label: sel.options[sel.selectedIndex].textContent,
      onScreen: sel.parentNode.querySelector('.manga-select-trigger').textContent.trim(),
    };
  });

  expect(after.type, 'the block really became a callout').toBe('callout');
  expect(after.label, 'and the dropdown shows its name').toBe('Callout');
  expect(after.onScreen, 'on screen too').toBe('Callout');
  expect(errors).toEqual([]);
});
