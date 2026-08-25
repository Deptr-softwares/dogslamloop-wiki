// The Combos tab: a DOCUMENT of three parts, not a list.
//
//   comboIntro   [blocks]                       fixed, "Read First"
//   comboGroups  [{ title, content: [blocks] }]  N, keyed by title
//   comboList    [{ starter, rows: [...] }]      N, keyed by starter
//
// Same decomposition the Overview tab already has (overview + strategy +
// extras), and the same one the reference uses: prose, then author-named
// groups of cards, then the reference table LAST.
//
// The first build made the table a group's content, which left nowhere for the
// TheoryBox cards to live and put the reference index in the middle of the
// prose. These tests pin the document order so that cannot come back.
//
// EVERY selector here is scoped to #tab-combos. These specs render a fixture
// into ONE tab of a REAL page, and the Techs tab builds its tables from exactly
// the same machinery - so a page-wide `.combo-list-table` reads the owner's
// content next to this test's data and compares one against the other. That is
// how two of these started failing on 2026-08-25, when the owner wrote a table
// called "Boomcat Theory" into Boomcat's Techs tab: nothing here changed, and
// the tab under test was correct throughout.
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

const GROUPS = vocab.getKeyedSectionByField('comboGroups');
const LIST = vocab.getKeyedSectionByField('comboList');

// Damage values taken from the owner's live pages: ranges and parenthesised
// sums are both real.
const DATA = {
  comboIntro: [{ type: 'paragraph', content: 'Damage is measured on a training dummy.' }],
  comboGroups: [
    { title: 'True Combos', content: [{ type: 'paragraph', content: 'These always connect.' }] },
    { title: 'Advanced', content: [] },
  ],
  comboList: [
    {
      starter: 'M1 Starters',
      rows: [
        { sequence: ['M1', 'M1', 'MURMURATE'], damage: '38-46', difficulty: 'Easy', notes: 'Bread and butter.' },
        { sequence: ['M1', '2'], damage: '4 (2+2)', difficulty: 'Demon Time' },
        { sequence: ['M1', 'CIRCLING'], damage: '28', difficulty: 'Medium', setup: 'Hard knockdown' },
      ],
    },
    { starter: 'R↑ Starters', rows: [{ sequence: ['R↑', 'DIVE BOMB'], damage: '52', difficulty: 'Extremely Hard' }] },
  ],
};

async function renderCombos(page, data = DATA) {
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(d => window.renderCombosTab(d), data);
  // Open the tab the way a reader does; a hidden table's headers cannot be
  // clicked, which is a property of the page rather than of the test.
  await page.locator('#nav-combos').click();
  await page.waitForTimeout(150);
}

test('the tab is three sections, and the Combo List is last', async ({ page }) => {
  await renderCombos(page);

  const doc = await page.evaluate(() => ({
    // Each part is a document SECTION - a heading with its content under it,
    // not a card. A group wrapped in .wiki-section made every combo card a
    // card inside a card (owner, 2026-08-16).
    headings: [...document.querySelectorAll('#tab-combos .combo-section-title')].map(h => h.textContent),
    introIsCard: !!document.querySelector('#tab-combos section.wiki-section.combo-intro'),
    groupsInCards: document.querySelectorAll('#tab-combos .wiki-section .combo-group').length,
    tableTitles: [...document.querySelectorAll('#tab-combos .combo-list-table .card-header-title')].map(t => t.textContent),
    // Scoped to the tab under test. Unscoped, this counted every combo table on
    // the page, and the Techs tab renders them from the same machinery - so it
    // started failing the moment the owner wrote one there ("Boomcat Theory",
    // 2026-08-25). The fixture is this test's data; anything outside
    // #tab-combos belongs to whatever the owner has written and is not ours.
    tables: document.querySelectorAll('#tab-combos .combo-list-table').length,
    // The Combo List is last, after every group.
    listIsLast: (() => {
      const kids = [...document.querySelectorAll('#tab-combos > *')];
      return kids.findIndex(k => k.classList.contains('combo-list-section')) === kids.length - 1;
    })(),
  }));

  // Read First is deliberately NOT here: it is a mandatory prose section like
  // Overview, so it keeps its card. Only the groups lose the wrapper, because
  // the combo cards inside them are the sections (owner, 2026-08-16).
  expect(doc.headings).toEqual(['True Combos', 'Advanced', 'Combo List']);
  expect(doc.introIsCard, 'Read First stays a card').toBe(true);
  expect(doc.groupsInCards, 'a group is a heading, not a card wrapping its cards').toBe(0);
  expect(doc.tableTitles, 'the Combo List keys its tables by starter').toEqual(['M1 Starters', 'R↑ Starters']);
  expect(doc.tables).toBe(2);
  expect(doc.listIsLast).toBe(true);
});

test('the three sections are declared with the scopes the pipeline keys off', () => {
  // Groups are AUTHOR-NAMED: the reference says Beginner/Core/Specialized, the
  // owner's live pages say True/Simpler/Advanced. Hardcoding the reference's
  // names would import a vocabulary this community does not use.
  expect(GROUPS.keyField).toBe('title');
  expect(GROUPS.scope).toBe('comboGroup');

  // Keyed by STARTER is what keeps review readable: the reference has 127 rows
  // for one character, so as a single 'full' delta a reviewer faces all of
  // them at once.
  expect(LIST.keyField).toBe('starter');
  expect(LIST.scope).toBe('comboTable');
  expect(LIST.rowsField).toBe('rows');

  // comboIntro is a fixed block array, the same shape as overview/strategy.
  const intro = vocab.FIXED_BLOCK_SECTIONS.find(f => f.field === 'comboIntro');
  expect(intro, 'comboIntro must be declared or nothing submits it').toBeTruthy();
  expect(intro.scope).toBe('comboIntro');

  // The tab itself is not keyed - it is a document, not a list.
  expect(vocab.getKeyedSectionByTab('combos')).toBeNull();
  expect(vocab.getKeyedSectionsForTab('combos').map(s => s.field)).toEqual(['comboGroups', 'comboList']);
});

test('every section survives a delta, including the first one', async ({ page }) => {
  // The bug that shipped for Starter Guide: a scope with no branch in
  // applyDeltaToData returns the data unchanged and reports success.
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(() => {
    const intro = window.applyDeltaToData({}, {}, 'comboIntro', 'full',
      [{ type: 'paragraph', content: 'hi' }]);
    const group = window.applyDeltaToData({}, {}, 'comboGroup', 'True Combos',
      { title: 'True Combos', content: [] });
    const table = window.applyDeltaToData({}, {}, 'comboTable', 'M1 Starters',
      { starter: 'M1 Starters', rows: [{ sequence: ['M1'] }] });
    return {
      intro: (intro.newDesc.comboIntro || []).length,
      group: (group.newDesc.comboGroups || []).length,
      table: (table.newDesc.comboList || []).length,
    };
  });

  expect(result.intro, 'comboIntro writes into a field that does not exist yet').toBe(1);
  expect(result.group).toBe(1);
  expect(result.table).toBe(1);
});

test('damage sorts by its leading number, not as text', async ({ page }) => {
  // '4 (2+2)' sorts above '38-46' lexically, which is wrong by every reading.
  await renderCombos(page);
  await page.locator('#tab-combos .combo-list-table').first().locator('[data-sort-field="damage"]').click();
  await page.waitForTimeout(150);

  const order = await page.evaluate(() =>
    [...document.querySelectorAll('#tab-combos .combo-list-table')[0].querySelectorAll('.combo-cell-damage')]
      .map(td => td.textContent.trim()));

  expect(order).toEqual(['4 (2+2)', '28', '38-46']);
});

test('difficulty sorts by its ordinal, not alphabetically', async ({ page }) => {
  // 'Demon Time' sorts FIRST alphabetically and LAST by meaning - the
  // assertion a sort written the obvious way fails.
  await renderCombos(page);
  const th = page.locator('#tab-combos .combo-list-table').first().locator('[data-sort-field="difficulty"]');

  await th.click();
  await page.waitForTimeout(150);
  const asc = await page.evaluate(() =>
    [...document.querySelectorAll('#tab-combos .combo-list-table')[0].querySelectorAll('.combo-cell-difficulty')]
      .map(td => td.textContent.trim()));
  expect(asc).toEqual(['Easy', 'Medium', 'Demon Time']);

  await th.click();
  await page.waitForTimeout(150);
  const desc = await page.evaluate(() =>
    [...document.querySelectorAll('#tab-combos .combo-list-table')[0].querySelectorAll('.combo-cell-difficulty')]
      .map(td => td.textContent.trim()));
  expect(desc).toEqual(['Demon Time', 'Medium', 'Easy']);
});

test('an unrecognised difficulty sorts last, not as the easiest', async ({ page }) => {
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'domcontentloaded' });
  const rank = await page.evaluate(() => ({
    levels: window.COMBO_DIFFICULTIES,
    known: window.comboSortValue({ difficulty: 'Medium' }, { field: 'difficulty', sort: 'difficulty' }),
    typo: window.comboSortValue({ difficulty: 'Medum' }, { field: 'difficulty', sort: 'difficulty' }),
    blankDamage: window.comboSortValue({ damage: '' }, { field: 'damage', sort: 'leadingNumber' }),
  }));

  expect(rank.levels[0]).toBe('Very Easy');
  expect(rank.levels[rank.levels.length - 1]).toBe('Demon Time');
  expect(rank.levels).toHaveLength(8);
  expect(rank.typo, 'a typo must not become the easiest combo in the table').toBeGreaterThan(rank.known);
  expect(rank.blankDamage).toBeGreaterThan(0);
});

test('optional columns appear only when earned, and every table shares a shape', async ({ page }) => {
  // Setup is filled on one row of one table; Controls on none. So Setup shows
  // in BOTH and Controls in neither - per table, a reader scrolling down would
  // watch columns appear and disappear between two tables meant to be read the
  // same way.
  await renderCombos(page);

  // #tab-combos, not the whole page: the Techs tab builds its tables from the
  // same code, so an unscoped query reads the owner's content alongside this
  // test's fixture and compares one against the other.
  const headers = await page.evaluate(() =>
    [...document.querySelectorAll('#tab-combos .combo-list-table')].map(t =>
      [...t.querySelectorAll('.combo-th')].map(th => th.textContent.replace(/[↑↓↕]/g, '').trim())));

  expect(headers).toHaveLength(2);
  expect(headers[0], 'both tables render the same columns').toEqual(headers[1]);
  expect(headers[0]).toContain('Setup');
  expect(headers[0], 'no row filled Controls in, so it costs no width').not.toContain('Controls');
  expect(headers[0][0]).toBe('Combo');
});

test('a route in the table reads exactly like a route in prose', async ({ page }) => {
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
    const empty = document.querySelector('.combo-cell-is-empty');
    return {
      headerHidden: getComputedStyle(document.querySelector('.combo-table thead')).display,
      rowIsBlock: getComputedStyle(row).display,
      damageLabel: damage.getAttribute('data-label'),
      damageIsFlex: getComputedStyle(damage).display,
      emptyHidden: empty ? getComputedStyle(empty).display : 'none',
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

test('nothing a contributor writes is parsed as markup', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await renderCombos(page, {
    comboIntro: [],
    comboGroups: [{ title: '<img src=x onerror="window.__PWN=1">', content: [] }],
    comboList: [{
      starter: '<img src=x onerror="window.__PWN=1">',
      rows: [{
        sequence: ['<img src=x onerror="window.__PWN=1">'],
        damage: '<img src=x onerror="window.__PWN=1">',
        notes: '<img src=x onerror="window.__PWN=1">',
        // A javascript: URL is not an escaping problem - it needs the scheme
        // check, the same one the block renderer uses.
        video: 'javascript:window.__PWN=1',
      }],
    }],
  });
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

test('the editor is a sub-tab strip, and builds all three sections', async ({ page }) => {
  // Mirrors the Overview tab's editor:
  //   [ Read First ] [ Combo List ] [ True Combos x ] [ + GROUP ]
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto('/edit.html?char=boomcat&type=character&tab=combos', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const strip = await page.evaluate(() =>
    [...document.querySelectorAll('[id^="combos-nav-"]')].map(b => b.id));
  // The fixed two LEAD the strip; groups follow. Not an exact match, because
  // Boomcat is the owner's real page and may already carry groups of their
  // own - pinning the whole strip pins their content.
  expect(strip.slice(0, 2), 'the fixed two come first').toEqual(['combos-nav-intro', 'combos-nav-list']);
  await expect(page.locator('#strategy-block-target'), 'Read First opens on a block builder')
    .toHaveCount(1);

  // A group.
  await page.locator('[onclick*="addDocumentGroup"]').click();
  await page.waitForTimeout(300);
  await page.locator('#combos-editor-container input[type="text"]').first().fill('True Combos');
  await page.waitForTimeout(300);

  const afterGroup = await page.evaluate(() => ({
    groups: (window.currentEditorDescData.comboGroups || []).map(g => g.title),
    // The group THIS test opened, not group-0: Boomcat may already have some.
    openIdx: parseInt(String(window.currentDocSection || '').replace('group-', ''), 10),
    navLabel: document.getElementById(`combos-nav-${window.currentDocSection}`)?.textContent,
    previewHeadings: [...document.querySelectorAll('#tab-combos .combo-section-title')].map(h => h.textContent),
    // No card selected yet, so there is nothing to add a block TO. An ADD
    // BLOCK toolbar here would attach blocks as siblings of the cards.
    addBlockOffered: !!document.getElementById('btn-toggle-add-menu'),
    hint: document.querySelector('#combo-card-body .admin-tool-hint')?.textContent,
  }));
  expect(afterGroup.groups[afterGroup.openIdx]).toBe('True Combos');
  expect(afterGroup.navLabel, 'the strip follows the title').toBe('True Combos');
  expect(afterGroup.previewHeadings).toContain('True Combos');
  expect(afterGroup.addBlockOffered, 'no block toolbar until a card is selected').toBe(false);
  expect(afterGroup.hint).toContain('Select a combo card');

  // The Combo List, whose rows open in a modal - the editor's left pane shares
  // the screen with the live preview, and a dozen fields there was mostly
  // scroll (owner, 2026-08-16).
  await page.locator('#combos-nav-list').click();
  await page.waitForTimeout(250);
  await page.locator('#combo-table-add').click();
  await page.waitForTimeout(250);
  await page.locator('#combo-table-name').fill('M1 Starters');
  await page.locator('#combo-row-add').click();
  await page.waitForTimeout(350);

  await expect(page.locator('#combo-row-modal'), 'adding a combo opens its editor')
    .not.toHaveClass(/\bhidden\b/);

  await page.locator('[data-combo-field="sequence"]').fill('M1\n\nMURMURATE\nR↑');
  await page.locator('[data-combo-field="damage"]').fill('38-46');
  await page.selectOption('#combo-row-modal select[data-combo-field="difficulty"]', 'Medium', { force: true });
  await page.waitForTimeout(400);

  const state = await page.evaluate(() => ({
    // The table THIS test opened. Boomcat is the owner's real page and may
    // already carry starters, so indexing from the front reads their content
    // and compares it against this test's input.
    table: (window.currentEditorDescData.comboList || [])[window.currentDocTableIndex],
    previewRows: document.querySelectorAll('#tab-combos .combo-list-table').length,
  }));

  expect(state.table.starter).toBe('M1 Starters');
  // Blank lines are dropped rather than becoming empty chips in the route.
  expect(state.table.rows[0].sequence).toEqual(['M1', 'MURMURATE', 'R↑']);
  expect(state.table.rows[0].damage).toBe('38-46');
  expect(state.table.rows[0].difficulty).toBe('Medium');
  // A stray `rows: []` here meant editor-tabs.js had overwritten
  // description.js's window.renderComboTableBody by declaring the same name.
  expect(Object.keys(state.table.rows[0])).not.toContain('rows');
  expect(state.previewRows, 'the live preview draws the table as it types').toBeGreaterThan(0);

  await page.locator('#combo-row-modal-done').click();
  await page.waitForTimeout(250);

  const closed = await page.evaluate(() => ({
    hidden: document.getElementById('combo-row-modal').classList.contains('hidden'),
    summary: document.querySelector('.combo-row-open')?.textContent,
  }));
  expect(closed.hidden).toBe(true);
  expect(closed.summary, 'a row is recognised by its route').toBe('M1 > MURMURATE > R↑');
  expect(errors).toEqual([]);
});
