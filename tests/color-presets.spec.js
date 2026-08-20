// The editor's colour presets (v0.13 item 14).
//
// The picker offered seven hardcoded swatches while window.CHARACTER_COLORS
// and window.FRAME_COLORS already existed and drove the colours everywhere
// else on the site - so matching a character or a frame phase in prose meant
// reading a value out of the CSS by hand.
//
// The timing detail worth a test of its own: FRAME_COLORS and WINDOW_COLORS
// are read out of CSS custom properties by an IIFE in js/site_meta.js. Build
// the swatch list while this file parses and you capture empty strings, and
// the failure looks like a row of invisible buttons that apply no colour
// rather than like an error.
const { test, expect } = require('@playwright/test');

async function openEditor(page) {
    // Mocked: an unmocked page_data fetch lands mid-test and re-renders the
    // builder underneath the assertions.
    await page.route('**/rest/v1/page_data*', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.goto('/edit.html?char=testchar&tab=overview', { waitUntil: 'networkidle' });

    // renderBlockList always targets #block-list regardless of the container
    // passed here, and edit.html already has a real one inside
    // strategy-block-target - so reuse that rather than creating a duplicate.
    await page.evaluate(() => {
        window.initStrategyBlockBuilder('strategy-block-target', [
            { type: 'paragraph', content: 'Colour me', align: 'left' },
        ]);
    });
}

async function openPicker(page) {
    await openEditor(page);
    await page.locator('#btn-format-color').click();
    await expect(page.locator('#format-color-popup')).toBeVisible();
}

const groupLabels = (page) => page.locator('#format-color-popup .format-color-popup-label');
const swatches = (page) => page.locator('#format-color-popup .color-preset-btn');

test('the picker is grouped, with the basics still first', async ({ page }) => {
    await openPicker(page);
    await expect(groupLabels(page)).toHaveText(['Basic', 'Characters', 'Frame types']);
});

test('every character colour is offered, and named', async ({ page }) => {
    await openPicker(page);

    const expected = await page.evaluate(() => Object.keys(window.CHARACTER_COLORS));
    expect(expected.length).toBeGreaterThan(20);

    const titles = await swatches(page).evaluateAll(nodes => nodes.map(n => n.title));
    for (const name of expected) {
        expect(titles, `${name} has no swatch`).toContain(name);
    }
});

test('frame and window colours are offered under the legend names', async ({ page }) => {
    await openPicker(page);

    const titles = await swatches(page).evaluateAll(nodes => nodes.map(n => n.title));
    // The wording contributors actually use, taken from the frame-data legend
    // rather than invented for the picker.
    for (const label of ['Startup', 'Active', 'Recovery', 'InSkill Stun', 'Block Endlag', 'Melee I-Frames', 'Reverse Hitcancel']) {
        expect(titles, `no swatch labelled ${label}`).toContain(label);
    }
});

test('the frame colours are real values, not empty strings', async ({ page }) => {
    // The parse-time trap. A swatch built before ColorCoding.css applied gets
    // an empty colour, renders transparent, and applies nothing on click -
    // which looks like a styling glitch rather than a bug.
    await openPicker(page);

    const values = await swatches(page).evaluateAll(nodes =>
        nodes.map(n => ({ title: n.title, color: n.dataset.color })));

    const frameSwatch = values.find(v => v.title === 'Startup');
    expect(frameSwatch, 'no Startup swatch at all').toBeTruthy();
    expect(frameSwatch.color).toMatch(/^(#|hsl|rgb)/);

    // And it must match what the stylesheet actually resolved to, not just
    // look like a colour.
    const fromCss = await page.evaluate(() => window.FRAME_COLORS['bg-tick-start']);
    expect(frameSwatch.color).toBe(fromCss.trim());
});

test('every swatch carries a usable colour and a name', async ({ page }) => {
    await openPicker(page);

    const total = await swatches(page).count();
    // 7 basic + 23 characters + 15 frame/window, but asserted as a floor:
    // the roster is content the owner adds to.
    expect(total).toBeGreaterThanOrEqual(40);

    const bad = await swatches(page).evaluateAll(nodes => nodes
        .filter(n => !n.title || !/^(#[0-9a-f]{3,8}|(hsla?|rgba?)\()/i.test(n.dataset.color || ''))
        .map(n => n.title || '(untitled)'));
    expect(bad).toEqual([]);
});

test('clicking a character swatch wraps the selected text in that colour', async ({ page }) => {
    // The point of the whole item: a preset has to actually colour text, not
    // merely render as a square. The editor is a BBCode textarea, so the
    // selection has to be a real one - applyFormat reads the last focused
    // input and its selection range.
    await openEditor(page);

    // Scoped to .block-card for the same reason as color-picker.spec.js: a
    // folder header sits inside #block-list and sorts ahead of every card.
    const textarea = page.locator('#block-list .block-card textarea').first();
    await expect(textarea).toBeVisible();
    await textarea.click();
    await page.keyboard.press('ControlOrMeta+a');

    await page.locator('#btn-format-color').click();

    // Selected by name, not position - a swatch chosen by index silently
    // starts testing a different colour the moment the roster changes.
    const swatch = page.locator('#format-color-popup .color-preset-btn[title="Vessel"]');
    await expect(swatch).toHaveCount(1);
    const chosen = await swatch.getAttribute('data-color');

    await swatch.click();

    await expect(textarea).toHaveValue(new RegExp(`\\[color=${chosen.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`));
    await expect(page.locator('#format-color-popup')).toBeHidden();
});

test('a colour that is not a safe css value is never rendered into a style attribute', async ({ page }) => {
    // These land in style="background: ...". Escaping is not enough there, so
    // the list is whitelisted - this proves the whitelist is doing something.
    await openPicker(page);

    const injected = await page.evaluate(() => {
        window.CHARACTER_COLORS = { ...window.CHARACTER_COLORS, Evil: 'red; position: fixed; inset: 0' };
        return typeof colorPresetGroups === 'function'
            ? colorPresetGroups().flatMap(g => g.swatches).some(s => s.label === 'Evil')
            : null;
    });
    expect(injected).toBe(false);
});
