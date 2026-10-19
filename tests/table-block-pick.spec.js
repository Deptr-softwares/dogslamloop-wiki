// The Table Block's picked cell (v1.1, from an editor's feedback, 2026-10-19):
// "targetting specific rows/columns, so those specific rows/columns can be
// deleted" and "inserting rows moves the page upwards, not downwards (this is
// to let the users click as much as they need to instead of moving the mouse
// everytime)". Scoped with the owner 2026-10-20: clicking a cell picks its row
// and column; -Row and -Col delete those and say which; +Row and +Col insert
// below and right of it; nothing picked = the end, as before; all four
// buttons stay under the mouse.
//
// Driven through the real controls in the real editor, and read back from the
// table's data, the painted cells and the buttons' own words.
const { test, expect } = require('@playwright/test');

const EDITOR = '/edit.html?char=boomcat&type=character&tab=overview';

const TABLE = {
  type: 'table',
  headers: ['Move', 'Startup', 'Active'],
  rows: [['M1', '4', '2'], ['Dash', '6', '3'], ['Ult', '10', '4']],
};
const para = n => ({ type: 'paragraph', content: `Filler ${n}`, align: 'left' });

async function openTable(page, blocks = [para(1), TABLE]) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto(EDITOR, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof window.initStrategyBlockBuilder === 'function' && !!document.getElementById('strategy-block-target'));
  await page.evaluate(seed => window.initStrategyBlockBuilder('strategy-block-target', seed), JSON.parse(JSON.stringify(blocks)));
  const card = page.locator('#block-list .block-card').filter({ has: page.locator('.block-table') });
  await expect(card).toHaveCount(1);
  return { card, errors };
}

// The table as data, plus what the editor shows of the pick.
const state = card => card.evaluate(c => {
  const blocks = window.getActiveBlocks();
  const table = blocks[parseInt(c.getAttribute('data-index'), 10)];
  const picked = [...c.querySelectorAll('.block-table td')].filter(td => td.classList.contains('table-picked')).map(td => {
    const i = td.querySelector('input');
    return i.classList.contains('table-header-input') ? `h${i.dataset.col}` : `${i.dataset.row},${i.dataset.col}`;
  });
  return {
    headers: table.headers.slice(),
    rows: table.rows.map(r => r.slice()),
    picked,
    delRow: c.querySelector('.btn-table-del-row').textContent.trim(),
    delCol: c.querySelector('.btn-table-del-col').textContent.trim(),
  };
});

const cell = (card, row, col) => card.locator(`.table-cell-input[data-row="${row}"][data-col="${col}"]`);

async function confirmSaying(page, words) {
  const modal = page.locator('#editor-custom-modal');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText(words);
  await page.locator('#editor-modal-confirm').click();
  await expect(modal).toBeHidden();
}

test('clicking a cell picks its row and column, tints them, and the delete buttons say which', async ({ page }) => {
  const { card, errors } = await openTable(page);
  await cell(card, 1, 1).click();

  const s = await state(card);
  expect(s.picked.sort()).toEqual(['0,1', '1,0', '1,1', '1,2', '2,1', 'h1'].sort());
  expect(s.delRow).toBe('⊟ -Row 2');
  expect(s.delCol).toBe('⊟ -Col 2');

  // Painted, not just classed: a picked cell's colour differs from one that is not.
  const paint = await card.evaluate(c => ({
    picked: getComputedStyle(c.querySelector('.table-cell-input[data-row="0"][data-col="1"]').parentElement).backgroundColor,
    plain: getComputedStyle(c.querySelector('.table-cell-input[data-row="0"][data-col="0"]').parentElement).backgroundColor,
  }));
  expect(paint.picked).not.toBe(paint.plain);

  // Picking does not redraw the table: the caret is still in the cell clicked.
  expect(await cell(card, 1, 1).evaluate(i => document.activeElement === i)).toBe(true);
  expect(errors).toEqual([]);
});

test('-Row and -Col delete the picked row and column, and the pick stays where it was', async ({ page }) => {
  const { card, errors } = await openTable(page);
  await cell(card, 1, 1).click();

  await card.locator('.btn-table-del-row').click();
  await confirmSaying(page, 'row 2');
  let s = await state(card);
  expect(s.rows).toEqual([['M1', '4', '2'], ['Ult', '10', '4']]);
  expect(s.delRow, 'the pick is on what is now row 2').toBe('⊟ -Row 2');

  await card.locator('.btn-table-del-col').click();
  await confirmSaying(page, 'column 2');
  s = await state(card);
  expect(s.headers).toEqual(['Move', 'Active']);
  expect(s.rows).toEqual([['M1', '2'], ['Ult', '4']]);
  expect(errors).toEqual([]);
});

test('+Row and +Col insert below and right of the picked cell, and the pick moves onto the new one', async ({ page }) => {
  const { card } = await openTable(page);
  await cell(card, 0, 0).click();

  await card.locator('.btn-table-add-row').click();
  let s = await state(card);
  expect(s.rows).toEqual([['M1', '4', '2'], ['', '', ''], ['Dash', '6', '3'], ['Ult', '10', '4']]);
  expect(s.delRow).toBe('⊟ -Row 2');

  await card.locator('.btn-table-add-col').click();
  s = await state(card);
  expect(s.headers).toEqual(['Move', 'New', 'Startup', 'Active']);
  expect(s.rows[0]).toEqual(['M1', '', '4', '2']);
  expect(s.delCol).toBe('⊟ -Col 2');
});

test('a header cell picks its column only, and +Row puts the new row first', async ({ page }) => {
  const { card } = await openTable(page);
  await card.locator('.table-header-input[data-col="2"]').click();

  let s = await state(card);
  expect(s.picked.sort()).toEqual(['0,2', '1,2', '2,2', 'h2'].sort());
  expect(s.delRow, 'no row is picked').toBe('⊟ -Row');
  expect(s.delCol).toBe('⊟ -Col 3');

  await card.locator('.btn-table-add-row').click();
  s = await state(card);
  expect(s.rows[0]).toEqual(['', '', '']);
  expect(s.rows).toHaveLength(4);
});

test('with nothing picked, the buttons act at the end, as they always did', async ({ page }) => {
  const { card } = await openTable(page);

  await card.locator('.btn-table-add-row').click();
  let s = await state(card);
  expect(s.rows.at(-1)).toEqual(['', '', '']);
  expect(s.picked).toEqual([]);

  await card.locator('.btn-table-del-row').click();
  await confirmSaying(page, 'bottom row');
  await card.locator('.btn-table-del-col').click();
  await confirmSaying(page, 'right-hand column');
  s = await state(card);
  expect(s.headers).toEqual(['Move', 'Startup']);
  expect(s.rows).toEqual([['M1', '4'], ['Dash', '6'], ['Ult', '10']]);
});

test('going into any other field lets the pick go', async ({ page }) => {
  const { card } = await openTable(page);
  await cell(card, 2, 0).click();
  expect((await state(card)).picked.length).toBeGreaterThan(0);

  await page.locator('#block-list .block-card').first().locator('textarea').first().click();
  const s = await state(card);
  expect(s.picked).toEqual([]);
  expect(s.delRow).toBe('⊟ -Row');
  expect(s.delCol).toBe('⊟ -Col');
});

test('+Row and -Row stay under the mouse, so pressing them again needs no aim', async ({ page }) => {
  // Enough above and below the table that the Workspace scrolls both ways.
  const many = Array.from({ length: 8 }, (_, i) => para(i));
  const { card } = await openTable(page, [...many, TABLE, ...many]);
  await page.evaluate(() => window.editorConfig.set('confirmDeletes', false));
  // Blocks far off screen are drawn as empty placeholders until scrolled to.
  await card.scrollIntoViewIfNeeded();
  await cell(card, 1, 0).click();

  // The row of buttons, which the hover lift on a single button does not move.
  const buttons = card.locator('.block-table-actions-row');
  const add = card.locator('.btn-table-add-row');
  await add.scrollIntoViewIfNeeded();
  const start = (await buttons.boundingBox()).y;
  const box = await add.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;

  for (let press = 0; press < 3; press++) {
    await page.mouse.click(x, y);
    expect(Math.abs((await buttons.boundingBox()).y - start), `after press ${press + 1}`).toBeLessThan(1);
  }
  let s = await state(card);
  expect(s.rows, 'three presses, three new rows').toHaveLength(6);

  const delBox = await card.locator('.btn-table-del-row').boundingBox();
  for (let press = 0; press < 2; press++) {
    await page.mouse.click(delBox.x + delBox.width / 2, delBox.y + delBox.height / 2);
    expect(Math.abs((await buttons.boundingBox()).y - start), `after delete ${press + 1}`).toBeLessThan(1);
  }
  s = await state(card);
  expect(s.rows, 'two presses, two rows gone').toHaveLength(4);
});
