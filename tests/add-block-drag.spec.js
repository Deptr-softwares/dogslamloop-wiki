// Dragging a Block type out of the Add Block menu (found 2026-10-20, there
// since the drag moved to pointer events in v0.5).
//
// The drag captures the pointer on the menu button, so when the mouse button
// comes up the browser sends a click to that menu button wherever the drop
// was. The menu's click handler is the tap fallback ("click a type to add it
// at the end"), so every drag added the block where it was dropped AND a
// second one at the end of the list.
//
// Real mouse events, not dispatched ones: startBlockPointerDrag calls
// setPointerCapture, which throws on synthetic events, and the bug lives in
// what the browser does after a real capture.
const { test, expect } = require('@playwright/test');

const EDITOR = '/edit.html?char=boomcat&type=character&tab=overview';

async function openWorkspace(page) {
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto(EDITOR, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof window.initStrategyBlockBuilder === 'function' && !!document.getElementById('strategy-block-target'));
  await page.evaluate(() => window.initStrategyBlockBuilder('strategy-block-target', [
    { type: 'paragraph', content: 'first', align: 'left' },
    { type: 'paragraph', content: 'second', align: 'left' },
  ]));
}

const types = page => page.evaluate(() => window.getActiveBlocks().map(b => b.type));

async function dragFromMenu(page, type, target) {
  await page.locator('#btn-toggle-add-menu').click();
  const from = await page.locator(`#add-block-popup .add-block-btn[data-type="${type}"]`).boundingBox();
  const to = await target.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y - 20);   // past the drag threshold
  await page.mouse.move(to.x + to.width / 2, to.y + 5, { steps: 6 });
  await page.mouse.up();
}

test('a block type dragged from the Add Block menu adds one block, where it was dropped', async ({ page }) => {
  await openWorkspace(page);
  await dragFromMenu(page, 'heading', page.locator('#block-list .block-card').first());
  await page.waitForTimeout(200);
  expect(await types(page)).toEqual(['heading', 'paragraph', 'paragraph']);
});

// A finger drag ends with no click at all, so the swallow has to let go on its
// own, or the next tap on that menu button would be eaten.
test.describe('on a touch screen', () => {
  test.use({ hasTouch: true });

  test('a finger drag adds one block, and the next tap on the same type still works', async ({ page }) => {
    await openWorkspace(page);
    await page.locator('#btn-toggle-add-menu').click();
    const from = await page.locator('#add-block-popup .add-block-btn[data-type="heading"]').boundingBox();
    const to = await page.locator('#block-list .block-card').first().boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const x = from.x + from.width / 2;
    await touch('touchStart', x, from.y + from.height / 2);
    for (let step = 1; step <= 6; step++) {
      await touch('touchMove', x + (to.x + to.width / 2 - x) * step / 6, from.y + (to.y + 5 - from.y) * step / 6);
    }
    await touch('touchEnd');
    await page.waitForTimeout(300);
    expect(await types(page)).toEqual(['heading', 'paragraph', 'paragraph']);

    await page.locator('#btn-toggle-add-menu').click();
    await page.locator('#add-block-popup .add-block-btn[data-type="heading"]').click();
    expect(await types(page)).toEqual(['heading', 'paragraph', 'paragraph', 'heading']);
  });
});

test('after a drag, clicking a type in the menu still adds it at the end', async ({ page }) => {
  await openWorkspace(page);
  await dragFromMenu(page, 'heading', page.locator('#block-list .block-card').first());
  await page.waitForTimeout(200);

  // The click is swallowed for the drag's own gesture only, never the next
  // one: the same menu button the drag started from still adds on a click.
  await page.locator('#btn-toggle-add-menu').click();
  await page.locator('#add-block-popup .add-block-btn[data-type="heading"]').click();
  expect(await types(page)).toEqual(['heading', 'paragraph', 'paragraph', 'heading']);
});
