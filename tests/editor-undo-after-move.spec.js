// UNDO after a drag, a folder change or +Row (found 2026-10-20, there since
// 2026-07-21).
//
// History holds STATES, and UNDO steps to the one before the latest. Every
// change records the state it starts from (saveBlockHistory) and then the one
// it ends in (updateLivePreview). These actions skipped the second half,
// "updateLivePreview(true) // Tell it to skip saving history again", so the
// state they made was never recorded: UNDO straight after one was disabled,
// or stepped back past it and took the edit before it away too.
//
// Each test makes one edit first (an alignment), then the action, and checks
// that a single UNDO lands exactly between the two, and REDO brings the
// action back.
const { test, expect } = require('@playwright/test');

const EDITOR = '/edit.html?char=testchar&tab=overview';

async function build(page, blocks) {
  await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.collectBlockFolders === 'function', { timeout: 15000 });
  await page.evaluate((b) => {
    document.body.innerHTML = '<div id="block-host" style="padding: 0 1.5rem"></div>';
    window.initStrategyBlockBuilder('block-host', b);
    document.querySelectorAll('#block-list .block-folder').forEach(f => window.setBlockFolderCollapsed(f.getAttribute('data-folder'), false));
    (window.getActiveBlocks() || []).forEach(blk => window.setEditorBlockExpanded(blk, true));
    window.renderBlockList();
  }, blocks);
  await expect(page.locator('#block-list .block-card')).toHaveCount(blocks.length);
}

const P = (content, folder) => (folder ? { type: 'paragraph', content, folder } : { type: 'paragraph', content });
const snapshot = page => page.evaluate(() => JSON.stringify(window.getActiveBlocks()));

// Real mouse: startBlockPointerDrag calls setPointerCapture, which throws on
// synthetic events.
async function drag(page, from, to, half = 'middle') {
  await expect(from).toBeVisible();
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  const y = half === 'bottom' ? b.y + b.height * 0.8 : b.y + b.height / 2;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 20);
  await page.mouse.move(b.x + b.width / 2, y, { steps: 6 });
  await page.mouse.up();
}

// The edit before the action, then the action, then UNDO and REDO.
async function undoesExactlyThis(page, action) {
  await page.locator('#block-list .block-card[data-index="0"] .align-btn[data-val="right"]').click();
  const between = await snapshot(page);

  await action();
  const after = await snapshot(page);
  expect(after, 'the action changed something').not.toBe(between);

  await expect(page.locator('#btn-undo')).toBeEnabled();
  await page.locator('#btn-undo').click();
  expect(await snapshot(page), 'one UNDO takes back the action and nothing before it').toBe(between);

  await page.locator('#btn-redo').click();
  expect(await snapshot(page), 'and REDO brings it back').toBe(after);
}

const card = (page, i) => page.locator(`#block-list .block-card[data-index="${i}"]`);

test('a block dragged to a new place', async ({ page }) => {
  await build(page, [P('a'), P('b'), P('c')]);
  await undoesExactlyThis(page, () => drag(page, card(page, 0).locator('.drag-handle'), card(page, 2), 'bottom'));
});

test('a block dropped on a folder header', async ({ page }) => {
  await build(page, [P('a'), P('b', 'S'), P('c')]);
  await undoesExactlyThis(page, () => drag(page, card(page, 2).locator('.drag-handle'), page.locator('#block-list .block-folder-head')));
});

test('a block dropped into an accordion', async ({ page }) => {
  await build(page, [P('a'), { type: 'accordion', title: 'Tech', content: [] }, P('c')]);
  await undoesExactlyThis(page, () => drag(page, card(page, 2).locator('.drag-handle'), page.locator('#block-list .accordion-inner-block-wrapper')));
});

test('a new block dragged in from the Add Block menu', async ({ page }) => {
  await build(page, [P('a'), P('b')]);
  await undoesExactlyThis(page, async () => {
    await page.locator('#btn-toggle-add-menu').click();
    await drag(page, page.locator('#add-block-popup .add-block-btn[data-type="heading"]'), card(page, 1));
  });
});

test("a block filed into a folder from its folder dropdown", async ({ page }) => {
  await build(page, [P('a'), P('b', 'S'), P('c')]);
  await undoesExactlyThis(page, async () => {
    await card(page, 2).locator('.block-folder-trigger').click();
    await card(page, 2).locator('.folder-option-item').click();
  });
});

test('a folder ungrouped', async ({ page }) => {
  await build(page, [P('a'), P('b', 'S'), P('c', 'S')]);
  await undoesExactlyThis(page, () => page.locator('#block-list .block-folder-ungroup').click());
});

test('a folder renamed', async ({ page }) => {
  await build(page, [P('a'), P('b', 'S')]);
  await undoesExactlyThis(page, async () => {
    await page.locator('#block-list .block-folder-name-input').fill('Setups');
    await page.locator('#block-list .block-folder-name-input').press('Enter');
    await expect(page.locator('#block-list .block-folder')).toHaveAttribute('data-folder', 'Setups');
  });
});

test('a row added to a table', async ({ page }) => {
  await build(page, [P('a'), { type: 'table', headers: ['x'], rows: [['1']] }]);
  await undoesExactlyThis(page, () => card(page, 1).locator('.btn-table-add-row').click());
});
