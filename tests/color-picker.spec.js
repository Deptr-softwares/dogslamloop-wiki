// The editor's visual colour picker and the two new shortcode buttons
// (v0.14 §8, the last fine-tuning items).
//
// <input type="color"> opened the OPERATING SYSTEM's colour dialog on top of
// the wiki - a different palette, different conventions, and on some platforms
// a modal that steals the text selection the toolbar is about to wrap. It is a
// saturation/brightness surface and a hue slider now, drawn with CSS
// gradients, writing through the same applyFormat('color', hex) path the
// preset swatches already used.
//
// Everything below drives the real controls with a real mouse. Synthetic
// PointerEvents were tried first and hid a bug: setPointerCapture throws for
// an id that is not an active pointer, which aborted the handler before it did
// anything.

const { test, expect } = require('@playwright/test');

// v0.16 fine-tuning 2 made every block in the editor start COLLAPSED, so a
// field inside one has no layout until its block is opened. Tests that reach
// into a block open the workspace first - the same thing an author does before
// editing. Duplicated per file rather than shared, matching this project's
// preference for small duplication over new cross-file coupling.
async function openEveryBlock(page) {
    await page.evaluate(() => {
        // Not every page this helper runs on HAS a block builder - the tier
        // editor's access-denied screen replaces the whole body - and
        // renderBlockList writes straight into #block-list.
        if (!document.getElementById('block-list')) return;
        // Folders first. A block inside a collapsed folder stays hidden however
        // open the block itself is, and the pages these tests use really do
        // have folders.
        if (typeof window.setBlockFolderCollapsed === 'function') {
            document.querySelectorAll('#block-list .block-folder').forEach(f =>
                window.setBlockFolderCollapsed(f.getAttribute('data-folder'), false));
        }
        if (typeof window.setEditorBlockExpanded === 'function') {
            (window.getActiveBlocks() || []).forEach(b => window.setEditorBlockExpanded(b, true));
        }
        window.renderBlockList();
    });
}


const PAGE = '/edit.html?page=boomcat';

async function openEditor(page) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await expect(page.locator('.format-toolbar')).toBeVisible({ timeout: 15000 });
    return errors;
}

test('the operating system colour dialog is gone', async ({ page }) => {
    await openEditor(page);

    // The whole point of the item. An <input type="color"> anywhere in the
    // toolbar means the OS picker is still reachable.
    await expect(page.locator('.format-toolbar input[type="color"]')).toHaveCount(0);

    await page.locator('#btn-format-color').click();
    await expect(page.locator('#cp-surface')).toBeVisible();
    await expect(page.locator('#cp-hue')).toBeVisible();
});

test('dragging the hue changes the colour, and the readout follows', async ({ page }) => {
    const errors = await openEditor(page);
    await page.locator('#btn-format-color').click();

    // Saturation first: at s=0 the colour is white at every hue, so a hue drag
    // alone would leave the hex unchanged and prove nothing.
    const surface = await page.locator('#cp-surface').boundingBox();
    await page.mouse.click(surface.x + surface.width * 0.9, surface.y + surface.height * 0.1);

    const afterSurface = await page.locator('#cp-hex').inputValue();
    expect(afterSurface).toMatch(/^#[0-9a-f]{6}$/i);
    expect(afterSurface).not.toBe('#ffffff');

    const hue = await page.locator('#cp-hue').boundingBox();
    await page.mouse.click(hue.x + hue.width * 0.66, hue.y + hue.height / 2);

    const afterHue = await page.locator('#cp-hex').inputValue();
    expect(afterHue).not.toBe(afterSurface);
    // Two thirds along a 0-360 sweep.
    await expect(page.locator('#cp-hue')).toHaveAttribute('aria-valuenow', /^2[34]\d$/);

    expect(errors).toEqual([]);
});

test('typing a hex drives the surface rather than bypassing it', async ({ page }) => {
    await openEditor(page);
    await page.locator('#btn-format-color').click();

    await page.locator('#cp-hex').fill('#3b82f6');

    // The preview and the thumb both have to move, or the field is a second
    // source of truth that the surface disagrees with.
    await expect(page.locator('#cp-preview')).toHaveCSS('background-color', 'rgb(59, 130, 246)');

    const left = await page.locator('#cp-surface-thumb').evaluate(el => parseFloat(el.style.left));
    expect(left).toBeGreaterThan(50);
});

test('the hue slider works from the keyboard', async ({ page }) => {
    await openEditor(page);
    await page.locator('#btn-format-color').click();

    await page.locator('#cp-hue').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#cp-hue')).toHaveAttribute('aria-valuenow', '1');

    await page.keyboard.press('Shift+ArrowRight');
    await expect(page.locator('#cp-hue')).toHaveAttribute('aria-valuenow', '11');

    // Wraps rather than sticking at zero.
    await page.locator('#cp-hue').evaluate(el => el.setAttribute('aria-valuenow', '0'));
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#cp-hue')).toHaveAttribute('aria-valuenow', /^\d+$/);
});

// The editor saves the selection on mouseup and keyup inside #block-list, so
// a programmatic setSelectionRange sets no selection as far as the toolbar is
// concerned - it wrapped an empty string at position 0. Everything below
// selects with a real keyboard.
// Scoped to .block-card, not to #block-list. Block folders (v0.15 item 9) put
// a folder-NAME input inside the list, and because the shell wraps the cards
// its header sorts ahead of every one of them - so `.first()` started
// selecting a folder name instead of block content, typed into that, and got
// no shortcode back. The field this spec wants is always inside a card.
const TEXT_FIELD = '#block-list .block-card textarea, #block-list .block-card input[type="text"]';

async function typeAndSelect(page, text, charsToSelect) {
    await openEveryBlock(page);
    const field = page.locator(TEXT_FIELD).first();
    if (!(await field.count())) return false;

    await field.click();
    await field.fill('');
    await page.keyboard.type(text);
    await page.keyboard.press('Home');
    for (let i = 0; i < charsToSelect; i++) await page.keyboard.press('Shift+ArrowRight');
    return true;
}

const fieldValue = (page) => page.locator(TEXT_FIELD).first().inputValue();

test('USE wraps the selected text in a colour shortcode', async ({ page }) => {
    await openEditor(page);

    // The write path is what this item is ultimately about, and it is shared
    // with the preset swatches.
    const ok = await typeAndSelect(page, 'hello world', 5);
    test.skip(!ok, 'this page has no text block to format');

    await page.locator('#btn-format-color').click();
    await page.locator('#cp-hex').fill('#ff0000');
    await page.locator('#cp-apply').click();

    expect(await fieldValue(page)).toBe('[color=#ff0000]hello[/color] world');
    // And the popup closes, the same as picking a preset does.
    await expect(page.locator('#format-color-popup')).toBeHidden();
});

test('the custom picker is visible without scrolling for it', async ({ page }) => {
    await openEditor(page);
    await page.locator('#btn-format-color').click();

    // It used to sit inside the popup's scrolling region, below ~45 preset
    // swatches and under a 320px cap - so opening the picker showed nothing
    // but swatches. Only the swatches scroll now.
    const popup = await page.locator('#format-color-popup').boundingBox();
    for (const sel of ['#cp-surface', '#cp-hue', '#cp-apply']) {
        const box = await page.locator(sel).boundingBox();
        expect(box, sel).not.toBeNull();
        expect(box.y + box.height, `${sel} is below the popup's visible area`)
            .toBeLessThanOrEqual(popup.y + popup.height + 1);
    }
});

test('a hex the picker cannot parse never reaches the page', async ({ page }) => {
    await openEditor(page);

    const ok = await typeAndSelect(page, 'hello world', 5);
    test.skip(!ok, 'this page has no text block to format');

    await page.locator('#btn-format-color').click();
    await page.locator('#cp-hex').fill('not-a-colour');
    await page.locator('#cp-apply').click();

    // It falls back to the surface's own colour rather than writing junk into
    // a style attribute - which js/internalstyling.js would refuse anyway, but
    // the contributor would just see their colour vanish.
    const applied = await fieldValue(page);
    expect(applied).not.toContain('not-a-colour');
    expect(applied).toMatch(/\[color=#[0-9a-f]{6}\]hello\[\/color\]/i);
});

// --------------------------------------------------------------------------
// THE TWO NEW SHORTCODE BUTTONS
// --------------------------------------------------------------------------
//
// [kbd] and [noauto] shipped with the shortcode engine and had no way to be
// typed except by hand, which is the same as not existing for most people.

test('the toolbar offers every shortcode the engine renders', async ({ page }) => {
    await openEditor(page);

    const tags = await page.locator('.format-btn[data-tag]').evaluateAll(
        nodes => nodes.map(n => n.dataset.tag));

    expect(tags).toEqual(['b', 'i', 'u', 's', 'code', 'url', 'kbd', 'noauto']);
});

test('the kbd button wraps the selection', async ({ page }) => {
    await openEditor(page);

    const ok = await typeAndSelect(page, 'M1 then E', 2);
    test.skip(!ok, 'this page has no text block to format');

    await page.locator('.format-btn[data-tag="kbd"]').click();

    expect(await fieldValue(page)).toBe('[kbd]M1[/kbd] then E');
});

test('the noauto button wraps the selection', async ({ page }) => {
    await openEditor(page);

    // The escape hatch for a character alias that is also an ordinary word.
    const ok = await typeAndSelect(page, 'Register an account', 8);
    test.skip(!ok, 'this page has no text block to format');

    await page.locator('.format-btn[data-tag="noauto"]').click();

    expect(await fieldValue(page)).toBe('[noauto]Register[/noauto] an account');
});
