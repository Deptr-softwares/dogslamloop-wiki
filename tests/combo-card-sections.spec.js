// Combo Card: Multiple Sections - v0.19 C3b (owner, 2026-09-20).
//
// "Can you reuse the section box code to make it also work with combo card? In
// the site, it will appear as a toggle that goes 'Multiple Sections'."
//
// Their reference is a Dustloop-style combo page: a row of tabs - Preface, In
// Corner 6H, Midscreen 2D, Midscreen 5H - where each tab is a WHOLE variant
// with its own route, damage, difficulty, clip and write-up. 246 damage on one
// tab, 112 on another. So the row switches CARDS, not the text inside a card.
//
// REUSE, not a second implementation. The tab row, the delegated click
// listener, the CSS and the repaint restore are all the Section Box's, keyed on
// `.sbox-tabbed`; the card markup is one function shared by the single and
// tabbed paths. A second copy of either would be two things to keep in step,
// and this file exists partly to keep them one.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGE = '/characters/Boomcat/index.html';
const EDITOR = '/edit.html?char=testchar&tab=overview';

// Modelled on the owner's screenshots, including a prose-only Preface tab and
// a tab label that differs from the card heading below it.
const CARD = {
    type: 'theorybox',
    title: 'Ky Combos',
    multiSections: true,
    sections: [
        { label: 'Preface', title: 'Before you start', content: [{ type: 'paragraph', content: 'Notation notes.' }] },
        {
            label: 'In Corner 6H',
            title: 'Optimized 6H Counterhit Corner Starter',
            oneliner: 'Utilize stagger pressure to catch mashing!',
            difficulty: 'Easy',
            sequence: ['CH 6H', '236H', '6H'],
            damage: '246',
            content: [{ type: 'paragraph', content: 'corner explanation' }],
        },
        {
            label: 'Midscreen 5H',
            title: 'Optimized 5H Counterhit Midscreen Oki Setup',
            difficulty: 'Easy',
            sequence: ['CH 5H', '214K', '2K'],
            damage: '112',
            content: [{ type: 'paragraph', content: 'midscreen explanation' }],
        },
    ],
};

async function boot(page) {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.generateHTMLForBlocks === 'function', { timeout: 45000 });
}

async function render(page, blocks) {
    await page.evaluate((b) => {
        let host = document.getElementById('render-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'render-host';
            document.body.appendChild(host);
        }
        host.innerHTML = window.generateHTMLForBlocks(b, '');
    }, blocks);
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

test('the switch is off by default and a card is still one card', async ({ page }) => {
    await boot(page);
    await render(page, [{
        type: 'theorybox', title: 'Corner BnB', sequence: ['M1', 'M1'], damage: '38',
        content: [{ type: 'paragraph', content: 'plain' }],
    }]);

    const out = await page.evaluate(() => ({
        tabs: document.querySelectorAll('#render-host .sbox-tab').length,
        cards: document.querySelectorAll('#render-host .theorybox').length,
        title: document.querySelector('#render-host .theorybox-title').textContent,
    }));

    expect(out.tabs, 'no tab row on an ordinary card').toBe(0);
    expect(out.cards).toBe(1);
    expect(out.title).toBe('Corner BnB');
});

test('each tab is a whole variant, with its own numbers', async ({ page }) => {
    await boot(page);
    await render(page, [CARD]);

    const out = await page.evaluate(() => {
        const panels = [...document.querySelectorAll('#render-host .sbox-panel')];
        return {
            tabs: [...document.querySelectorAll('#render-host .sbox-tab')].map(t => t.textContent),
            // One card per tab, each with its own heading and damage.
            headings: panels.map(p => p.querySelector('.theorybox-title')?.textContent || null),
            damages: panels.map(p => p.querySelector('.combo-damage')?.textContent || null),
            shown: panels.filter(p => getComputedStyle(p).display !== 'none')
                .map(p => p.querySelector('.theorybox-title')?.textContent),
        };
    });

    expect(out.tabs).toEqual(['Preface', 'In Corner 6H', 'Midscreen 5H']);
    // The tab label and the card heading are DIFFERENT strings, which is the
    // detail the owner's reference turns on.
    expect(out.headings[1]).toBe('Optimized 6H Counterhit Corner Starter');
    expect(out.damages[1]).toBe('246');
    expect(out.damages[2]).toBe('112');
    expect(out.shown, 'the first tab is the default, and only it').toEqual(['Before you start']);
});

test('a prose-only section is a Preface tab, with no route or damage', async ({ page }) => {
    await boot(page);
    await render(page, [CARD]);

    // Every part of the card is already conditional, so a section with no
    // sequence renders as prose - which is what makes a Preface tab possible
    // without inventing a second block type for it.
    const preface = await page.evaluate(() => {
        const panel = document.querySelector('#render-host .sbox-panel[data-sbox-panel="0"]');
        return {
            route: !!panel.querySelector('.theorybox-route'),
            damage: !!panel.querySelector('.combo-damage'),
            text: panel.textContent.replace(/\s+/g, ' ').trim(),
        };
    });

    expect(preface.route).toBe(false);
    expect(preface.damage).toBe(false);
    expect(preface.text).toContain('Notation notes.');
});

test('clicking a tab switches to that variant', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await boot(page);
    await render(page, [CARD]);
    await page.click('#render-host .sbox-tab:nth-child(3)');

    const shown = await page.evaluate(() =>
        [...document.querySelectorAll('#render-host .sbox-panel')]
            .filter(p => getComputedStyle(p).display !== 'none')
            .map(p => p.querySelector('.combo-damage')?.textContent));

    expect(errors).toEqual([]);
    expect(shown).toEqual(['112']);
});

test('the tab row is the Section Box machinery, not a second copy', async ({ page }) => {
    await boot(page);
    await render(page, [CARD]);

    // Stated as a structural claim because it is the point of the request -
    // "reuse the section box code". Both rows carry `.sbox-tabbed`, which is
    // what the one click listener and the one repaint restore key off.
    const shared = await page.evaluate(() => {
        const wrap = document.querySelector('#render-host .theorybox-sections');
        return {
            tabbed: wrap.classList.contains('sbox-tabbed'),
            usesSboxTabs: !!wrap.querySelector('.sbox-tabs > .sbox-tab'),
            usesSboxPanels: !!wrap.querySelector('.sbox-panel'),
        };
    });

    expect(shared).toEqual({ tabbed: true, usesSboxTabs: true, usesSboxPanels: true });

    // And the card markup is one function: a tabbed card and a plain card
    // produce the same structure.
    const src = fs.readFileSync(path.join(ROOT, 'js', 'description.js'), 'utf8');
    expect(src, 'one card renderer, called by both paths')
        .toContain('function theoryboxCardHTML(');
});

test('the open tab survives the preview repaint', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
        const host = document.createElement('div');
        host.id = 'preview-host';
        document.body.appendChild(host);
    });

    const repaint = (c) => page.evaluate((b) => {
        window.populateTextSection('preview-host', '', [b], '');
    }, c);

    await repaint(CARD);
    await page.click('#preview-host .sbox-tab:nth-child(2)');
    await repaint(CARD);

    const active = await page.evaluate(() =>
        document.querySelector('#preview-host .sbox-tab.is-active').textContent);

    expect(active, 'inherited from the Section Box, not rebuilt for this block').toBe('In Corner 6H');
});

test('the reviewer diff and the draft sync both walk a card section', () => {
    // Neither runs anywhere a test can render: one is a reviewer's session, the
    // other a draft sync. Derived from the source, the way theorybox.spec.js
    // derives its seven sites, because the alternative is finding out from a
    // reviewer that the tabs looked unchanged while every combo was rewritten.
    const missing = [];
    for (const file of ['js/editor-sync.js', 'js/admin-preview.js']) {
        const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
        if (!/b\.sections\[j\]\.sequence\[k\] = window\.diffTextLCS/.test(src)) missing.push(`${file} :: route`);
        if (!/b\.sections\[j\]\.label = window\.diffTextLCS/.test(src)) missing.push(`${file} :: tab label`);
        if (!/b\.sections\[j\]\.content = applyInlineDiffToBlocks/.test(src)) missing.push(`${file} :: write-up`);
    }
    expect(missing).toEqual([]);
});

test('nothing an author types into a tab is parsed as markup', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await boot(page);
    await render(page, [{
        type: 'theorybox', multiSections: true,
        sections: [{ label: '<img src=x onerror="window.__PWN=1">', title: 'ok', content: [] }],
    }]);
    await page.waitForTimeout(300);

    const out = await page.evaluate(() => ({
        fired: !!window.__PWN,
        injected: document.querySelectorAll('#render-host img').length,
        label: document.querySelector('#render-host .sbox-tab').textContent,
    }));

    expect(errors).toEqual([]);
    expect(out.fired).toBe(false);
    expect(out.injected).toBe(0);
    expect(out.label, 'it survives ESCAPED rather than being dropped').toContain('<img');
});

// --- THE EDITOR SIDE ---

test('turning the switch on seeds the first section from the card', async ({ page }) => {
    await editor(page, [{
        type: 'theorybox', title: 'Corner BnB', damage: '38', sequence: ['M1', '2H'],
        content: [{ type: 'paragraph', content: 'existing write-up' }],
    }]);

    await page.check('[data-field="multiSections"]');

    // An author who has already written a combo must not find it stranded
    // behind a switch.
    const seeded = await page.evaluate(() => {
        const b = window.getActiveBlocks()[0];
        return {
            on: b.multiSections,
            count: b.sections.length,
            title: b.sections[0].title,
            damage: b.sections[0].damage,
            sequence: b.sections[0].sequence,
            content: b.sections[0].content.map(x => x.content),
        };
    });

    expect(seeded.on).toBe(true);
    expect(seeded.count).toBe(1);
    expect(seeded.title).toBe('Corner BnB');
    expect(seeded.damage).toBe('38');
    expect(seeded.sequence).toEqual(['M1', '2H']);
    expect(seeded.content).toEqual(['existing write-up']);
});

test("the card's fields edit the section on screen, not the card", async ({ page }) => {
    await editor(page, [JSON.parse(JSON.stringify(CARD))]);

    // Switch to the second tab in the editor strip, then type a damage value.
    await page.click('[data-cardsec="1"]');
    await page.fill('[data-field="damage"]', '999');

    const out = await page.evaluate(() => {
        const b = window.getActiveBlocks()[0];
        return {
            section1: b.sections[1].damage,
            section2: b.sections[2].damage,
            card: b.damage,
        };
    });

    expect(out.section1, 'the one on screen took it').toBe('999');
    expect(out.section2, 'and no other section did').toBe('112');
    expect(out.card || '', 'and not the card, which has no fields of its own now').toBe('');
});

test('sections add and remove, and the write-up descends into the right one', async ({ page }) => {
    await editor(page, [JSON.parse(JSON.stringify(CARD))]);

    await expect(page.locator('[data-cardsec]')).toHaveCount(3);
    await page.click('[data-cardsec-add]');
    await expect(page.locator('[data-cardsec]')).toHaveCount(4);

    // Back to the corner variant and into its write-up.
    await page.click('[data-cardsec="1"]');
    await page.click('[data-cardsec-edit]');

    const inside = await page.evaluate(() => ({
        blocks: window.getActiveBlocks().map(b => b.content),
        banner: document.querySelector('.accordion-back-title')?.textContent.trim(),
    }));

    expect(inside.blocks, 'the corner section, not the card and not another tab')
        .toEqual(['corner explanation']);
    expect(inside.banner).toContain('In Corner 6H');
});
