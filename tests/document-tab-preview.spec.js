// Editing a block in a document tab must not destroy the tab's preview.
//
// THE BUG THIS EXISTS FOR
//
// updateLivePreview (js/editor-sync.js) branches on the open tab: frame tabs,
// overview, matchups, then any tab using the shared keyed UI. Combos matched
// none of them - getKeyedSectionByTab requires `field === tabId`, and Combos is
// a DOCUMENT (comboIntro + comboGroups + comboList) rather than a keyed array -
// so it fell through to the generic else:
//
//     populateTextSection('tab-combos', `Editing combos`, currentStrategyBlocks)
//
// which replaced the whole composed tab with a bare block dump titled "Editing
// combos". Editing a card's FIELDS was fine, because those handlers call the
// document preview directly; editing a BLOCK in its write-up was not, because
// js/editor-blocks.js calls updateLivePreview.
//
// Live from the moment the Combos tab shipped in v0.15 item 3, and found while
// generalising that editor for Techs.
//
// Drives the real control rather than calling updateLivePreview directly: the
// claim is about what happens when somebody types, and the path from a
// keystroke to the wiped preview runs through the block editor.
const { test, expect } = require('@playwright/test');

test('typing in a combo card write-up leaves the composed tab intact', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto('/edit.html?char=boomcat&type=character&tab=combos', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  await page.locator('[onclick*="addDocumentGroup"]').click();
  await page.waitForTimeout(400);
  await page.locator('#combo-card-add').click();
  await page.waitForTimeout(400);

  // Give the card a name, so the preview has something identifiable in it that
  // is not the block text.
  await page.locator('[data-card-field="title"]').fill('Corner BnB');
  await page.waitForTimeout(300);

  // Now add a block to the card's write-up and type into it. This is the
  // keystroke path - editor-blocks.js calls updateLivePreview.
  await page.locator('#btn-toggle-add-menu').click();
  await page.waitForTimeout(200);
  await page.locator('#add-block-popup [data-type="paragraph"]').first().click();
  await page.waitForTimeout(400);

  const field = page.locator('#strategy-block-target textarea, #strategy-block-target [contenteditable="true"]').first();
  await field.fill('Works midscreen after a wall bounce.');
  await page.waitForTimeout(600);

  const tab = await page.evaluate(() => {
    const el = document.getElementById('tab-combos');
    return { text: el ? el.innerText : '', html: el ? el.innerHTML : '' };
  });

  // The failure was unmistakable and is asserted as such: the generic branch
  // titles its section "Editing <tabId>", a string that appears nowhere on the
  // wiki and only ever came from that fallback.
  expect(tab.text, 'the generic fallback replaced the composed tab')
    .not.toContain('Editing combos');

  // And the positive claim - the tab is still the composed document. Asserting
  // only the absence above would keep passing if the preview went blank, which
  // is the "absence assertion survives the change" trap this project keeps
  // finding in its own tests.
  expect(tab.text, 'the card this test made should still be rendered').toContain('Corner BnB');
  expect(tab.text, 'the typed block should appear inside it').toContain('Works midscreen');
  expect(tab.html, 'the combo card should still render as a TheoryBox').toContain('theorybox');

  expect(errors).toEqual([]);
});
