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

test('the folder picker only appears once a block is expanded', async ({ page }) => {
  // Owner, 2026-08-25: "When I open a folder, I already know that those blocks
  // are in that folder. This setting/dropdown should only appear if I expand
  // the block." It is also the widest thing on the header, and it was squeezing
  // the summary down to two characters.
  await openWorkspace(page, [
    { type: 'paragraph', content: 'A paragraph long enough to need the room', align: 'left', folder: 'Neutral' },
  ]);

  // Open the folder so the card is on screen at all, but leave the BLOCK shut.
  await page.locator('.block-folder-toggle').first().click();
  await page.waitForTimeout(250);

  const collapsed = await page.evaluate(() => {
    const card = document.querySelector('#block-list .block-card');
    const pick = card.querySelector('.block-folder-picker');
    const sum = card.querySelector('.block-card-summary');
    return {
      cardCollapsed: card.classList.contains('collapsed'),
      pickerShown: !!pick && getComputedStyle(pick).display !== 'none',
      // A share of the card rather than a pixel count: the workspace pane is
      // not a fixed width and font metrics differ by OS, so a number here
      // would fail in CI for reasons unrelated to the claim.
      summaryShare: sum
        ? sum.getBoundingClientRect().width / card.getBoundingClientRect().width
        : 0,
    };
  });
  expect(collapsed.cardCollapsed, 'setup: the block itself is still shut').toBe(true);
  expect(collapsed.pickerShown, 'a collapsed block does not repeat which folder it is in').toBe(false);

  await page.locator('#block-list .block-card .btn-collapse').first().click();
  await page.waitForTimeout(250);

  const expanded = await page.evaluate(() => {
    const pick = document.querySelector('#block-list .block-card .block-folder-picker');
    return { pickerShown: !!pick && getComputedStyle(pick).display !== 'none' };
  });
  // It must come BACK, or the only way to refile a block is gone.
  expect(expanded.pickerShown, 'expanding the block returns the control').toBe(true);

  // And the space it freed goes to the label, which is the point - the picker
  // was the widest thing on the row and left the summary showing two
  // characters ("Bo", "Ho", "In" in the owner's screenshot).
  //
  // Measured as an A/B on the real row rather than against a threshold: any
  // fixed number here would be a guess about pane width and font metrics, and
  // tuning it until it passes would make it assert nothing. Forcing the picker
  // back on and re-measuring asks exactly the question the change was made to
  // answer.
  const roomBack = await page.evaluate(() => {
    const card = document.querySelector('#block-list .block-card');
    // Collapse it again so we are comparing like with like.
    card.querySelector('.btn-collapse').click();
    const sum = card.querySelector('.block-card-summary');
    const pick = card.querySelector('.block-folder-picker');
    const without = sum.getBoundingClientRect().width;
    pick.style.display = 'flex';
    const with_ = sum.getBoundingClientRect().width;
    pick.style.display = '';
    return { without: Math.round(without), with: Math.round(with_) };
  });

  expect(roomBack.without,
    `summary is ${roomBack.without}px without the picker vs ${roomBack.with}px with it`)
    .toBeGreaterThan(roomBack.with);
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

// --- A REGRESSION COLLAPSE-BY-DEFAULT CAUSED (owner, 2026-08-25) ---
//
// "This paragraph right here doesn't have a scrollbar in it to scroll through
// the content in it."
//
// renderBlockList sizes every textarea to its content. With everything now
// rendering collapsed, and `.block-body.minimized` being `display: none`,
// scrollHeight inside a hidden ancestor is 0 - so the pass pinned every field
// shut, and expanding a block showed a stub with the text unreachable.
//
// Fixing it also closed a gap that predates v0.16: the owner's 2026-08-17
// "grow to fit, then STOP and scroll" cap was only ever applied to the `input`
// handler, so a field arrived on screen uncapped and started behaving only once
// it was typed in. Both paths share one sizer now, which is what these two
// tests are really protecting.
const LONG_TEXT = Array.from({ length: 30 },
  (_, i) => `Line ${i + 1} of a very long paragraph that keeps going.`).join(' ');

test('a long field is usable the moment its block is expanded', async ({ page }) => {
  const errors = await openWorkspace(page, [
    { type: 'paragraph', content: LONG_TEXT, align: 'left' },
  ]);

  await page.locator('#block-list .block-card .btn-collapse').first().click();
  await page.waitForTimeout(400);

  const ta = await page.evaluate(() => {
    const el = document.querySelector('#block-list .block-card textarea.editor-textarea');
    return {
      height: Math.round(el.getBoundingClientRect().height),
      overflowY: getComputedStyle(el).overflowY,
      // The claim the owner made: the content can be reached.
      scrollable: el.scrollHeight > el.clientHeight + 1,
      scrolled: (() => { el.scrollTop = 9999; return el.scrollTop > 0; })(),
    };
  });

  expect(ta.height, 'the field is not pinned shut').toBeGreaterThan(60);
  expect(ta.height, 'and it stops growing at the cap rather than eating the pane')
    .toBeLessThanOrEqual(260);
  expect(ta.overflowY, 'a capped field scrolls').toBe('auto');
  expect(ta.scrollable, 'there is more content than fits, as expected').toBe(true);
  // Asserting overflowY alone would prove the rule, not the consequence: read
  // back that scrolling actually moves.
  expect(ta.scrolled, 'and it really scrolls').toBe(true);

  expect(errors).toEqual([]);
});

test('a short field is sized to its content, with no scrollbar', async ({ page }) => {
  // The other side of the cap. Without this, "make it 260px and scroll" would
  // pass the test above while giving every one-line field a 260px box.
  await openWorkspace(page, [
    { type: 'paragraph', content: 'One short line.', align: 'left' },
  ]);

  await page.locator('#block-list .block-card .btn-collapse').first().click();
  await page.waitForTimeout(400);

  const ta = await page.evaluate(() => {
    const el = document.querySelector('#block-list .block-card textarea.editor-textarea');
    return {
      height: Math.round(el.getBoundingClientRect().height),
      overflowY: getComputedStyle(el).overflowY,
    };
  });

  expect(ta.height, 'a one-line field does not get a 260px box').toBeLessThan(120);
  expect(ta.height, 'but it is still a usable field').toBeGreaterThan(15);
  expect(ta.overflowY, 'nothing to scroll, so no scrollbar').toBe('hidden');
});

test('an open field inside a folder survives the folder being shut and reopened', async ({ page }) => {
  // A real editing path with two collapse mechanisms interacting: open a block,
  // shut the FOLDER around it, redraw, open the folder again. The block was
  // never collapsed, so its expand handler never runs on the way back.
  //
  // WRITTEN TO JUSTIFY THE HIDDEN-FIELD GUARD, AND IT DOES NOT. Falsifying
  // showed this passes with the guard removed too: reopening a folder
  // re-renders, and by then the field is visible, so it gets measured properly
  // whatever the previous pass wrote. Kept because the path is worth covering
  // on its own - two collapse states over one field is exactly where this
  // breaks next - but the guard is documented in the code as defensive rather
  // than as the thing holding this up.
  await openWorkspace(page, [
    { type: 'paragraph', content: LONG_TEXT, align: 'left', folder: 'Neutral' },
  ]);

  await page.locator('.block-folder-toggle').first().click();      // open folder
  await page.waitForTimeout(250);
  await page.locator('#block-list .block-card .btn-collapse').first().click();  // open block
  await page.waitForTimeout(300);

  const before = await page.evaluate(() =>
    Math.round(document.querySelector('#block-list textarea.editor-textarea').getBoundingClientRect().height));
  expect(before, 'setup: the field is sized while everything is open').toBeGreaterThan(60);

  await page.locator('.block-folder-toggle').first().click();      // shut folder
  await page.waitForTimeout(200);
  await page.evaluate(() => window.renderBlockList());             // the hazard
  await page.waitForTimeout(200);
  await page.locator('.block-folder-toggle').first().click();      // reopen folder
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => {
    const el = document.querySelector('#block-list textarea.editor-textarea');
    return {
      height: Math.round(el.getBoundingClientRect().height),
      scrollable: el.scrollHeight > el.clientHeight + 1,
    };
  });

  expect(after.height, 'the field is still usable after the folder came back')
    .toBeGreaterThan(60);
  expect(after.scrollable, 'and its content is still reachable').toBe(true);
});
