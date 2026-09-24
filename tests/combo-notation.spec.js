// v0.20: notation styles on combo routes (owner, 2026-09-25).
//
// "Combo Block, Combo Card, and Combo Row now have the options to be toggled
// between notation styles: On the reader side, the combo block, combo card +
// combo row line will have a small toggle visuals on the side, which is very
// small and thin; reader switch styles by clicking on the combo text itself; On
// the editor side, it will be an optional things to give to a Combo Block,
// Combo Card's line and Combo Row's line, and by creating new style option,
// they have to fill in a new field."
//
// Two answers the owner gave before it was built, and both are pinned here:
//   - the AUTHOR types each style's label, and
//   - a reader's click switches EVERY combo with that label, remembered.
//
//   item.sequence   the first style, unlabelled, exactly as every stored combo
//   item.notations  [{ label, sequence }] beside it
//
// What would be expensive to get wrong, in order: a combo with no styles
// rendering differently (every combo on the site has none today); one of the
// Combo Card's two editors being forgotten (it has happened three times); and a
// reviewer approving a changed route they could not see.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGE = '/characters/Boomcat/index.html';
const EDITOR = '/edit.html?char=testchar&tab=overview';
const COMBOS = '/edit.html?char=boomcat&type=character&tab=combos';

const STYLED = {
    type: 'combo', sequence: ['M1', 'Uppercut', 'Murmurate'], damage: '38',
    notations: [
        { label: 'Keyboard', sequence: ['LMB', 'Space', '2'] },
        { label: 'Slots', sequence: ['M1', 'Up', 'S2'] },
    ],
};

async function boot(page) {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.generateHTMLForBlocks === 'function', { timeout: 45000 });
}

async function render(page, blocks, hostClass) {
    await page.evaluate(([b, cls]) => {
        let host = document.getElementById('render-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'render-host';
            document.body.appendChild(host);
        }
        host.className = cls || '';
        host.innerHTML = window.generateHTMLForBlocks(b, '');
    }, [blocks, hostClass || '']);
}

// The chips a reader can actually see in the n-th styled route: what is
// painted, not what is in the DOM, because every style is in the DOM.
function visibleRoute(page, n) {
    return page.evaluate((n) => {
        const c = document.querySelectorAll('#render-host .combo-has-notations')[n || 0];
        return [...c.querySelectorAll('.combo-node')]
            .filter(el => el.getClientRects().length > 0)
            .map(el => el.textContent);
    }, n);
}

async function editor(page, blocks) {
    await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.initStrategyBlockBuilder === 'function', { timeout: 15000 });
    await page.evaluate((b) => {
        document.body.innerHTML = '<div id="block-host"></div>';
        window.activeAccordionPath = [];
        window.initStrategyBlockBuilder('block-host', b);
        (window.getActiveBlocks() || []).forEach(blk => window.setEditorBlockExpanded(blk, true));
        window.renderBlockList();
    }, blocks);
}

// --- A COMBO WITH NO STYLES IS UNTOUCHED ---

test('a combo with no styles renders exactly the markup it did before, on all three surfaces', async ({ page }) => {
    // Every combo on the site has no styles today. The three chip loops were
    // folded into one renderer, so this is the assertion that folding them
    // changed nothing a reader or a stylesheet could notice. Positive and
    // exact: the old strings, not the absence of a new class.
    await boot(page);
    const html = await page.evaluate(() => {
        const block = window.generateHTMLForBlocks(
            [{ type: 'combo', sequence: ['M1', 'Circling'], damage: '20' }], '');
        const card = window.generateHTMLForBlocks(
            [{ type: 'theorybox', title: 'BnB', sequence: ['M1', 'Q'], damage: '44', content: [] }], '');
        const tbody = document.createElement('tbody');
        const route = window.COMBO_COLUMNS.filter(c => c.field === 'sequence');
        window.renderComboTableBody(tbody, [{ sequence: ['M1', 'Q'] }], route, null);
        return { block, card, row: tbody.querySelector('td').innerHTML };
    });

    const chips = '<span class="combo-node">M1</span><span class="combo-sep" aria-hidden="true">&gt;</span>';
    expect(html.block).toContain(`<div class="combo-container" style="justify-content: flex-start;">${chips}`
        + '<span class="combo-node">Circling</span><span class="combo-damage">20</span></div>');
    expect(html.card).toContain(`<div class="combo-container theorybox-route">${chips}`
        + '<span class="combo-node">Q</span><span class="combo-damage">44</span></div>');
    expect(html.row).toBe(`<div class="combo-container combo-route-inline">${chips}<span class="combo-node">Q</span></div>`);
    expect(html.block + html.card + html.row).not.toContain('combo-has-notations');
});

// --- THE READER ---

test('a styled route shows its first style, with a thin mark of one segment per style', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await boot(page);
    await render(page, [STYLED]);

    expect(await visibleRoute(page)).toEqual(['M1', 'Uppercut', 'Murmurate']);
    const route = page.locator('#render-host .combo-has-notations');
    await expect(route.locator('.combo-notation')).toHaveCount(3);
    await expect(route.locator('.combo-notation-mark > i')).toHaveCount(3);
    await expect(route.locator('.combo-notation-mark > i.is-on')).toHaveCount(1);
    // The owner's "very small and thin": measured, not assumed from the CSS.
    const mark = await route.locator('.combo-notation-mark').boundingBox();
    expect(mark.width).toBeLessThanOrEqual(4);
    expect(mark.height).toBeGreaterThan(8);
    // Damage still trails whichever route is showing.
    await expect(route.locator('.combo-damage')).toHaveText('38');
    expect(errors).toEqual([]);
});

test('clicking the route moves to the next style, and wraps back to the first', async ({ page }) => {
    await boot(page);
    await render(page, [STYLED]);
    const route = page.locator('#render-host .combo-has-notations');

    await route.click();
    expect(await visibleRoute(page)).toEqual(['LMB', 'Space', '2']);
    await expect(route).toHaveAttribute('title', 'Notation 2 of 3: Keyboard. Click the route to switch.');
    await route.click();
    expect(await visibleRoute(page)).toEqual(['M1', 'Up', 'S2']);
    await route.click();
    expect(await visibleRoute(page)).toEqual(['M1', 'Uppercut', 'Murmurate']);
    // The first style has no label of its own.
    await expect(route).toHaveAttribute('title', 'Notation 1 of 3. Click the route to switch.');
});

test('the choice applies to every combo with that label, ignoring case and spaces', async ({ page }) => {
    // Owner: "Every combo, remembered". The label is what is chosen, so a combo
    // whose author typed "keyboard " is the same style as one typed "Keyboard",
    // and a combo with no such style keeps its first route.
    await boot(page);
    await render(page, [
        STYLED,
        { type: 'combo', sequence: ['M1', 'Dive-Bomb'], notations: [{ label: '  keyboard ', sequence: ['LMB', '3'] }] },
        { type: 'combo', sequence: ['M1', 'Free Fall'], notations: [{ label: 'Slots', sequence: ['M1', 'S4'] }] },
    ]);

    await page.locator('#render-host .combo-has-notations').first().click();

    expect(await visibleRoute(page, 0)).toEqual(['LMB', 'Space', '2']);
    expect(await visibleRoute(page, 1), 'the same style, typed differently').toEqual(['LMB', '3']);
    expect(await visibleRoute(page, 2), 'no Keyboard style, so its first route').toEqual(['M1', 'Free Fall']);
});

test('the choice is remembered across a reload', async ({ page }) => {
    await boot(page);
    await render(page, [STYLED]);
    await page.locator('#render-host .combo-has-notations').click();
    expect(await page.evaluate(() => localStorage.getItem('dsl-combo-notation'))).toBe('keyboard');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.generateHTMLForBlocks === 'function', { timeout: 45000 });
    await render(page, [STYLED]);
    expect(await visibleRoute(page), 'rendered in the remembered style, first time').toEqual(['LMB', 'Space', '2']);
});

test('switching still works for the visit when storage is blocked', async ({ page }) => {
    // A private window or cleared site data. The page must not depend on it.
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await boot(page);
    await page.evaluate(() => {
        Storage.prototype.getItem = () => { throw new Error('storage blocked'); };
        Storage.prototype.setItem = () => { throw new Error('storage blocked'); };
        Storage.prototype.removeItem = () => { throw new Error('storage blocked'); };
    });
    await render(page, [STYLED]);
    await page.locator('#render-host .combo-has-notations').click();
    expect(await visibleRoute(page)).toEqual(['LMB', 'Space', '2']);
    await page.locator('#render-host .combo-has-notations').click();
    expect(await visibleRoute(page)).toEqual(['M1', 'Up', 'S2']);
    expect(errors).toEqual([]);
});

test('the route is a keyboard control too', async ({ page }) => {
    await boot(page);
    await render(page, [STYLED]);
    const route = page.locator('#render-host .combo-has-notations');
    await expect(route).toHaveAttribute('role', 'button');
    await expect(route).toHaveAttribute('tabindex', '0');

    await route.focus();
    await page.keyboard.press('Enter');
    expect(await visibleRoute(page)).toEqual(['LMB', 'Space', '2']);
    await page.keyboard.press(' ');
    expect(await visibleRoute(page)).toEqual(['M1', 'Up', 'S2']);
    await expect(route).toHaveAttribute('aria-label', 'Notation 3 of 3: Slots. Click the route to switch.');
});

test('a half-filled style is not offered to a reader', async ({ page }) => {
    // A label with no route, or a route with no label, is an author mid-edit.
    await boot(page);
    await render(page, [{
        type: 'combo', sequence: ['M1', 'Q'],
        notations: [{ label: 'Keyboard', sequence: [] }, { label: '  ', sequence: ['LMB'] }, { label: 'Pad', sequence: ['', ' '] }],
    }]);
    await expect(page.locator('#render-host .combo-has-notations')).toHaveCount(0);
    // And it renders as the plain route rather than not at all.
    await expect(page.locator('#render-host .combo-container .combo-node')).toHaveText(['M1', 'Q']);
});

test('a hostile label or step is escaped', async ({ page }) => {
    await boot(page);
    const hostile = '"><img src=x onerror="window.__xss=1">';
    await render(page, [{ type: 'combo', sequence: ['M1'], notations: [{ label: hostile, sequence: [hostile] }] }]);
    const route = page.locator('#render-host .combo-has-notations');
    await route.click();
    expect(await page.evaluate(() => window.__xss), 'no handler ran').toBeUndefined();
    expect(await page.locator('#render-host img').count()).toBe(0);
    // The positive form: the text survived, escaped, as the step and the name.
    expect(await visibleRoute(page)).toEqual([hostile]);
    await expect(route).toHaveAttribute('title', `Notation 2 of 2: ${hostile}. Click the route to switch.`);
});

test('dragging across the route to copy it does not switch it', async ({ page }) => {
    await boot(page);
    await render(page, [STYLED]);
    const nodes = page.locator('#render-host .combo-has-notations .combo-node');
    const first = await nodes.nth(0).boundingBox();
    const last = await nodes.nth(2).boundingBox();

    await page.mouse.move(first.x + 1, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(last.x + last.width - 1, last.y + last.height / 2, { steps: 8 });
    await page.mouse.up();

    expect(await page.evaluate(() => String(window.getSelection())), 'the drag really selected text').not.toBe('');
    expect(await visibleRoute(page)).toEqual(['M1', 'Uppercut', 'Murmurate']);
});

test('a Combo Row in a table switches the same way', async ({ page }) => {
    await boot(page);
    await page.evaluate((styled) => {
        const host = document.createElement('div');
        host.id = 'render-host';
        host.innerHTML = '<table><tbody></tbody></table>';
        document.body.appendChild(host);
        window.renderComboTableBody(host.querySelector('tbody'),
            [{ sequence: styled.sequence, notations: styled.notations }], window.COMBO_COLUMNS, null);
    }, STYLED);
    await page.locator('#render-host .combo-cell-sequence .combo-has-notations').click();
    expect(await visibleRoute(page)).toEqual(['LMB', 'Space', '2']);
});

// --- THE REVIEW SCREENS ---

test('a review screen shows every style at once, named, and a click there changes nothing', async ({ page }) => {
    // A reviewer must never have to click to find a changed route, and must
    // not change their own reading choice by clicking in a diff.
    await boot(page);
    await render(page, [STYLED], 'diff-inline-target');
    const route = page.locator('#render-host .combo-has-notations');

    const shown = await page.evaluate(() => [...document.querySelectorAll('#render-host .combo-notation')]
        .map(s => ({
            painted: s.getClientRects().length > 0 || [...s.children].some(c => c.getClientRects().length > 0),
            name: s.querySelector('.combo-notation-name').textContent,
            nameShown: s.querySelector('.combo-notation-name').getClientRects().length > 0,
        })));
    expect(shown.map(s => s.painted)).toEqual([true, true, true]);
    expect(shown.map(s => s.name)).toEqual(['Route', 'Keyboard', 'Slots']);
    expect(shown.map(s => s.nameShown)).toEqual([true, true, true]);

    await route.click();
    expect(await page.evaluate(() => localStorage.getItem('dsl-combo-notation'))).toBeNull();
    await expect(route).toHaveAttribute('data-notation-active', '0');
});

test('a changed style is marked in the diff, and its markers never land in an attribute', async ({ page }) => {
    // resolveDiffMarkers rewrites a container's innerHTML as a string. A
    // marker left in the title attribute would put <ins class="diff-add"> there,
    // and its quotes would end the attribute and break everything after it.
    //
    // The review queue's own pair, diffTextLCS and resolveDiffMarkers from
    // js/admin-diff.js, loaded onto a rendered page. edit.html does not load
    // that file, and its own diffTextLCS still emits tags (see the devlog).
    await boot(page);
    await page.addScriptTag({ url: '/js/admin-diff.js' });
    const result = await page.evaluate(() => {
        const oldList = [{ label: 'Keyboard', sequence: ['LMB', 'Space'] }];
        const newList = [{ label: 'Keys', sequence: ['LMB', 'Shift'] }];
        const block = { type: 'combo', sequence: ['M1', 'Q'], notations: window.diffComboNotations(oldList, newList) };
        const host = document.createElement('div');
        host.className = 'diff-inline-target';
        host.innerHTML = window.generateHTMLForBlocks([block], '');
        document.body.appendChild(host);
        window.resolveDiffMarkers(host);
        const route = host.querySelector('.combo-has-notations');
        return {
            styles: host.querySelectorAll('.combo-notation').length,
            stepAdded: [...host.querySelectorAll('.combo-notation ins.diff-add')].map(n => n.textContent).join(''),
            nameMarked: !!host.querySelector('.combo-notation-name ins, .combo-notation-name del'),
            attrs: [route.getAttribute('title'), route.getAttribute('aria-label'),
                ...[...host.querySelectorAll('.combo-notation')].map(s => s.getAttribute('data-notation-label'))],
        };
    });

    expect(result.styles, 'the markup is intact: both styles are still there').toBe(2);
    expect(result.stepAdded).toContain('Shift');
    expect(result.nameMarked, 'the renamed label is marked where it is visible').toBe(true);
    for (const attr of result.attrs) expect(attr).not.toMatch(/[<>\u0011-\u0014]/);
});

test('both review screens diff styles, on the Combo Block, the Combo Card and each card section', () => {
    // Neither screen can be rendered here with a real revision, and each keeps
    // its own copy of the block diff. Derived from the source, so a copy that
    // forgets styles fails here instead of in front of a reviewer.
    const missing = [];
    for (const file of ['js/admin-preview.js', 'js/editor-sync.js']) {
        const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
        const blocks = (src.match(/b\.notations = window\.diffComboNotations\(oldB\.notations, newB\.notations\)/g) || []).length;
        if (blocks !== 2) missing.push(`${file} :: Combo Block and Combo Card (found ${blocks} of 2)`);
        if (!/b\.sections\[j\]\.notations = window\.diffComboNotations\(oSec\.notations, nSec\.notations\)/.test(src)) {
            missing.push(`${file} :: card section`);
        }
    }
    expect(missing).toEqual([]);
});

// --- THE EDITOR: FOUR SURFACES, ONE HELPER ---

test('all four editor surfaces offer styles, through the one shared helper', () => {
    // The Combo Card's two editors have drifted three times; "one surface was
    // forgotten" is not something a rendering test of any one surface can see.
    const blocks = fs.readFileSync(path.join(ROOT, 'js', 'editor-blocks.js'), 'utf8');
    const tabs = fs.readFileSync(path.join(ROOT, 'js', 'editor-tabs.js'), 'utf8');

    expect(blocks, 'Combo Block form, comma separated like its route').toMatch(/comboNotationFieldsHTML\(block, \{ lines: false \}\)/);
    expect(blocks, 'Combo Card block form').toMatch(/comboNotationFieldsHTML\(card, \{ lines: true \}\)/);
    expect(tabs, 'Combos/Techs card editor').toMatch(/comboNotationFieldsHTML\(target, \{ lines: true \}\)/);
    expect(tabs, 'Combo Row modal').toMatch(/comboNotationFieldsHTML\(row, \{ lines: true \}\)/);
    // And the writes go through the shared rules, not a local copy.
    expect(tabs).toMatch(/applyComboNotationInput\(target, input\)/);
    expect(tabs).toMatch(/applyComboNotationInput\(row, input\)/);
    expect(tabs).toMatch(/applyComboNotationClick\(target, btn\)/);
    expect(tabs).toMatch(/applyComboNotationClick\(row, btn\)/);
});

test('Combo Block: adding a style asks for its name first, then writes both fields', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await editor(page, [{ type: 'combo', sequence: ['M1', 'Q'], damage: '' }]);

    await page.click('[data-nstyle-add]');
    // The owner's "they have to fill in a new field": the new name, focused.
    await expect(page.locator('[data-nstyle-label="0"]')).toBeFocused();
    await page.keyboard.type('Keyboard');
    await page.fill('[data-nstyle-route="0"]', 'LMB, 1, ');

    const block = await page.evaluate(() => window.getActiveBlocks()[0]);
    expect(block.notations).toEqual([{ label: 'Keyboard', sequence: ['LMB', '1'] }]);
    // These fields carry no data-field, and the general input handler writes
    // target[data-field]. Stopped before it, so no junk key is stored.
    expect(Object.keys(block)).not.toContain('null');

    await page.click('[data-nstyle-remove="0"]');
    const after = await page.evaluate(() => window.getActiveBlocks()[0]);
    expect(Object.keys(after), 'removing the last style leaves the block as it was').not.toContain('notations');
    expect(errors).toEqual([]);
});

test('Combo Card block form: a style in Multiple Sections belongs to the section on screen', async ({ page }) => {
    await editor(page, [{
        type: 'theorybox', title: 'Card', multiSections: true, content: [],
        sections: [
            { label: 'One', title: 'One', sequence: ['M1'], content: [] },
            { label: 'Two', title: 'Two', sequence: ['M1', 'Q'], content: [] },
        ],
    }]);
    await page.click('[data-cardsec="1"]');
    await page.click('[data-nstyle-add]');
    await page.fill('[data-nstyle-label="0"]', 'Keys');
    await page.fill('[data-nstyle-route="0"]', 'LMB\n\nQ');

    const card = await page.evaluate(() => window.getActiveBlocks()[0]);
    expect(card.sections[1].notations).toEqual([{ label: 'Keys', sequence: ['LMB', 'Q'] }]);
    expect(card.sections[0].notations).toBeUndefined();
    expect(card.notations).toBeUndefined();
});

test('the Multiple Sections switch carries styles both ways, and adds none', async ({ page }) => {
    // Styles live beside the route, so they travel with it, or they would be
    // stranded behind the switch the way the route used to be.
    await editor(page, []);
    const r = await page.evaluate(() => {
        const card = { type: 'theorybox', title: 'x', sequence: ['M1'], notations: [{ label: 'K', sequence: ['Q'] }], content: [] };
        window.seedCardSections(card, true);
        const seeded = JSON.parse(JSON.stringify(card.sections[0].notations));
        card.sections[0].notations[0].sequence = ['E'];
        window.seedCardSections(card, false);

        const plain = { type: 'theorybox', title: 'y', sequence: ['M1'], content: [] };
        window.seedCardSections(plain, true);
        const plainSection = Object.keys(plain.sections[0]);
        window.seedCardSections(plain, false);
        return { seeded, back: card.notations, plainSection, plainCard: Object.keys(plain) };
    });
    expect(r.seeded).toEqual([{ label: 'K', sequence: ['Q'] }]);
    expect(r.back, 'the section on screen is copied back up').toEqual([{ label: 'K', sequence: ['E'] }]);
    expect(r.plainSection).not.toContain('notations');
    expect(r.plainCard).not.toContain('notations');
});

test('the Combos-tab card editor edits styles too, into the card on screen', async ({ page }) => {
    // The second Combo Card editor, driven for real.
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({ width: 1400, height: 950 });
    await page.goto(COMBOS, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.locator('[onclick*="addDocumentGroup"]').click();
    await page.waitForTimeout(400);
    await page.locator('#combo-card-add').click();
    await page.waitForTimeout(400);

    await page.fill('[data-card-field="sequence"]', 'M1\nQ');
    await page.click('#combo-card-body [data-nstyle-add]');
    await expect(page.locator('#combo-card-body [data-nstyle-label="0"]')).toBeFocused();
    await page.keyboard.type('Keyboard');
    await page.fill('#combo-card-body [data-nstyle-route="0"]', 'LMB\nQ');
    await page.waitForTimeout(400);

    const card = await page.evaluate(() => {
        const idx = parseInt(String(window.currentDocSection).replace('group-', ''), 10);
        return window.currentEditorDescData.comboGroups[idx].content[window.currentDocCardIndex];
    });
    expect(card.notations).toEqual([{ label: 'Keyboard', sequence: ['LMB', 'Q'] }]);
    await expect(page.locator('#tab-combos .combo-has-notations'), 'the live preview has the toggle').not.toHaveCount(0);
    expect(errors).toEqual([]);
});

test('the Combo Row modal edits styles too, and reopens on the same row', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({ width: 1400, height: 950 });
    await page.goto(COMBOS, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.locator('#combos-nav-list').click();
    await page.waitForTimeout(250);
    await page.locator('#combo-table-add').click();
    await page.waitForTimeout(250);
    await page.locator('#combo-table-name').fill('Zzq Starters');
    await page.locator('#combo-row-add').click();
    await page.waitForTimeout(350);

    await page.locator('[data-combo-field="sequence"]').fill('M1\nMURMURATE');
    await page.click('#combo-row-modal [data-nstyle-add]');
    await expect(page.locator('#combo-row-modal [data-nstyle-label="0"]')).toBeFocused();
    await page.keyboard.type('Slots');
    await page.fill('#combo-row-modal [data-nstyle-route="0"]', 'M1\nS2');
    await page.waitForTimeout(400);

    const row = await page.evaluate(() =>
        (window.currentEditorDescData.comboList || [])[window.currentDocTableIndex].rows[0]);
    expect(row.sequence, 'the route typed before the modal re-rendered survives it').toEqual(['M1', 'MURMURATE']);
    expect(row.notations).toEqual([{ label: 'Slots', sequence: ['M1', 'S2'] }]);
    await expect(page.locator('#tab-combos .combo-has-notations'), 'the live preview has the toggle').not.toHaveCount(0);
    expect(errors).toEqual([]);
});
