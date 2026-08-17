// Reorder and insert in place - v0.15 item 8.
//
// Every author-ordered list in the editor could only be appended to. Adding a
// variant next to Skill 1 meant deleting and re-entering every skill after it.
//
// One mechanism serves eight strips, so most of these tests are about the
// mechanism, plus one per strip that it is actually wired in.
const { test, expect } = require('@playwright/test');

const CHAR = '/edit.html?char=boomcat&type=character&tab=matchups';

async function boot(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.moveListItem === 'function', { timeout: 15000 });
  await page.waitForTimeout(1500);
}

test('moving an item swaps it with its neighbour, and the ends refuse', async ({ page }) => {
  await boot(page, CHAR);

  const out = await page.evaluate(() => {
    const list = ['a', 'b', 'c'];
    const results = {};
    window.moveListItem(list, 1, -1); results.left = list.slice();
    window.moveListItem(list, 1, 1);  results.back = list.slice();
    results.offStart = window.moveListItem(list, 0, -1);
    results.offEnd = window.moveListItem(list, 2, 1);
    results.final = list.slice();
    return results;
  });

  expect(out.left).toEqual(['b', 'a', 'c']);
  expect(out.back).toEqual(['b', 'c', 'a']);
  // Refused rather than wrapping around or silently doing nothing to the array.
  expect(out.offStart).toBe(false);
  expect(out.offEnd).toBe(false);
  expect(out.final).toEqual(['b', 'c', 'a']);
});

test('one fixed control group per strip, not one per item', async ({ page }) => {
  await boot(page, CHAR);

  await page.evaluate(() => {
    window.currentEditorDescData.matchups = [
      { opponent: 'Zzq Alpha', tier: 'even', content: [] },
      { opponent: 'Zzq Beta', tier: 'even', content: [] },
      { opponent: 'Zzq Gamma', tier: 'even', content: [] },
    ];
    initFullTabEditor('boomcat', 'matchups', window.currentEditorDescData, window.currentEditorFrameData);
  });
  await page.waitForTimeout(500);

  // Per-item controls moved with the entry being reordered, so a second nudge
  // meant chasing them along the row.
  expect(await page.locator('.daw-reorder-group').count()).toBe(1);
  expect(await page.locator('.daw-tab-item .daw-tab-move-btn').count()).toBe(0);
  expect(await page.locator('.daw-reorder-group .daw-tab-move-btn').count()).toBe(2);
});

test('the selection rides along with the entry being moved', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await boot(page, CHAR);

  // Three matchups of this test's own, so the assertion does not depend on
  // whatever the owner has written on the real page.
  await page.evaluate(() => {
    window.currentEditorDescData.matchups = [
      { opponent: 'Zzq Alpha', tier: 'even', content: [] },
      { opponent: 'Zzq Beta', tier: 'even', content: [] },
      { opponent: 'Zzq Gamma', tier: 'even', content: [] },
    ];
    initFullTabEditor('boomcat', 'matchups', window.currentEditorDescData, window.currentEditorFrameData);
  });
  await page.waitForTimeout(500);

  // Select the LAST one, then move it left twice without moving the mouse.
  await page.locator('#matchup-nav-2').click();
  await page.waitForTimeout(400);

  const moveLeft = page.locator('.daw-reorder-group .daw-tab-move-btn').first();
  await moveLeft.click();
  await page.waitForTimeout(500);
  await moveLeft.click();
  await page.waitForTimeout(500);

  const state = await page.evaluate(() => ({
    order: window.currentEditorDescData.matchups.map(m => m.opponent),
    active: document.querySelector('.daw-editor-nav-row .daw-tab-btn.active')?.textContent.trim(),
  }));

  // Two clicks in the same place carried it two positions - which only works
  // if the selection followed it. Without that, the second click would have
  // moved whatever had slid into the old slot.
  expect(state.order).toEqual(['Zzq Gamma', 'Zzq Alpha', 'Zzq Beta']);
  expect(state.active, 'the entry that was moved should still be open').toBe('vs. Zzq Gamma');
  expect(errors).toEqual([]);
});

test('with nothing movable selected, the controls do nothing', async ({ page }) => {
  await boot(page, '/edit.html?char=boomcat&type=character&tab=overview');

  // The Overview strip's first four entries are fixed sections with no
  // .daw-tab-item wrapper, so opening one means nothing reorderable is active.
  await page.evaluate(() => {
    window.currentEditorDescData.extras = [
      { title: 'Zzq One', content: [] },
      { title: 'Zzq Two', content: [] },
    ];
    initFullTabEditor('boomcat', 'overview', window.currentEditorDescData, window.currentEditorFrameData);
  });
  await page.waitForTimeout(500);
  await page.locator('#overview-nav-strategy').click();
  await page.waitForTimeout(400);

  await page.locator('.daw-reorder-group .daw-tab-move-btn').first().click();
  await page.waitForTimeout(400);

  const order = await page.evaluate(() =>
    window.currentEditorDescData.extras.map(e => e.title));
  expect(order, 'nothing reorderable was open, so nothing should move').toEqual(['Zzq One', 'Zzq Two']);
});

test('every ordered strip offers the controls', async ({ page }) => {
  // Wiring, not behaviour: the mechanism is shared, so what can break is a
  // strip forgetting to call it. Derived from the source rather than by
  // clicking through six tabs.
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..');

  const wired = {
    'js/editor-tabs.js': [
      /reorderStripControls\(`frame\.\$\{tabId\}`/,       // moves
      /reorderStripControls\('desc\.extras'/,             // overview custom sections
      /reorderStripControls\('desc\.matchups'/,           // matchups
      /reorderStripControls\(`desc\.\$\{groups\.field\}`/, // combo groups
      /reorderStripControls\(`desc\.\$\{section\.field\}`/, // counterplay, starter guide, later ones
    ],
    'js/editor-system.js': [
      /reorderStripControls\('desc\.tabs'/,                       // system tabs
      /reorderStripControls\(`desc\.tabs\.\$\{window\.currentSystemTabIdx\}\.sections`/, // system sections
    ],
  };

  const missing = [];
  for (const [file, patterns] of Object.entries(wired)) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    patterns.forEach(p => { if (!p.test(src)) missing.push(`${file} :: ${p}`); });
  }
  expect(missing, 'a strip that does not call reorderStripControls cannot be reordered').toEqual([]);
});

test('inserting reuses the strip’s own add flow', async ({ page }) => {
  await boot(page, CHAR);

  const out = await page.evaluate(async () => {
    window.currentEditorDescData.matchups = [
      { opponent: 'Zzq Alpha', tier: 'even', content: [] },
      { opponent: 'Zzq Beta', tier: 'even', content: [] },
    ];
    // Stand in for the real add so the test does not depend on its prompt,
    // while still proving the module APPENDS through it and then relocates.
    window.registerInserter('desc.matchups', () => {
      window.currentEditorDescData.matchups.push({ opponent: 'Zzq Inserted', tier: 'even', content: [] });
    });

    const moved = await window.insertListItemAfter('desc.matchups', 0);
    return { moved, order: window.currentEditorDescData.matchups.map(m => m.opponent) };
  });

  expect(out.moved).toBe(true);
  // Appended by the add flow, then relocated to just after index 0.
  expect(out.order).toEqual(['Zzq Alpha', 'Zzq Inserted', 'Zzq Beta']);
});

test('a cancelled add inserts nothing', async ({ page }) => {
  await boot(page, CHAR);

  const out = await page.evaluate(async () => {
    window.currentEditorDescData.matchups = [{ opponent: 'Zzq Alpha', tier: 'even', content: [] }];
    // addMove prompts for an id and returns without adding when cancelled.
    window.registerInserter('desc.matchups', () => { /* user cancelled */ });

    const moved = await window.insertListItemAfter('desc.matchups', 0);
    return { moved, length: window.currentEditorDescData.matchups.length };
  });

  // Length is what decides, not the return of the add flow - a flow that
  // cancels silently would otherwise relocate whatever happened to be last.
  expect(out.moved).toBe(false);
  expect(out.length).toBe(1);
});

test('a reorder on a character page does not rebuild the system editor', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await boot(page, CHAR);

  // js/editor-system.js registers a refresh hook at file load, and edit.html
  // loads it on every page type. Both editors render into #interactive-builder,
  // so a hook that did not decline would draw the system editor over this one.
  await page.evaluate(() => {
    window.currentEditorDescData.matchups = [
      { opponent: 'Zzq Alpha', tier: 'even', content: [] },
      { opponent: 'Zzq Beta', tier: 'even', content: [] },
    ];
    initFullTabEditor('boomcat', 'matchups', window.currentEditorDescData, window.currentEditorFrameData);
  });
  await page.waitForTimeout(400);

  await page.locator('#matchup-nav-1').click();
  await page.waitForTimeout(300);
  await page.locator('.daw-reorder-group .daw-tab-move-btn').first().click();
  await page.waitForTimeout(600);

  const state = await page.evaluate(() => ({
    order: window.currentEditorDescData.matchups.map(m => m.opponent),
    // The system editor's own controls must be nowhere on this page.
    systemAddTab: document.querySelectorAll('.system-tab-add-btn').length,
    matchupStrip: document.querySelectorAll('[id^="matchup-nav-"]').length,
  }));

  expect(state.order).toEqual(['Zzq Beta', 'Zzq Alpha']);
  expect(state.systemAddTab, 'the system editor must not have been drawn here').toBe(0);
  expect(state.matchupStrip).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('a system section can be reordered', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await boot(page, '/edit.html?char=m1-trading&type=system');

  await page.evaluate(() => {
    window.currentEditorDescData.tabs = [{
      tabId: 'basics', tabLabel: 'Basics',
      sections: [
        { sectionTitle: 'Zzq One', layout: 'full', blocks: [] },
        { sectionTitle: 'Zzq Two', layout: 'full', blocks: [] },
        { sectionTitle: 'Zzq Three', layout: 'full', blocks: [] },
      ],
    }];
    window.currentSystemTabIdx = 0;
    window.currentSystemSecIdx = 0;
    window.renderSystemEditor(document.getElementById('interactive-builder'));
  });
  await page.waitForTimeout(400);

  // Section 1 is already selected (currentSystemSecIdx 0); move it right.
  await page.locator('.system-section-tabs-row .daw-reorder-group .daw-tab-move-btn').nth(1).click();
  await page.waitForTimeout(600);

  const order = await page.evaluate(() =>
    window.currentEditorDescData.tabs[0].sections.map(s => s.sectionTitle));
  expect(order).toEqual(['Zzq Two', 'Zzq One', 'Zzq Three']);
  expect(errors).toEqual([]);
});

test('a reordered system page ships an order change, not its content', async ({ page }) => {
  // Item 6b's `order` delta is what makes this cheap: moving a section must not
  // resend every section's prose, or a reorder would carry a stale copy of
  // somebody else's edit.
  await boot(page, '/edit.html?char=m1-trading&type=system');

  const deltas = await page.evaluate(() => {
    const live = { tabs: [{ tabId: 'basics', tabLabel: 'Basics', sections: [
      { sectionTitle: 'One', layout: 'full', blocks: [{ type: 'paragraph', content: 'first' }] },
      { sectionTitle: 'Two', layout: 'full', blocks: [{ type: 'paragraph', content: 'second' }] },
    ] }] };

    const moved = JSON.parse(JSON.stringify(live));
    window.moveListItem(moved.tabs[0].sections, 0, 1);

    return window.buildSystemDeltas(moved, live, 'system');
  });

  const sectionDeltas = deltas.filter(d => d.scope === 'system_section');
  expect(sectionDeltas, 'a reorder must not resend section content').toEqual([]);

  const tabDelta = deltas.find(d => d.scope === 'system_tab');
  expect(tabDelta, 'the new order should ship as tab metadata').toBeTruthy();
  expect(tabDelta.payload.order).toEqual(['two', 'one']);
});
