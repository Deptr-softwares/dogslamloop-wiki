// Multi-select blocks - v0.19 C2.
//
// The owner's own item, carried from v0.18, and recorded there and in the v0.19
// devlog as "a selection model over js/editor-blocks.js, NOT a keybinding".
// That distinction is the whole file: Ctrl+C and Ctrl+V over a hovered card
// already existed. What did not was anything that knows WHICH blocks the author
// means while the array underneath them is being rewritten.
//
// So the claim under test is not "Ctrl-click adds a class". It is:
//
//   A selection names BLOCKS, not positions - and every operation a selection
//   offers (move, delete, paste) changes the positions of the blocks around it.
//
// Selection is keyed by the block OBJECT in a WeakSet, the same way
// expandedBlocks keys collapse state and for the reasons stated there. The test
// that matters most is therefore the one that shifts every index and asks the
// selection what it holds: keyed by index it would answer with whatever moved
// into the slot, which is the bug this design exists to make impossible.
const { test, expect } = require('@playwright/test');

const EDITOR = '/edit.html?char=testchar&tab=overview';

async function boot(page) {
    await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.initStrategyBlockBuilder === 'function', { timeout: 15000 });
}

// renderBlockList always targets #block-list by id whatever container it was
// given, so the body is replaced rather than appended to - the same shape
// block-folders.spec.js uses, and for the same reason.
async function build(page, texts) {
    await page.evaluate((list) => {
        document.body.innerHTML = '<div id="block-host"></div>';
        window.initStrategyBlockBuilder('block-host', list.map(t => ({ type: 'paragraph', content: t })));
        window.renderBlockList();
    }, texts);
    await expect(page.locator('#block-list .block-card')).toHaveCount(texts.length);
}

// Read the document back by CONTENT rather than by index, because index is the
// thing these tests are trying to catch being wrong.
const contents = (page) => page.evaluate(() => window.getActiveBlocks().map(b => b.content));
const selected = (page) => page.evaluate(() =>
    window.getSelectedBlockIndices().map(i => window.getActiveBlocks()[i].content));

const summary = (n) => `#block-list .block-card[data-index="${n}"] .block-card-summary`;
const ctrlClick = (page, n) => page.click(summary(n), { modifiers: ['Control'] });

test('ctrl-click selects, and the bar says how many', async ({ page }) => {
    await boot(page);
    await build(page, ['one', 'two', 'three']);

    // No selection, no bar: an empty toolbar above the list would be chrome
    // nobody asked for.
    await expect(page.locator('#block-selection-bar')).toHaveCount(0);

    await ctrlClick(page, 0);
    await ctrlClick(page, 2);

    await expect(page.locator('.block-selection-count')).toHaveText('2 SELECTED');
    expect(await selected(page)).toEqual(['one', 'three']);
});

test('a selected card is painted, not merely recorded', async ({ page }) => {
    await boot(page);
    await build(page, ['one', 'two']);

    // .block-card carries `transition: border-color 0.1s`, so a colour read
    // straight after a class change catches it mid-flight - the first version
    // of this test compared two frames of the same animation and accused the
    // stylesheet. Turned off here so the assertion is about which rule won,
    // which is the only thing it is trying to say.
    await page.addStyleTag({ content: '#block-list .block-card { transition: none !important; }' });
    await ctrlClick(page, 0);

    // The class is not the claim - what the browser computed is. .block-card
    // uses border-left as its state channel, and the selection rule has to beat
    // :hover and .collapsed, which is what the #block-list in the selector is
    // there for.
    const read = (i) => page.evaluate((n) => getComputedStyle(
        document.querySelector(`#block-list .block-card[data-index="${n}"]`)
    ).borderLeftColor, i);

    const picked = await read(0);
    expect(picked).not.toBe(await read(1));

    // AND IT SURVIVES THE POINTER. Blocks open collapsed, and
    // `.block-card.collapsed:hover` is three classes - without an id in the
    // selector it outranks the selection rule, so hovering a selected card
    // would quietly paint the selection away. Nothing above this line would
    // have noticed.
    await page.hover(summary(0));
    expect(await read(0), 'hover must not repaint a selected card').toBe(picked);
});

test('ctrl-click on a control inside the header is not a selection', async ({ page }) => {
    await boot(page);
    await build(page, ['one', 'two']);

    // The header holds a drag handle, a type selector and five buttons, each of
    // which is already a gesture. Ctrl-clicking one must not also select.
    await page.click('#block-list .block-card[data-index="0"] .btn-collapse', { modifiers: ['Control'] });
    await page.click('#block-list .block-card[data-index="0"] .drag-handle', { modifiers: ['Control'] });

    expect(await selected(page)).toEqual([]);
    await expect(page.locator('#block-selection-bar')).toHaveCount(0);
});

test('the selection names blocks, not positions', async ({ page }) => {
    await boot(page);
    await build(page, ['one', 'two', 'three']);
    await ctrlClick(page, 2);
    expect(await selected(page)).toEqual(['three']);

    // Shift every index out from under it. Keyed by index this answers
    // "two" - the block that moved into slot 2 - which is the whole bug.
    await page.evaluate(() => {
        window.getActiveBlocks().unshift({ type: 'paragraph', content: 'zero' });
        window.renderBlockList();
    });

    expect(await contents(page)).toEqual(['zero', 'one', 'two', 'three']);
    expect(await selected(page), 'still the same block, now at index 3').toEqual(['three']);
    await expect(page.locator('.block-selection-count')).toHaveText('1 SELECTED');
});

test('the selection and its bar survive a full re-render', async ({ page }) => {
    await boot(page);
    await build(page, ['one', 'two', 'three']);
    await ctrlClick(page, 0);
    await ctrlClick(page, 1);

    await page.evaluate(() => window.renderBlockList());

    expect(await selected(page)).toEqual(['one', 'two']);
    await expect(page.locator('.block-selection-count')).toHaveText('2 SELECTED');
    // And it is still the first row, not stranded at the bottom of the rebuild.
    const first = await page.evaluate(() =>
        document.getElementById('block-list').firstElementChild.id);
    expect(first).toBe('block-selection-bar');
});

test('copy takes every selected block, and paste lands them under the hovered card', async ({ page }) => {
    await boot(page);
    await build(page, ['one', 'two', 'three']);
    await ctrlClick(page, 0);
    await ctrlClick(page, 1);

    await page.click('[data-selection-action="copy"]');
    await page.hover(summary(2));
    await page.keyboard.press('Control+v');

    expect(await contents(page)).toEqual(['one', 'two', 'three', 'one', 'two']);
});

test('a pasted block is a copy, not the same object twice', async ({ page }) => {
    await boot(page);
    await build(page, ['one', 'two']);
    await ctrlClick(page, 0);
    await page.click('[data-selection-action="copy"]');

    await page.keyboard.press('Control+v');
    await page.keyboard.press('Control+v');

    // Edit one of the pastes. If the clipboard handed out references rather
    // than clones, this writes through into the others.
    const after = await page.evaluate(() => {
        const blocks = window.getActiveBlocks();
        blocks[blocks.length - 1].content = 'EDITED';
        return blocks.map(b => b.content);
    });

    expect(after).toEqual(['one', 'two', 'one', 'EDITED']);
});

test('a selection beats the hover when both are live', async ({ page }) => {
    await boot(page);
    await build(page, ['one', 'two', 'three']);

    // Selected "one", pointer resting on "three". Hover copy is what this was
    // before C2 and still works with nothing selected - but once the author has
    // said which block they mean, the pointer must not overrule them.
    await ctrlClick(page, 0);
    await page.hover(summary(2));
    await page.keyboard.press('Control+c');

    // Paste in empty space appends, so the tail names which block was taken.
    await page.mouse.move(2, 2);
    await page.keyboard.press('Control+v');

    expect(await contents(page)).toEqual(['one', 'two', 'three', 'one']);
});

test('hover copy still works with nothing selected', async ({ page }) => {
    await boot(page);
    await build(page, ['one', 'two', 'three']);

    await page.hover(summary(1));
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');

    expect(await contents(page)).toEqual(['one', 'two', 'two', 'three']);
});

test('Delete removes exactly the selected blocks', async ({ page }) => {
    await boot(page);
    await build(page, ['one', 'two', 'three', 'four']);
    await ctrlClick(page, 0);
    await ctrlClick(page, 2);

    await page.keyboard.press('Delete');

    expect(await contents(page)).toEqual(['two', 'four']);
    expect(await selected(page), 'and the selection goes with them').toEqual([]);
    await expect(page.locator('#block-selection-bar')).toHaveCount(0);
});

test('a contiguous run moves as one piece', async ({ page }) => {
    await boot(page);
    await build(page, ['a', 'b', 'c', 'd']);
    await ctrlClick(page, 2);
    await ctrlClick(page, 3);

    await page.click('[data-selection-action="up"]');

    expect(await contents(page)).toEqual(['a', 'c', 'd', 'b']);
    expect(await selected(page), 'the same two, still together').toEqual(['c', 'd']);
});

test('a gapped selection closes up rather than refusing to move', async ({ page }) => {
    await boot(page);
    await build(page, ['a', 'b', 'c']);
    // 'a' is already at the top and stays; 'c' steps over 'b'.
    await ctrlClick(page, 0);
    await ctrlClick(page, 2);

    await page.click('[data-selection-action="up"]');

    expect(await contents(page)).toEqual(['a', 'c', 'b']);
    expect(await selected(page)).toEqual(['a', 'c']);
});

test('a selection hard against the top reports that it did not move', async ({ page }) => {
    await boot(page);
    await build(page, ['a', 'b', 'c']);
    await ctrlClick(page, 0);
    await ctrlClick(page, 1);

    // Returning false is what keeps an identical state off the undo stack.
    const moved = await page.evaluate(() => window.moveSelectedBlocks(-1));

    expect(moved).toBe(false);
    expect(await contents(page)).toEqual(['a', 'b', 'c']);
});

test("a selected card's own buttons act on the whole selection", async ({ page }) => {
    await boot(page);
    await build(page, ['a', 'b', 'c', 'd']);
    await ctrlClick(page, 2);
    await ctrlClick(page, 3);

    // The ▼ on one member, not the bar.
    await page.click('#block-list .block-card[data-index="2"] .btn-up');

    expect(await contents(page)).toEqual(['a', 'c', 'd', 'b']);
});

test('a card outside the selection still acts on itself alone', async ({ page }) => {
    await boot(page);
    await build(page, ['a', 'b', 'c']);
    await ctrlClick(page, 0);

    await page.click('#block-list .block-card[data-index="2"] .btn-up');

    expect(await contents(page)).toEqual(['a', 'c', 'b']);
    expect(await selected(page), 'and the selection is untouched').toEqual(['a']);
});

test('CLEAR empties the selection without touching the document', async ({ page }) => {
    await boot(page);
    await build(page, ['a', 'b', 'c']);
    await ctrlClick(page, 0);
    await ctrlClick(page, 1);

    await page.click('[data-selection-action="clear"]');

    expect(await selected(page)).toEqual([]);
    expect(await contents(page)).toEqual(['a', 'b', 'c']);
    await expect(page.locator('#block-selection-bar')).toHaveCount(0);
});

test('no bar button reaches the handler that throws outside a card', async ({ page }) => {
    // The bar lives in #block-list but outside every .block-card, and the
    // general button handler there resolves buttons through
    // closest('.block-card').getAttribute(...) - its own comment records that
    // this throws for exactly that shape. The selection listeners are
    // registered first and stop propagation, which is invisible to every
    // assertion above: the work still happens, and the exception lands in a
    // different listener where nothing was watching for it.
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await boot(page);
    await build(page, ['a', 'b', 'c', 'd']);
    await ctrlClick(page, 1);
    await ctrlClick(page, 2);

    for (const action of ['copy', 'up', 'down', 'delete']) {
        await page.click(`[data-selection-action="${action}"]`);
    }

    expect(errors, 'a bar button must not fall through to the card handler').toEqual([]);
});

test('gallery mode is left alone, as v0.18 F9 required', async ({ page }) => {
    await boot(page);
    await build(page, ['a', 'b', 'c']);
    await ctrlClick(page, 0);

    // The bin has no blocks to select, and a repaint of #block-list over it
    // takes the media rows with it - which is what F9's early return exists to
    // prevent. C2 keeps that guard rather than routing around it.
    await page.evaluate(() => { window.editorBuilderMode = 'gallery'; });
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await page.evaluate(() => { window.editorBuilderMode = 'blocks'; });

    expect(await contents(page)).toEqual(['a', 'b', 'c']);
});

test('undo after a multi-delete puts every block back', async ({ page }) => {
    await boot(page);
    await build(page, ['a', 'b', 'c', 'd']);
    await ctrlClick(page, 1);
    await ctrlClick(page, 2);

    await page.keyboard.press('Delete');
    expect(await contents(page)).toEqual(['a', 'd']);

    // deleteSelectedBlocks snapshots BEFORE the splice and updateLivePreview
    // pushes the state after it, so the pair brackets the whole action: one
    // undo, not one per block.
    await expect(page.locator('#btn-undo')).toBeEnabled();
    await page.click('#btn-undo');
    expect(await contents(page)).toEqual(['a', 'b', 'c', 'd']);
});
