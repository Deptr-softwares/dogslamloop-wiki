// Find and Replace in the editor - v0.15 item 7.
//
// Renaming a character meant opening every tab and hunting through dozens of
// blocks by eye, and a combo table alone can carry 127 rows.
//
// The engine walks desc_data generically rather than enumerating block types,
// so a block type added later is searched without anybody coming back to it.
// What it must NOT touch is the interesting half, and most of these tests are
// about that.
const { test, expect } = require('@playwright/test');

const EDITOR = '/edit.html?char=boomcat&type=character&tab=overview';

// Every shape the walker has to cope with, in one fixture: nested blocks, a
// string-or-array content field, arrays of strings, arrays of arrays, keyed
// entries, combo rows, and a character state.
const DATA = () => ({
  overview: [
    { type: 'heading', content: 'Ryu opener', size: 'h3' },
    { type: 'paragraph', content: 'Ryu is strong. Beat Ryu with spacing.' },
    { type: 'list', items: ['Punish Ryu early', 'Never jump'] },
    { type: 'image', src: 'https://cdn.example.com/Ryu.png', alt: 'Ryu portrait', caption: 'Ryu' },
    { type: 'table', headers: ['Move', 'Note'], rows: [['Ryu Kick', 'safe'], ['Jab', 'Ryu punish']] },
    { type: 'accordion', title: 'Ryu tech', content: [{ type: 'paragraph', content: 'Nested Ryu text' }] },
    { type: 'combo', sequence: ['M1', 'Ryu Special'], damage: '40', note: 'Ryu only' },
    { type: 'author', author: 'Ryu' },
  ],
  matchups: [{ opponent: 'Ryu', tier: 'even', content: [{ type: 'paragraph', content: 'Ryu matchup notes' }] }],
  comboList: [{ starter: 'M1 Starters', rows: [
    { combo: 'M1 M1 Ryu Special', damage: '30', difficulty: 'Ryu', video: 'https://x.test/Ryu' },
  ] }],
  modeData: {
    ultimate: { overview: [{ type: 'paragraph', content: 'Ultimate Ryu is different' }] },
  },
});

async function boot(page) {
  await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.findEditorMatches === 'function', { timeout: 15000 });
}

test('it finds every occurrence, including nested and state content', async ({ page }) => {
  await boot(page);

  const out = await page.evaluate((data) => {
    const matches = window.findEditorMatches(data, 'Ryu', { wholeWord: false });
    return {
      count: matches.length,
      paths: matches.map(m => m.path.join('.')),
      wheres: [...new Set(matches.map(m => m.where))],
    };
  }, DATA());

  const p = out.paths.join('|');
  expect(p, 'a heading').toContain('overview.0.content');
  expect(p, 'both occurrences in one paragraph').toContain('overview.1.content');
  expect(out.paths.filter(x => x === 'overview.1.content').length).toBe(2);
  expect(p, 'a list item').toContain('overview.2.items.0');
  expect(p, 'a table cell').toContain('overview.4.rows.0.0');
  expect(p, 'a block nested inside an accordion').toContain('overview.5.content.0.content');
  expect(p, 'a combo route step').toContain('overview.6.sequence.1');
  expect(p, 'a keyed entry name').toContain('matchups.0.opponent');
  expect(p, 'a combo row field').toContain('comboList.0.rows.0.combo');
  // The other character state is part of the page, and missing it is the axis
  // three separate bugs have already been lost along in this project.
  expect(p, 'the ultimate state').toContain('modeData.ultimate.overview.0.content');
});

test('it refuses to touch links, credit and enums', async ({ page }) => {
  await boot(page);

  const paths = await page.evaluate((data) =>
    window.findEditorMatches(data, 'Ryu', { wholeWord: false }).map(m => m.path.join('.')), DATA());

  const joined = paths.join('|');
  // A rename that rewrites a URL breaks the media rather than renaming anything.
  expect(joined, 'an image src').not.toContain('overview.3.src');
  expect(joined, 'a combo row video link').not.toContain('comboList.0.rows.0.video');
  // Credit is whose work it is, not what it says.
  expect(joined, 'an author credit').not.toContain('overview.7.author');
  // A typo'd difficulty sorts the row to the bottom silently.
  expect(joined, 'the difficulty enum').not.toContain('comboList.0.rows.0.difficulty');
});

test('a match says where it is, in words', async ({ page }) => {
  await boot(page);

  const wheres = await page.evaluate((data) => {
    const m = window.findEditorMatches(data, 'Ryu', { wholeWord: false });
    return {
      matchup: m.find(x => x.path.join('.') === 'matchups.0.opponent')?.where,
      nested: m.find(x => x.path.join('.') === 'overview.5.content.0.content')?.where,
      state: m.find(x => x.path.join('.').startsWith('modeData'))?.where,
    };
  }, DATA());

  // The entry's own name, not its index.
  expect(wheres.matchup).toContain('Ryu');
  expect(wheres.matchup).not.toMatch(/\b0\b/);
  expect(wheres.nested, 'a nested block should name its accordion').toContain('Ryu tech');
  expect(wheres.state, 'a match in another kit must say so').toContain('ULTIMATE');
});

test('whole-word matching does not split a longer name', async ({ page }) => {
  await boot(page);

  const out = await page.evaluate(() => {
    const data = { overview: [{ type: 'paragraph', content: 'Ryu and Ryuji and Ryu-Kick' }] };
    return {
      loose: window.findEditorMatches(data, 'Ryu', { wholeWord: false }).length,
      strict: window.findEditorMatches(data, 'Ryu', { wholeWord: true }).length,
    };
  });

  expect(out.loose).toBe(3);
  // "Ryuji" is a different name and "Ryu-Kick" is a different move.
  expect(out.strict).toBe(1);
});

test('replacing one occurrence leaves the others alone', async ({ page }) => {
  await boot(page);

  const out = await page.evaluate(() => {
    const data = { overview: [{ type: 'paragraph', content: 'Ryu beats Ryu with Ryu' }] };
    const matches = window.findEditorMatches(data, 'Ryu', { wholeWord: true });
    // The SECOND one - replacing by index rather than by re-running the
    // pattern is what stops this landing on the first.
    window.replaceOneMatch(data, matches[1], 'True Cannon');
    return data.overview[0].content;
  });

  expect(out).toBe('Ryu beats True Cannon with Ryu');
});

test('replace all does not re-scan its own output', async ({ page }) => {
  await boot(page);

  const out = await page.evaluate(() => {
    // The replacement CONTAINS the search term. Writing during the walk would
    // let the new text be found and replaced again.
    const data = { overview: [{ type: 'paragraph', content: 'Ryu and Ryu' }] };
    const count = window.replaceAllMatches(data, 'Ryu', 'Super Ryu', { wholeWord: true });
    return { text: data.overview[0].content, count };
  });

  expect(out.text).toBe('Super Ryu and Super Ryu');
  expect(out.count).toBe(2);
});

test('the panel lists matches and replaces one from the list', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await boot(page);
  await page.waitForTimeout(1200);

  // Injected into MATCHUPS rather than overview, and that is not arbitrary.
  // openFindReplace flushes the open block buffer into desc_data first, so a
  // fixture placed in the tab currently being edited is overwritten by the
  // editor's own (empty) buffer before the search runs. That flush is the
  // feature working - without it the text being typed right now would not be
  // searchable, and a replacement would be undone by the next re-render - so
  // the test works with it instead of against it.
  await page.evaluate((data) => {
    window.editorMasterDescData.matchups = data.matchups;
    window.editorMasterDescData.modeData = data.modeData;
    window.currentEditorDescData.matchups = data.matchups;
  }, DATA());

  await page.locator('#btn-find-replace').click();
  await expect(page.locator('#find-replace-modal')).toBeVisible();

  await page.locator('#find-input').fill('Ryu');
  await page.locator('#replace-input').fill('True Cannon');
  await page.locator('.find-replace-row').first().waitFor({ timeout: 5000 });

  const rows = await page.locator('.find-replace-row').count();
  expect(rows, 'the opponent name and its write-up, at least').toBeGreaterThan(1);
  await expect(page.locator('#find-replace-count')).toContainText('match');

  const before = await page.evaluate(() => window.editorMasterDescData.matchups[0].opponent);
  await page.locator('.find-replace-one').first().click();
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => window.editorMasterDescData.matchups[0].opponent);

  expect(before).toBe('Ryu');
  expect(after, 'the first match should have been replaced').toBe('True Cannon');
  expect(errors).toEqual([]);
});

test('the panel searches the whole page, not the open tab', async ({ page }) => {
  await boot(page);
  await page.waitForTimeout(1200);

  const wheres = await page.evaluate((data) => {
    // currentEditorDescData points at the ACTIVE STATE's slice, so a panel
    // reading it would silently miss the other kit. The master is the whole page.
    window.editorMasterDescData.matchups = data.matchups;
    window.editorMasterDescData.modeData = data.modeData;
    return window.findEditorMatches(window.editorMasterDescData, 'Ryu', { wholeWord: false })
      .map(m => m.where);
  }, DATA());

  expect(wheres.some(w => /ULTIMATE/.test(w)), 'the other state must be searched').toBe(true);
  expect(wheres.some(w => /Matchup/i.test(w)), 'a tab other than the open one').toBe(true);
});

// --- UNDOING A REPLACE ---
//
// The editor already HAS an undo (btn-undo, Ctrl+Z), and it does not cover
// this. Its history is the block buffer of the section currently open, and a
// replace writes across every tab and both character states. Confirmed by
// driving it: after a replace the button is disabled and Ctrl+Z does nothing.

test("the editor's own undo cannot reach a replace, and does not half-undo it", async ({ page }) => {
  await boot(page);
  await page.waitForTimeout(1200);

  await page.evaluate((data) => {
    window.editorMasterDescData.matchups = data.matchups;
    window.currentEditorDescData.matchups = window.editorMasterDescData.matchups;
  }, DATA());

  await page.locator('#btn-find-replace').click();
  await page.locator('#find-input').fill('Ryu');
  await page.locator('#replace-input').fill('True Cannon');
  await page.locator('.find-replace-row').first().waitFor({ timeout: 5000 });
  await page.locator('.find-replace-one').first().click();
  await page.waitForTimeout(800);

  await page.locator('#find-replace-close').click();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);

  const after = await page.evaluate(() => ({
    opponent: window.editorMasterDescData.matchups[0].opponent,
    blockUndoDisabled: document.getElementById('btn-undo')?.disabled,
  }));

  // Failing SAFELY is the point: partially reverting the open section while the
  // rest of the page stayed renamed would be worse than doing nothing.
  expect(after.opponent).toBe('True Cannon');
  expect(after.blockUndoDisabled, "the block undo has no pre-replace state to offer").toBe(true);
});

test('the panel can undo its own replace', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await boot(page);
  await page.waitForTimeout(1200);

  await page.evaluate((data) => {
    window.editorMasterDescData.matchups = data.matchups;
    window.editorMasterDescData.modeData = data.modeData;
    window.currentEditorDescData.matchups = window.editorMasterDescData.matchups;
  }, DATA());

  await page.locator('#btn-find-replace').click();
  await expect(page.locator('#find-replace-undo')).toBeDisabled();

  await page.locator('#find-input').fill('Ryu');
  await page.locator('#replace-input').fill('True Cannon');
  await page.locator('.find-replace-row').first().waitFor({ timeout: 5000 });
  await page.locator('#find-replace-all').click();

  // Replace All confirms first. Waited for rather than probed with isVisible():
  // that returns as soon as the node exists, which can be before it is
  // actionable, and the click then times out against a button the test has
  // already decided is there.
  const confirmBtn = page.locator('#editor-modal-confirm');
  await expect(confirmBtn).toBeVisible();
  await confirmBtn.click();

  // Then it reports the count, and that alert sits over the panel until it is
  // acknowledged - which is the point of an alert, so the test dismisses it
  // rather than the alert being made dismissable on its own.
  const ack = page.locator('#editor-alert-modal button');
  await expect(ack).toBeVisible();
  await ack.click();
  await page.waitForTimeout(700);

  const replaced = await page.evaluate(() => ({
    opponent: window.editorMasterDescData.matchups[0].opponent,
    state: window.editorMasterDescData.modeData.ultimate.overview[0].content,
  }));
  expect(replaced.opponent).toBe('True Cannon');
  expect(replaced.state, 'the other kit was renamed too').toContain('True Cannon');

  await expect(page.locator('#find-replace-undo')).toBeEnabled();
  await page.locator('#find-replace-undo').click();
  await page.waitForTimeout(900);

  const restored = await page.evaluate(() => ({
    opponent: window.editorMasterDescData.matchups[0].opponent,
    state: window.editorMasterDescData.modeData.ultimate.overview[0].content,
    // The editor must still be pointing at data that is actually written to.
    sameObject: window.currentEditorDescData.matchups === window.editorMasterDescData.matchups,
  }));

  expect(restored.opponent, 'undo should restore every tab').toBe('Ryu');
  expect(restored.state, 'including the other character state').toContain('Ryu');
  // Restored IN PLACE - reassigning the master would leave currentEditorDescData
  // pointing at an orphan that nothing writes to any more.
  expect(restored.sameObject).toBe(true);

  await expect(page.locator('#find-replace-undo')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('reopening the panel drops a stale undo', async ({ page }) => {
  await boot(page);
  await page.waitForTimeout(1200);

  await page.evaluate((data) => {
    window.editorMasterDescData.matchups = data.matchups;
    window.currentEditorDescData.matchups = window.editorMasterDescData.matchups;
  }, DATA());

  await page.locator('#btn-find-replace').click();
  await page.locator('#find-input').fill('Ryu');
  await page.locator('#replace-input').fill('True Cannon');
  await page.locator('.find-replace-row').first().waitFor({ timeout: 5000 });
  await page.locator('.find-replace-one').first().click();
  await page.waitForTimeout(700);
  await expect(page.locator('#find-replace-undo')).toBeEnabled();

  await page.locator('#find-replace-close').click();
  await page.locator('#btn-find-replace').click();

  // Offering it again would roll back whatever was done in between, which is
  // not what the button appears to promise.
  await expect(page.locator('#find-replace-undo')).toBeDisabled();
});

// --- MODAL LAYERING ---
//
// A confirmation is a RESPONSE to something another modal asked, so it can
// never be the one underneath. Every overlay sat at z-index 10000 and
// #editor-custom-modal is declared first in edit.html, so DOM order decided and
// every modal declared after it covered it. Found by the Replace All test
// timing out on a button Playwright could see and could not click.

test('a confirmation opened from a modal is clickable', async ({ page }) => {
  await boot(page);
  await page.waitForTimeout(1200);

  await page.evaluate((data) => {
    window.editorMasterDescData.matchups = data.matchups;
    window.currentEditorDescData.matchups = window.editorMasterDescData.matchups;
  }, DATA());

  await page.locator('#btn-find-replace').click();
  await page.locator('#find-input').fill('Ryu');
  await page.locator('.find-replace-row').first().waitFor({ timeout: 5000 });
  await page.locator('#find-replace-all').click();

  const confirm = page.locator('#editor-modal-confirm');
  await expect(confirm).toBeVisible();

  // Visible is not the assertion - it was visible while it was broken. What
  // matters is that it is the top layer at its own centre point, which is what
  // decides whether a click reaches it.
  const onTop = await page.evaluate(() => {
    const btn = document.getElementById('editor-modal-confirm');
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return btn.contains(hit) || hit === btn;
  });
  expect(onTop, 'the confirmation is covered by the panel that opened it').toBe(true);

  await confirm.click({ timeout: 5000 });
});

test('the combo row modal can confirm a delete', async ({ page }) => {
  // The same layering bug, on a screen that shipped in item 3: DELETE COMBO
  // opened a confirmation the author could see and could not click.
  await page.goto('/edit.html?char=boomcat&type=character&tab=combos', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.openComboRowModal === 'function', { timeout: 15000 });
  await page.waitForTimeout(1500);

  const opened = await page.evaluate(() => {
    const section = window.getKeyedSectionByField('comboList');
    window.currentEditorDescData[section.field] = [
      { starter: 'Test Starter', rows: [{ combo: 'M1 M1 Test', damage: '10' }] },
    ];
    window.openComboRowModal(0, 0);
    return !document.getElementById('combo-row-modal').classList.contains('hidden');
  });
  expect(opened).toBe(true);

  await page.locator('#combo-row-modal-delete').click();

  const onTop = await page.evaluate(() => {
    const btn = document.getElementById('editor-modal-confirm');
    if (!btn) return false;
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return btn.contains(hit) || hit === btn;
  });
  expect(onTop, 'the delete confirmation is covered by the combo row modal').toBe(true);
});
