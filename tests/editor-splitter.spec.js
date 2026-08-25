// v0.16 fine-tuning 9, first half: "maximise the space you enter contents in".
//
// The 30/70 split was fixed, so on the owner's own 1280x720 the place you type
// was 384px wide - about 46 characters a line - whether or not you were looking
// at the preview at that moment. Measured before building: of 720px of window
// height, 154px was textarea.
//
// 30/70 REMAINS THE DEFAULT on purpose (owner, 2026-08-25): the preview exists
// to show the page at the proportions a reader gets, so widening the workspace
// is a trade the writer opts into, not the state they start in. Several tests
// below exist to keep that true.
const { test, expect } = require('@playwright/test');

const EDITOR = '/edit.html?char=boomcat&type=character&tab=overview';

async function openEditor(page, width = 1280, height = 720) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width, height });
  await page.goto(EDITOR, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  return errors;
}

const panes = (page) => page.evaluate(() => {
  const w = document.querySelector('.editor-workspace').getBoundingClientRect();
  const p = document.querySelector('.live-preview-pane').getBoundingClientRect();
  const s = document.getElementById('editor-splitter').getBoundingClientRect();
  const layout = document.querySelector('.editor-layout').getBoundingClientRect();
  return {
    workspace: Math.round(w.width),
    preview: Math.round(p.width),
    splitterX: Math.round(s.left + s.width / 2),
    pct: Math.round((w.width / layout.width) * 100),
    layout: Math.round(layout.width),
  };
});

// Drag from wherever the splitter is to an absolute x.
async function dragSplitterTo(page, x) {
  const before = await panes(page);
  await page.mouse.move(before.splitterX, 400);
  await page.mouse.down();
  await page.mouse.move(x, 400, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

test('it opens at 30/70, the proportions a reader gets', async ({ page }) => {
  const errors = await openEditor(page);
  const p = await panes(page);

  expect(p.pct, 'the default split is untouched').toBe(30);
  // Not just the percentage: the preview really is the remaining width, with
  // only the splitter between them.
  expect(p.workspace + p.preview, 'the two panes fill the layout')
    .toBeGreaterThan(p.layout - 12);
  expect(errors).toEqual([]);
});

test('dragging it makes the place you type wider', async ({ page }) => {
  // The whole point of the item. Asserting the pane width alone would pass on a
  // layout that widened the pane and left the field at 332px inside it.
  await openEditor(page);

  const fieldBefore = await page.evaluate(() => {
    const ta = document.querySelector('#interactive-builder textarea, #interactive-builder input[type=text]');
    return ta ? Math.round(ta.getBoundingClientRect().width) : null;
  });
  const before = await panes(page);

  await dragSplitterTo(page, 700);
  const after = await panes(page);

  const fieldAfter = await page.evaluate(() => {
    const ta = document.querySelector('#interactive-builder textarea, #interactive-builder input[type=text]');
    return ta ? Math.round(ta.getBoundingClientRect().width) : null;
  });

  expect(after.workspace, 'the workspace grew').toBeGreaterThan(before.workspace + 100);
  expect(after.preview, 'and the preview gave up exactly that width')
    .toBeLessThan(before.preview - 100);
  expect(fieldBefore, 'setup: there is a field to measure').not.toBeNull();
  expect(fieldAfter, 'the field the contributor types into grew with it')
    .toBeGreaterThan(fieldBefore + 100);
});

test('the split is remembered across a reload', async ({ page }) => {
  await openEditor(page);
  await dragSplitterTo(page, 640);
  const dragged = await panes(page);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const after = await panes(page);

  expect(after.pct, 'it opens where it was left').toBe(dragged.pct);
  expect(Math.abs(after.workspace - dragged.workspace), 'to the pixel').toBeLessThan(4);
});

test('double-clicking the splitter goes back to 30/70', async ({ page }) => {
  await openEditor(page);
  await dragSplitterTo(page, 760);
  expect((await panes(page)).pct, 'setup: it really moved').toBeGreaterThan(45);

  const p1 = await panes(page);
  await page.mouse.dblclick(p1.splitterX, 400);
  await page.waitForTimeout(250);

  expect((await panes(page)).pct, 'one gesture back to the reader proportions').toBe(30);
});

test('neither pane can be squeezed out of existence', async ({ page }) => {
  // Percent alone is not enough: 15% is comfortable at 1920 and unusable at
  // 1280, so the clamp is in pixels.
  await openEditor(page);

  await dragSplitterTo(page, 5);
  const farLeft = await panes(page);
  expect(farLeft.workspace, 'the workspace keeps a usable floor').toBeGreaterThanOrEqual(295);

  await dragSplitterTo(page, 1275);
  const farRight = await panes(page);
  expect(farRight.preview, 'and so does the preview').toBeGreaterThanOrEqual(355);
});

test('a stored split that no longer fits is re-clamped, not obeyed', async ({ page }) => {
  // The stored value is a PERCENTAGE, so a window resize alone can violate the
  // pixel floors without the contributor doing anything.
  //
  // The drag has to go to the far right and the window has to shrink a long
  // way, or this proves nothing: written first as 900px at 1600 then 1000 wide,
  // it passed with the clamp deleted, because 56% of 1000 is 560/440 and both
  // halves clear their floors on their own. Falsifying it is what showed that.
  await openEditor(page, 1600, 900);
  await dragSplitterTo(page, 1590);
  const wide = await panes(page);
  expect(wide.pct, 'setup: stored about as wide as the clamp allows').toBeGreaterThan(70);

  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForTimeout(400);

  const after = await panes(page);
  // Unclamped, the stored ~77% would leave the preview around 225px.
  expect(after.preview, 'the preview is still a preview').toBeGreaterThanOrEqual(355);
  expect(after.workspace, 'and the workspace is still usable').toBeGreaterThanOrEqual(295);
});

test('the keyboard can move it too', async ({ page }) => {
  // It is a focusable separator; arrow keys are what a person will try.
  await openEditor(page);
  const before = await panes(page);

  await page.locator('#editor-splitter').focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(250);
  const after = await panes(page);

  expect(after.workspace, 'Shift+Right widens the workspace').toBeGreaterThan(before.workspace + 100);

  await page.keyboard.press('Home');
  await page.waitForTimeout(250);
  expect((await panes(page)).pct, 'Home resets it').toBe(30);
});

test('below the mobile breakpoint there is no splitter and both panes are full width', async ({ page }) => {
  // The layout turns into a column down here and both panes are width:100%
  // !important. A flex-basis from the splitter would have become a HEIGHT.
  await openEditor(page, 390, 844);

  const seen = await page.evaluate(() => {
    const s = document.getElementById('editor-splitter');
    const w = document.querySelector('.editor-workspace');
    const r = w.getBoundingClientRect();
    return {
      splitter: getComputedStyle(s).display,
      workspaceW: Math.round(r.width),
      workspaceH: Math.round(r.height),
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
    };
  });

  expect(seen.splitter, 'the splitter is gone').toBe('none');
  expect(seen.workspaceW, 'and the workspace is the whole screen').toBe(seen.viewportW);

  // THE HEIGHT IS THE POINT. In a column layout flex-basis is the MAIN axis, so
  // an unscoped `flex: 0 0 var(--editor-split)` would make the workspace 30% of
  // the viewport HEIGHT and leave two thirds of the phone blank. Written first
  // as a width-only check, this passed with the min-width scoping removed - the
  // `width: 100% !important` was carrying it - so it was asserting nothing about
  // the risk its own comment named.
  expect(seen.workspaceH, 'the workspace is still full height, not 30% of it')
    .toBeGreaterThan(seen.viewportH - 10);
});
