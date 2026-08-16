// The Combos tab: grouped combo tables, adapted from Dustloop's.
//
// A character's combos are grouped by STARTER, and each group draws one
// sortable table. `desc_data.combos` is a keyed array like matchups and
// counterplay (js/character_tabs.js), so submit, merge, diff and the editor's
// group nav all come from the shared machinery - only the table is bespoke.
//
// The two sort keys are the part worth protecting. Both are wrong under the
// obvious implementation, and both are wrong QUIETLY - a mis-sorted column
// still looks like a sorted column.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const vocab = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'character_tabs.js'), 'utf8');
  const w = {};
  new Function('window', src)(w);
  return w;
})();

const COMBOS = vocab.getKeyedSectionByTab('combos');

// Damage values taken from the owner's live pages: ranges and parenthesised
// sums are both real.
const GROUPS = [
  {
    starter: 'True Combos',
    rows: [
      { sequence: ['M1', 'M1', 'MURMURATE'], damage: '38-46', difficulty: 'Easy', notes: 'Bread and butter.' },
      { sequence: ['M1', '2', 'AIR UPDRAFT'], damage: '4 (2+2)', difficulty: 'Demon Time', notes: 'Drops on small models.' },
      { sequence: ['MURMURATE', 'CIRCLING'], damage: '28', difficulty: 'Medium', setup: 'Hard knockdown' },
    ],
  },
  {
    starter: 'Advanced',
    rows: [{ sequence: ['DIVE BOMB', 'R↑'], damage: '52', difficulty: 'Extremely Hard' }],
  },
];

async function renderCombos(page, groups = GROUPS) {
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(g => window.renderCombosTab({ combos: g }), groups);
  // Open the tab the way a reader does. Without this the panel stays hidden,
  // and a hidden table's headers cannot be clicked - which is a property of
  // the page, not of the test.
  await page.locator('#nav-combos').click();
  await page.waitForTimeout(150);
}

test('combos is a keyed section, so the shared pipeline covers it', () => {
  expect(COMBOS, 'combos must be declared keyed or nothing submits it').toBeTruthy();
  expect(COMBOS.keyField).toBe('starter');
  expect(COMBOS.rowsField).toBe('rows');
  // Its own renderer, but the SHARED editor - a group is a name plus blocks
  // like any keyed entry, with one extra panel for the rows.
  expect(COMBOS.customRenderer).toBe(true);
  expect(vocab.usesSharedKeyedUI('combos'), 'combos reuses the keyed-entry editor').toBe(true);
  // The scope is not 'combo': that is already a BLOCK type (the inline route),
  // and two namespaces sharing a word is how the next person loses an hour.
  expect(COMBOS.scope).toBe('comboGroup');
});

test('damage sorts by its leading number, not as text', async ({ page }) => {
  // '4 (2+2)' sorts above '38-46' lexically, which is wrong by every reading.
  await renderCombos(page);
  await page.locator('.combo-group').first().locator('[data-sort-field="damage"]').click();
  await page.waitForTimeout(150);

  const order = await page.evaluate(() =>
    [...document.querySelectorAll('.combo-group')[0].querySelectorAll('.combo-cell-damage')]
      .map(td => td.textContent.trim()));

  expect(order).toEqual(['4 (2+2)', '28', '38-46']);
});

test('difficulty sorts by its ordinal, not alphabetically', async ({ page }) => {
  // 'Demon Time' sorts FIRST alphabetically and LAST by meaning. This is the
  // assertion that a sort written the obvious way fails.
  await renderCombos(page);
  await page.locator('.combo-group').first().locator('[data-sort-field="difficulty"]').click();
  await page.waitForTimeout(150);

  const order = await page.evaluate(() =>
    [...document.querySelectorAll('.combo-group')[0].querySelectorAll('.combo-cell-difficulty')]
      .map(td => td.textContent.trim()));

  expect(order).toEqual(['Easy', 'Medium', 'Demon Time']);

  // And clicking again reverses it rather than re-sorting the same way.
  await page.locator('.combo-group').first().locator('[data-sort-field="difficulty"]').click();
  await page.waitForTimeout(150);
  const reversed = await page.evaluate(() =>
    [...document.querySelectorAll('.combo-group')[0].querySelectorAll('.combo-cell-difficulty')]
      .map(td => td.textContent.trim()));
  expect(reversed).toEqual(['Demon Time', 'Medium', 'Easy']);
});

test('the difficulty list is the sort key, so its order is load-bearing', async ({ page }) => {
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'domcontentloaded' });
  const levels = await page.evaluate(() => window.COMBO_DIFFICULTIES);

  expect(levels[0]).toBe('Very Easy');
  expect(levels[levels.length - 1]).toBe('Demon Time');
  expect(levels).toHaveLength(8);

  // An unrecognised value sorts last rather than as zero - a typo must not
  // quietly become the easiest combo in the table.
  const rank = await page.evaluate(() => ({
    known: window.comboSortValue({ difficulty: 'Medium' }, { field: 'difficulty', sort: 'difficulty' }),
    typo: window.comboSortValue({ difficulty: 'Medum' }, { field: 'difficulty', sort: 'difficulty' }),
    blankDamage: window.comboSortValue({ damage: '' }, { field: 'damage', sort: 'leadingNumber' }),
  }));
  expect(rank.typo).toBeGreaterThan(rank.known);
  expect(rank.blankDamage).toBeGreaterThan(0);
});

test('optional columns appear only when earned, and every group shares a shape', async ({ page }) => {
  // Setup is filled on one row of one group; Controls on none. So Setup shows
  // in BOTH tables and Controls in neither - per group, a reader scrolling
  // down would watch columns appear and disappear between two tables meant to
  // be read the same way.
  await renderCombos(page);

  const headers = await page.evaluate(() =>
    [...document.querySelectorAll('.combo-group')].map(g =>
      [...g.querySelectorAll('.combo-th')].map(th => th.textContent.replace(/[↑↓↕]/g, '').trim())));

  expect(headers).toHaveLength(2);
  expect(headers[0], 'both groups render the same columns').toEqual(headers[1]);
  expect(headers[0]).toContain('Setup');
  expect(headers[0], 'no row filled Controls in, so it costs no width').not.toContain('Controls');
  expect(headers[0][0]).toBe('Combo');
});

test('a route in the table reads exactly like a route in prose', async ({ page }) => {
  // Same .combo-node chips and '>' separators as the legacy combo block, so a
  // combo looks the same wherever it appears.
  await renderCombos(page);

  const first = await page.evaluate(() => {
    const cell = document.querySelector('.combo-cell-sequence');
    return {
      chips: [...cell.querySelectorAll('.combo-node')].map(n => n.textContent),
      seps: [...cell.querySelectorAll('.combo-sep')].map(s => s.textContent.trim()),
    };
  });

  expect(first.chips).toEqual(['M1', 'M1', 'MURMURATE']);
  expect(first.seps).toEqual(['>', '>']);
});

test('every row becomes a card on a phone, and empty fields drop out', async ({ page }) => {
  // Ten columns cannot fit a phone. This site collapses matchup cards rather
  // than scrolling them, so a sideways-scrolling table would be the one place
  // that behaves differently.
  await page.setViewportSize({ width: 420, height: 900 });
  await renderCombos(page);

  const mobile = await page.evaluate(() => {
    const row = document.querySelector('.combo-row');
    const damage = row.querySelector('.combo-cell-damage');
    const emptyCell = document.querySelectorAll('.combo-group')[0]
      .querySelector('.combo-row:first-child .combo-cell-is-empty');
    return {
      headerHidden: getComputedStyle(document.querySelector('.combo-table thead')).display,
      rowIsBlock: getComputedStyle(row).display,
      // The label is generated from data-label rather than the hidden header.
      damageLabel: damage.getAttribute('data-label'),
      damageIsFlex: getComputedStyle(damage).display,
      emptyHidden: emptyCell ? getComputedStyle(emptyCell).display : 'none',
      pageScrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });

  expect(mobile.headerHidden).toBe('none');
  expect(mobile.rowIsBlock).toBe('block');
  expect(mobile.damageLabel).toBe('Damage');
  // `.combo-table td` outranks `.combo-cell`, so a display:block on td here
  // silently un-flexed the label and ran it into its value.
  expect(mobile.damageIsFlex, 'the label must stay a flex item').toBe('flex');
  expect(mobile.emptyHidden, 'an empty field is not a labelled row saying "-"').toBe('none');
  expect(mobile.pageScrollsSideways, 'the page itself must never scroll sideways').toBe(false);
});

test('nothing a contributor writes into a row is parsed as markup', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await renderCombos(page, [{
    starter: '<img src=x onerror="window.__PWN=1">',
    rows: [{
      sequence: ['<img src=x onerror="window.__PWN=1">'],
      damage: '<img src=x onerror="window.__PWN=1">',
      notes: '<img src=x onerror="window.__PWN=1">',
      difficulty: '<img src=x onerror="window.__PWN=1">',
      // A javascript: URL is not an escaping problem - it needs the scheme
      // check, the same one the block renderer uses.
      video: 'javascript:window.__PWN=1',
    }],
  }]);
  await page.waitForTimeout(400);

  const result = await page.evaluate(() => ({
    fired: !!window.__PWN,
    injected: document.querySelectorAll('#tab-combos img').length,
    videoHref: document.querySelector('.combo-video-link')?.getAttribute('href') || null,
  }));

  expect(result.fired).toBe(false);
  expect(result.injected).toBe(0);
  expect(result.videoHref, 'a javascript: video link is dropped, not rendered').toBeNull();
  expect(errors).toEqual([]);
});

test('the editor creates a group and a combo, in a modal', async ({ page }) => {
  // Driven through the real controls. The row form is a modal because the
  // editor's left pane shares the screen with the live preview and a dozen
  // fields in it was mostly scroll (owner, 2026-08-16).
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto('/edit.html?char=boomcat&type=character&tab=combos', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  await page.locator('[onclick*="addKeyedEntry"]').first().click();
  await page.waitForTimeout(300);
  await page.locator('#combo-row-add').click();
  await page.waitForTimeout(300);

  await expect(page.locator('#combo-row-modal'), 'adding a combo opens its editor')
    .not.toHaveClass(/\bhidden\b/);

  await page.locator('[data-combo-field="sequence"]').fill('M1\n\nMURMURATE\nR↑');
  await page.locator('[data-combo-field="damage"]').fill('38-46');
  await page.selectOption('#combo-row-modal select[data-combo-field="difficulty"]', 'Medium', { force: true });
  await page.waitForTimeout(400);

  const state = await page.evaluate(() => ({
    row: (window.currentEditorDescData.combos || [])[0]?.rows?.[0],
    previewRows: document.querySelectorAll('#tab-combos .combo-row').length,
  }));

  // Blank lines are dropped rather than becoming empty chips in the route.
  expect(state.row.sequence).toEqual(['M1', 'MURMURATE', 'R↑']);
  expect(state.row.damage).toBe('38-46');
  expect(state.row.difficulty).toBe('Medium');
  expect(state.previewRows, 'the live preview shows the table as it types').toBe(1);

  await page.locator('#combo-row-modal-done').click();
  await page.waitForTimeout(250);

  const closed = await page.evaluate(() => ({
    hidden: document.getElementById('combo-row-modal').classList.contains('hidden'),
    // The row button shows the route, because that is how an author
    // recognises which combo they are editing.
    summary: document.querySelector('.combo-row-open')?.textContent,
  }));

  expect(closed.hidden).toBe(true);
  expect(closed.summary).toBe('M1 > MURMURATE > R↑');
  expect(errors).toEqual([]);
});
