// v0.16 fine-tuning 2 and 3: the editor workspace opens quiet.
//
// "When working in the Editor, everything in the workspace is collapsed by
// default (The Block Folders, and each Blocks)." And the folders get their own
// visual - a small folder icon with a small name and small side buttons, in a
// transparent wrapper rather than the grey box the Blocks use.
//
// Blocks are SEEDED through initStrategyBlockBuilder rather than read off a
// real character page. Three v0.15 tests read the owner's own Boomcat content
// and compared it against their own input; a workspace test that assumes what
// is in a section would do the same thing, and would break the first time the
// owner reorganised a page.
const { test, expect } = require('@playwright/test');

const EDITOR = '/edit.html?char=boomcat&type=character&tab=overview';

// Deliberately more blocks than fit on a screen, because the density is the
// feature: five open blocks are the wall this replaced.
const SEED = [
  { type: 'heading', content: 'Opening The Round', align: 'left', size: 'h3' },
  { type: 'paragraph', content: 'A long paragraph about neutral that would take a lot of vertical room if it were open.', align: 'left' },
  { type: 'list', items: ['Punish the whiff', 'Respect the armour'], align: 'left', author: '' },
  { type: 'paragraph', content: 'Another paragraph entirely.', align: 'left' },
  { type: 'heading', content: 'Closing The Round', align: 'left', size: 'h3' },
];

async function openWorkspace(page, blocks = SEED) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto(EDITOR, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  await page.evaluate((seed) => {
    window.initStrategyBlockBuilder('strategy-block-target', seed);
  }, blocks);
  await page.waitForTimeout(300);
  return errors;
}

const cardState = (page) => page.evaluate(() => {
  return Array.from(document.querySelectorAll('#block-list .block-card')).map(c => ({
    type: (c.querySelector('.block-type-selector') || {}).value || null,
    collapsed: c.classList.contains('collapsed'),
    bodyMinimized: !!c.querySelector('.block-body.minimized'),
    summary: (c.querySelector('.block-card-summary') || {}).textContent || '',
    summaryVisible: !!c.querySelector('.block-card-summary')
      && getComputedStyle(c.querySelector('.block-card-summary')).display !== 'none',
  }));
});

// --- COLLAPSED BY DEFAULT ---

test('every block starts collapsed', async ({ page }) => {
  const errors = await openWorkspace(page);

  const cards = await cardState(page);
  expect(cards).toHaveLength(SEED.length);
  cards.forEach((c, i) => {
    expect(c.collapsed, `block ${i} (${c.type}) should start collapsed`).toBe(true);
    // The card class alone would prove the marker, not the consequence. The
    // BODY is what takes the room.
    expect(c.bodyMinimized, `block ${i} body should be minimized`).toBe(true);
  });

  expect(errors).toEqual([]);
});

test('the collapsed list is dramatically shorter than the open one', async ({ page }) => {
  // The point of the feature, stated as a measurement rather than an adjective.
  await openWorkspace(page);

  const collapsedHeight = await page.evaluate(() =>
    document.getElementById('block-list').scrollHeight);

  await page.evaluate(() => {
    document.querySelectorAll('#block-list .block-card .btn-collapse')
      .forEach(b => b.click());
  });
  await page.waitForTimeout(300);

  const openHeight = await page.evaluate(() =>
    document.getElementById('block-list').scrollHeight);

  expect(openHeight, 'sanity: opening everything makes it taller')
    .toBeGreaterThan(collapsedHeight);
  expect(collapsedHeight * 2, `collapsed ${collapsedHeight}px vs open ${openHeight}px`)
    .toBeLessThan(openHeight);
});

// --- THE LABEL THAT MAKES IT USABLE ---

test('a collapsed block says what it holds, not just what type it is', async ({ page }) => {
  // Without this the feature is a downgrade: a list reading HEADING /
  // PARAGRAPH / LIST / PARAGRAPH / HEADING identifies nothing, so the author
  // opens every block to find one.
  await openWorkspace(page);

  const cards = await cardState(page);

  expect(cards[0].summary).toContain('Opening The Round');
  expect(cards[1].summary).toContain('A long paragraph about neutral');
  expect(cards[2].summary, 'a list is summarised by its first item').toContain('Punish the whiff');
  expect(cards[4].summary).toContain('Closing The Round');

  cards.forEach((c, i) => {
    expect(c.summaryVisible, `block ${i} label should be visible while collapsed`).toBe(true);
  });

  // And two blocks of the same type must be distinguishable, which is the
  // whole claim - the type alone never was.
  expect(cards[0].summary).not.toBe(cards[4].summary);
});

test('the label goes away once the block is open', async ({ page }) => {
  await openWorkspace(page);

  await page.locator('#block-list .block-card .btn-collapse').first().click();
  await page.waitForTimeout(200);

  const cards = await cardState(page);
  expect(cards[0].collapsed).toBe(false);
  expect(cards[0].summaryVisible, 'the block itself is on screen now, so the label is noise')
    .toBe(false);
});

test('a label made of shortcodes is stripped, not rendered raw', async ({ page }) => {
  await openWorkspace(page, [
    { type: 'heading', content: '[b]Bold Heading[/b] and [color=#ff0000]red[/color]', align: 'left', size: 'h3' },
  ]);

  const cards = await cardState(page);
  expect(cards[0].summary, 'markup is stripped from a one-line label')
    .toBe('Bold Heading and red');
});

// --- THE STATE SURVIVES A RE-RENDER ---

test('expanding a block survives a redraw of the list', async ({ page }) => {
  // Collapse used to be pure DOM with no store behind it, so any renderBlockList
  // silently reopened everything. That was survivable when the default was
  // open; with the default closed it would throw away the one block the author
  // is working in, every time they touched anything.
  await openWorkspace(page);

  await page.locator('#block-list .block-card .btn-collapse').first().click();
  await page.waitForTimeout(200);
  expect((await cardState(page))[0].collapsed).toBe(false);

  // Drive a real control that redraws the whole list.
  await page.evaluate(() => window.renderBlockList());
  await page.waitForTimeout(200);

  const after = await cardState(page);
  expect(after[0].collapsed, 'the block the author opened is still open').toBe(false);
  expect(after[1].collapsed, 'and the others are still shut').toBe(true);
});

test('collapse follows the block when it moves, not the position', async ({ page }) => {
  // State is keyed by the block OBJECT rather than its index, so reordering
  // cannot hand one block another one's state.
  await openWorkspace(page);

  await page.locator('#block-list .block-card .btn-collapse').first().click();
  await page.waitForTimeout(200);

  // Move the opened block down one.
  await page.locator('#block-list .block-card .btn-down').first().click();
  await page.waitForTimeout(300);

  const after = await cardState(page);
  expect(after[1].summary, 'the opened block really did move to index 1')
    .toContain('Opening The Round');
  expect(after[1].collapsed, 'and it is still open').toBe(false);
  expect(after[0].collapsed, 'while the one that took its place is not').toBe(true);
});

test('a newly added block opens, because that is why it was added', async ({ page }) => {
  await openWorkspace(page);

  await page.locator('#block-list .block-card .btn-insert-below').first().click();
  await page.waitForTimeout(300);

  const after = await cardState(page);
  expect(after).toHaveLength(SEED.length + 1);
  expect(after[1].collapsed, 'the block just inserted is open').toBe(false);
  expect(after[0].collapsed, 'and it did not open anything else').toBe(true);
});

// --- FOLDERS ---

test('folders start collapsed too', async ({ page }) => {
  await openWorkspace(page, [
    { type: 'paragraph', content: 'Inside a folder', align: 'left', folder: 'Neutral' },
    { type: 'paragraph', content: 'Also inside', align: 'left', folder: 'Neutral' },
  ]);

  const state = await page.evaluate(() => {
    const f = document.querySelector('#block-list .block-folder');
    return f ? {
      collapsed: f.classList.contains('is-collapsed'),
      bodyShown: getComputedStyle(f.querySelector('.block-folder-body')).display !== 'none',
      name: (f.querySelector('.block-folder-name-input') || {}).value,
    } : null;
  });

  expect(state, 'the folder rendered at all').not.toBeNull();
  expect(state.name).toBe('Neutral');
  expect(state.collapsed, 'a folder starts closed').toBe(true);
  expect(state.bodyShown, 'and its blocks are genuinely off screen').toBe(false);
});

test('renaming an open folder leaves it open', async ({ page }) => {
  // The carry-over was written when the default was EXPANDED, so it only moved
  // state in the branch that is now the default. Left alone, renaming a folder
  // the author had opened would have quietly shut it.
  await openWorkspace(page, [
    { type: 'paragraph', content: 'Inside a folder', align: 'left', folder: 'Neutral' },
  ]);

  await page.locator('.block-folder-toggle').first().click();
  await page.waitForTimeout(200);
  expect(await page.evaluate(() =>
    !document.querySelector('.block-folder').classList.contains('is-collapsed')), 'setup: open').toBe(true);

  const name = page.locator('.block-folder-name-input').first();
  await name.fill('Neutral Game');
  await name.blur();
  await page.waitForTimeout(400);

  const after = await page.evaluate(() => {
    const f = document.querySelector('.block-folder');
    return {
      name: f.querySelector('.block-folder-name-input').value,
      collapsed: f.classList.contains('is-collapsed'),
    };
  });
  expect(after.name).toBe('Neutral Game');
  expect(after.collapsed, 'renaming must not shut a folder the author opened').toBe(false);
});

// --- THE FOLDER'S OWN LOOK (fine-tuning 3) ---

test('a folder does not look like a block', async ({ page }) => {
  await openWorkspace(page, [
    { type: 'paragraph', content: 'Inside a folder', align: 'left', folder: 'Neutral' },
  ]);

  const seen = await page.evaluate(() => {
    const folder = document.querySelector('.block-folder');
    const head = folder.querySelector('.block-folder-head');
    const card = document.querySelector('.block-card');
    return {
      folderBg: getComputedStyle(folder).backgroundColor,
      headBg: getComputedStyle(head).backgroundColor,
      headHeight: head.getBoundingClientRect().height,
      cardHeight: card ? card.getBoundingClientRect().height : null,
      toggleGlyph: folder.querySelector('.block-folder-toggle').textContent.trim(),
      // The side buttons are glyphs now, so no word survives in them.
      addLabel: folder.querySelector('.block-folder-add').textContent.trim(),
    };
  });

  // Transparent, not a grey box. rgba(0,0,0,0) is what a transparent
  // background computes to.
  expect(seen.folderBg, 'the folder wrapper is transparent').toBe('rgba(0, 0, 0, 0)');
  expect(seen.headBg, 'and so is its header').toBe('rgba(0, 0, 0, 0)');

  // A folder icon, not a disclosure triangle.
  expect(['\u{1F4C1}', '\u{1F4C2}']).toContain(seen.toggleGlyph);

  // Small side buttons: a glyph, not "＋ FOLDER".
  expect(seen.addLabel.toUpperCase(), 'the add button is a glyph, not a word')
    .not.toContain('FOLDER');
  expect(seen.addLabel.length).toBeLessThanOrEqual(2);

  expect(seen.headHeight, 'the header is short').toBeLessThan(34);
});

test('a new folder opens so it can be named and filled', async ({ page }) => {
  await openWorkspace(page, [
    { type: 'paragraph', content: 'Inside a folder', align: 'left', folder: 'Neutral' },
  ]);

  await page.locator('.block-folder-add').first().click();
  await page.waitForTimeout(400);

  const folders = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.block-folder')).map(f => ({
      name: (f.querySelector('.block-folder-name-input') || {}).value,
      collapsed: f.classList.contains('is-collapsed'),
    })));

  expect(folders.length, 'a second folder appeared').toBeGreaterThan(1);
  const fresh = folders.find(f => f.name !== 'Neutral');
  expect(fresh, 'the new folder is on screen').toBeTruthy();
  expect(fresh.collapsed, 'and it is open, or it could not be named or filled').toBe(false);
});
