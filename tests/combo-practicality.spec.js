// Practicality on combos - v1.0 Part 2, P1 (owner, 2026-10-08).
//
// "Add a "Practicality" column to the Combo/Tech List", "Add a "Practicality"
// stat to a Combo/Tech Card", "You can enter anything into the "Practicality"
// stat". Free text. The column sits after Difficulty (the owner's pick) and,
// like Setup and Controls, appears only once a combo in the tab has a value, so
// no table grows a column of dashes.
//
// A Combo Card has TWO editors and they have drifted three times (CLAUDE.md),
// so both are driven here. The reviewer diff and the draft sync cannot be
// rendered in a test, so those two are read from the source.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGE = '/characters/Boomcat/index.html';
const BLOCK_EDITOR = '/edit.html?char=testchar&tab=overview';
const COMBOS_EDITOR = '/edit.html?char=boomcat&type=character&tab=combos';

// The page renders its own Combos tab once its data arrives. Waiting for the
// network to settle first keeps that render from landing on top of ours.
async function boot(page) {
    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.renderDocumentTab === 'function'
        && typeof window.generateHTMLForBlocks === 'function', { timeout: 45000 });
    await page.waitForTimeout(500);
}

async function renderList(page, rows) {
    await page.evaluate((r) => {
        window.renderDocumentTab('combos', { comboList: [{ starter: 'Zeta Starters', rows: r }] });
    }, rows);
}

const headers = (page) => page.evaluate(() =>
    [...document.querySelectorAll('#tab-combos .combo-table thead th')].map(th => th.textContent.trim()));

const row = (extra) => ({ sequence: ['M1', 'M1'], damage: '20', difficulty: 'Easy', ...extra });

test('the column sits after Difficulty once a combo has a value, and sorts', async ({ page }) => {
    await boot(page);
    await renderList(page, [row({ practicality: 'Low' }), row({ practicality: 'High' })]);

    const cols = await headers(page);
    expect(cols).toContain('Difficulty');
    expect(cols.indexOf('Practicality'), 'right after Difficulty').toBe(cols.indexOf('Difficulty') + 1);

    const cells = () => page.locator('#tab-combos .combo-cell-practicality').allTextContents();
    expect((await cells()).map(s => s.trim())).toEqual(['Low', 'High']);

    // Through the real controls: the tab's own button, then the header, which
    // is the sort button.
    await page.click('#nav-combos');
    await page.click('#tab-combos th[data-sort-field="practicality"]');
    expect((await cells()).map(s => s.trim())).toEqual(['High', 'Low']);
});

test('a tab where no combo has one shows no Practicality column', async ({ page }) => {
    await boot(page);
    await renderList(page, [row({}), row({ practicality: '   ' })]);

    const cols = await headers(page);
    // The positive half first, so the absence below is about this table.
    expect(cols).toEqual(expect.arrayContaining(['Combo', 'Damage', 'Difficulty']));
    expect(cols).not.toContain('Practicality');
});

test('a card shows its Practicality beside Difficulty, and each section its own', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(() => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        host.innerHTML = window.generateHTMLForBlocks([
            { type: 'theorybox', title: 'Zeta Loop', difficulty: 'Hard', practicality: 'Only in corner', sequence: ['M1'] },
            { type: 'theorybox', title: 'Zeta Plain', difficulty: 'Easy', sequence: ['M1'] },
            {
                type: 'theorybox', title: 'Zeta Variants', multiSections: true, sections: [
                    { title: 'Zeta A', practicality: 'Anything at all, 7/10' },
                    { title: 'Zeta B' },
                ],
            },
        ], '');
        const cards = [...host.querySelectorAll('.theorybox')];
        const chip = (card) => card.querySelector('.theorybox-practicality');
        return {
            loop: chip(cards[0]) && chip(cards[0]).textContent,
            beside: chip(cards[0]) && chip(cards[0]).previousElementSibling.className,
            plainTitle: cards[1].querySelector('.theorybox-title').textContent,
            plain: !!chip(cards[1]),
            a: chip(cards[2]) && chip(cards[2]).textContent,
            bTitle: cards[3].querySelector('.theorybox-title').textContent,
            b: !!chip(cards[3]),
        };
    });

    expect(out.loop).toBe('Practicality: Only in corner');
    expect(out.beside, 'right after the Difficulty chip').toContain('theorybox-difficulty');
    expect(out.plainTitle).toBe('Zeta Plain');
    expect(out.plain, 'a card without one has no chip').toBe(false);
    expect(out.a).toBe('Practicality: Anything at all, 7/10');
    expect(out.bTitle).toBe('Zeta B');
    expect(out.b, 'a section without one has no chip').toBe(false);
});

test('what is typed into Practicality is shown as text, never parsed', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await boot(page);

    const hostile = '<img src=x onerror="window.__practicality=1">';
    await renderList(page, [row({ practicality: hostile })]);
    const card = await page.evaluate((h) => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        host.innerHTML = window.generateHTMLForBlocks([{ type: 'theorybox', title: 'Zeta', practicality: h }], '');
        return host.querySelector('.theorybox-practicality').textContent;
    }, hostile);
    await page.waitForTimeout(300);

    expect(card).toBe(`Practicality: ${hostile}`);
    expect((await page.locator('#tab-combos .combo-cell-practicality').textContent()).trim()).toBe(hostile);
    expect(await page.evaluate(() => window.__practicality)).toBeUndefined();
    expect(errors).toEqual([]);
});

test('the Combo Card block form writes Practicality, and the switch carries it', async ({ page }) => {
    await page.goto(BLOCK_EDITOR, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.initStrategyBlockBuilder === 'function', { timeout: 15000 });
    await page.evaluate(() => {
        document.body.innerHTML = '<div id="block-host"></div>';
        window.activeAccordionPath = [];
        window.initStrategyBlockBuilder('block-host', [{ type: 'theorybox', title: 'Zeta', sequence: ['M1'] }]);
        (window.getActiveBlocks() || []).forEach(blk => window.setEditorBlockExpanded(blk, true));
        window.renderBlockList();
    });

    await page.fill('[data-field="practicality"]', 'Situational');
    expect(await page.evaluate(() => window.getActiveBlocks()[0].practicality)).toBe('Situational');

    // Multiple Sections seeds its first section from the card, so a value
    // typed before the switch is still on screen after it.
    await page.check('[data-field="multiSections"]');
    await expect(page.locator('[data-cardsec]')).toHaveCount(1);
    expect(await page.inputValue('[data-field="practicality"]')).toBe('Situational');
    expect(await page.evaluate(() => window.getActiveBlocks()[0].sections[0].practicality)).toBe('Situational');
});

test('a card inside a Combos group has the field, and the preview shows it', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.setViewportSize({ width: 1400, height: 950 });
    await page.goto(COMBOS_EDITOR, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    // The card editor exists only inside an open group: the same route
    // combo-card-sections.spec.js takes.
    await page.locator('[onclick*="addDocumentGroup"]').click();
    await page.waitForTimeout(400);
    await page.locator('#combo-card-add').click();
    await page.waitForTimeout(400);

    await page.fill('[data-card-field="practicality"]', 'Zeta-practical-41');
    await expect(page.locator('.theorybox-practicality', { hasText: 'Practicality: Zeta-practical-41' }).first())
        .toBeVisible();
    expect(errors).toEqual([]);
});

test('the row form offers Practicality right after Difficulty', async ({ page }) => {
    // The row modal draws one input per field in comboRowFields, which is
    // derived from COMBO_COLUMNS, so the column added there reaches the form.
    await page.goto(COMBOS_EDITOR, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.comboRowFields === 'function', { timeout: 15000 });
    const fields = await page.evaluate(() => window.comboRowFields().map(f => f.field));
    expect(fields.indexOf('practicality')).toBe(fields.indexOf('difficulty') + 1);
});

test('the reviewer diff and the draft sync both show a changed Practicality', () => {
    // Without these a reviewer sees a card unchanged while its Practicality
    // was rewritten. Read from the source, as for every other card field.
    const missing = [];
    for (const file of ['js/editor-sync.js', 'js/admin-preview.js']) {
        const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
        if (!/\bb\.practicality = window\.diffTextLCS/.test(src)) missing.push(`${file} :: card`);
        if (!/b\.sections\[j\]\.practicality = window\.diffTextLCS/.test(src)) missing.push(`${file} :: section`);
    }
    expect(missing).toEqual([]);
});
