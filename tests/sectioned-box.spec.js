// The Section Box (SectionedBox) - v0.19 C3.
//
// The owner's own item, carried from v0.16 through v0.17 and v0.18. Their
// wording, from devlogs/V0.16-DEVLOG.md: a box with a title, a row of
// switchable tabs and the current tab's content, holding an Introduction,
// Sections, and Contents in Sections - the Introduction and each section's
// contents using "the Accordion recursive logic to hold other Blocks". Inside a
// Combos/Techs group it wears a Combo Card's wrapper; everywhere else the
// wrapper is removed so it does not produce wrapper-on-wrapper styling.
//
// Two of the tests below exist because of bugs the owner reported against the
// ACCORDION on 2026-09-20, fixed on this branch, which this block would
// otherwise have reproduced on day one - they asked for exactly that:
//
//   * a container holding blocks must not be a flex context, because media
//     alignment is `float` and float is ignored on a flex item
//   * which tab is open must not live only in the DOM, because the editor
//     repaints the preview on every keystroke
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGE = '/characters/Boomcat/index.html';

const BOX = {
    type: 'sectionedbox',
    title: 'Neutral',
    intro: [{ type: 'paragraph', content: 'Read this first.' }],
    sections: [
        { title: 'Poking', content: [{ type: 'paragraph', content: 'poke content' }] },
        { title: 'Whiff Punish', content: [{ type: 'paragraph', content: 'punish content' }] },
    ],
};

async function boot(page) {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.generateHTMLForBlocks === 'function', { timeout: 45000 });
}

async function render(page, blocks, contextClass = '') {
    await page.evaluate(({ b, ctx }) => {
        let host = document.getElementById('render-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'render-host';
            document.body.appendChild(host);
        }
        host.innerHTML = window.generateHTMLForBlocks(b, ctx);
    }, { b: blocks, ctx: contextClass });
}

// The site count is the whole reason a new block type is expensive here, and
// two of the seven only ever run inside a reviewer's session or a draft sync.
// Derived from the source, exactly as theorybox.spec.js does it, because those
// two cannot be reached by rendering anything.
test('all seven sites handle the block, or it breaks somewhere invisible', () => {
    const sites = {
        'js/editor-blocks.js': [
            /sectionedbox: \{ type: 'sectionedbox'/,   // 1. registry default shape
            /types: \[[^\]]*'sectionedbox'/,            // 2. offered by the picker
            /sectionedbox: '[^']+'/,                    // 3. has a human-readable name
            /block\.type === 'sectionedbox'/,           // 4. the editor form
        ],
        'js/description.js': [/block\.type === 'sectionedbox'/],   // 5. reader
        'js/admin-preview.js': [/b\.type === 'sectionedbox'/],     // 6. reviewer preview
        'js/editor-sync.js': [/b\.type === 'sectionedbox'/],       // 7. draft sync
    };

    const missing = [];
    for (const [file, patterns] of Object.entries(sites)) {
        const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
        patterns.forEach(p => { if (!p.test(src)) missing.push(`${file} :: ${p}`); });
    }
    expect(missing, 'a block type handled at fewer than seven sites fails silently').toEqual([]);
});

test('it renders a title, an introduction and a tab per section', async ({ page }) => {
    await boot(page);
    await render(page, [BOX]);

    const out = await page.evaluate(() => ({
        title: document.querySelector('#render-host .sbox-title').textContent,
        intro: document.querySelector('#render-host .sbox-intro').textContent.trim(),
        tabs: [...document.querySelectorAll('#render-host .sbox-tab')].map(t => t.textContent),
        activeTab: document.querySelector('#render-host .sbox-tab.is-active').textContent,
        visiblePanels: [...document.querySelectorAll('#render-host .sbox-panel')]
            .filter(p => getComputedStyle(p).display !== 'none')
            .map(p => p.textContent.trim()),
    }));

    expect(out.title).toBe('Neutral');
    expect(out.intro).toBe('Read this first.');
    expect(out.tabs).toEqual(['Poking', 'Whiff Punish']);
    expect(out.activeTab, 'the first tab is the default').toBe('Poking');
    expect(out.visiblePanels, 'exactly one panel is shown').toEqual(['poke content']);
});

test('clicking a tab switches which content is shown', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await boot(page);
    await render(page, [BOX]);

    await page.click('#render-host .sbox-tab:nth-child(2)');

    const out = await page.evaluate(() => ({
        activeTab: document.querySelector('#render-host .sbox-tab.is-active').textContent,
        visible: [...document.querySelectorAll('#render-host .sbox-panel')]
            .filter(p => getComputedStyle(p).display !== 'none')
            .map(p => p.textContent.trim()),
    }));

    expect(errors).toEqual([]);
    expect(out.activeTab).toBe('Whiff Punish');
    expect(out.visible).toEqual(['punish content']);
});

test('the wrapper is worn in a document tab and dropped everywhere else', async ({ page }) => {
    await boot(page);

    // Asked of the two real contexts rather than of a flag: 'combos' is what
    // renderDocumentTab passes for a Combos/Techs group, and '' is an ordinary
    // block list. The switch is derived from getDocumentSections, so a third
    // document tab added later gets the wrapper without anyone editing this.
    await render(page, [BOX], 'combos');
    const boxed = await page.evaluate(() =>
        document.querySelector('#render-host .sbox').classList.contains('sbox-boxed'));

    await render(page, [BOX], '');
    const bare = await page.evaluate(() =>
        document.querySelector('#render-host .sbox').classList.contains('sbox-boxed'));

    expect(boxed, 'inside a Combos/Techs group it matches the Combo Card beside it').toBe(true);
    expect(bare, 'elsewhere it is not a card inside a card').toBe(false);
});

test('a panel is not a flex context, so float alignment still works', async ({ page }) => {
    await boot(page);
    await render(page, [{
        ...BOX,
        sections: [{
            title: 'Media',
            content: [{ type: 'image', src: '/medias/portraits/boomcat.webp', alt: 'right', align: 'right', width: '25%' }],
        }],
    }]);
    await page.waitForTimeout(400);

    // The accordion shipped this bug for months: .wiki-accordion-body was a
    // flex column, and a flex item's float is ignored, so Right rendered hard
    // left. Stated as the cause rather than only as the symptom, so the next
    // person reaching for `display:flex; gap` here fails loudly.
    const out = await page.evaluate(() => {
        const panel = document.querySelector('#render-host .sbox-panel.is-active');
        const img = panel.querySelector('.wiki-media');
        const r = img.getBoundingClientRect();
        const pr = panel.getBoundingClientRect();
        return {
            display: getComputedStyle(panel).display,
            left: Math.round(r.left - pr.left),
            right: Math.round(pr.right - r.right),
            escapes: Math.round(r.bottom) > Math.round(pr.bottom),
        };
    });

    expect(out.display).not.toBe('flex');
    expect(out.left, 'right-aligned media sits in the right half').toBeGreaterThan(out.right);
    expect(out.escapes, 'and the float does not hang out of its own panel').toBe(false);
});

test('the open tab survives the preview repaint', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
        const host = document.createElement('div');
        host.id = 'preview-host';
        document.body.appendChild(host);
    });

    const repaint = (box) => page.evaluate((b) => {
        window.populateTextSection('preview-host', '', [b], '');
    }, box);

    await repaint(BOX);
    await page.click('#preview-host .sbox-tab:nth-child(2)');

    // Every keystroke in the editor does this.
    await repaint(BOX);

    const active = await page.evaluate(() =>
        document.querySelector('#preview-host .sbox-tab.is-active').textContent);

    expect(active, 'the author stays on the tab they were editing').toBe('Whiff Punish');
});

test('nothing an author writes into a box is parsed as markup', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await boot(page);
    await render(page, [{
        type: 'sectionedbox',
        title: '<img src=x onerror="window.__PWN=1">',
        intro: [],
        sections: [{ title: '<img src=x onerror="window.__PWN=1">', content: [] }],
    }]);
    await page.waitForTimeout(300);

    const out = await page.evaluate(() => ({
        fired: !!window.__PWN,
        injected: document.querySelectorAll('#render-host img').length,
        // Asserted as SURVIVING ESCAPED rather than as "the substring is
        // absent", which would pass just as well if the field vanished.
        title: document.querySelector('#render-host .sbox-title').textContent,
        tab: document.querySelector('#render-host .sbox-tab').textContent,
    }));

    expect(errors).toEqual([]);
    expect(out.fired).toBe(false);
    expect(out.injected).toBe(0);
    expect(out.title).toContain('<img');
    expect(out.tab).toContain('<img');
});

// --- THE EDITOR SIDE ---

const EDITOR = '/edit.html?char=testchar&tab=overview';

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

test('the editor offers the block under its real name', async ({ page }) => {
    await editor(page, []);
    // Drives the generated menu rather than asserting the declaration, which
    // the seven-sites test above already pins - between the two, both the
    // declaration and the button it produces are covered.
    await page.click('#btn-toggle-add-menu');
    const offered = await page.evaluate(() =>
        [...document.querySelectorAll('.add-block-btn')].map(b => ({
            type: b.getAttribute('data-type'), label: b.textContent.trim(),
        })).find(b => b.type === 'sectionedbox'));

    // The LABEL as well as the type: a block missing from the label map still
    // works and shows up as a raw uppercase key, which is the exact confusion
    // v0.16 fine-tuning 1 existed to end.
    expect(offered, 'the picker offers it at all').toBeTruthy();
    expect(offered.label).toBe('+ Section Box');
});

test('sections are add and remove, and the box renders a tab for each', async ({ page }) => {
    await editor(page, [JSON.parse(JSON.stringify(BOX))]);

    await expect(page.locator('[data-sbox-title]')).toHaveCount(2);
    await page.click('[data-sbox-add]');
    await expect(page.locator('[data-sbox-title]')).toHaveCount(3);

    await page.click('[data-sbox-remove="0"]');
    const titles = await page.evaluate(() =>
        window.getActiveBlocks()[0].sections.map(s => s.title));

    expect(titles, 'the one removed is the one named, not the last').toEqual(['Whiff Punish', 'Section 3']);
});

test('the introduction and each section are edited as blocks, like an accordion', async ({ page }) => {
    await editor(page, [JSON.parse(JSON.stringify(BOX))]);

    // Into the introduction.
    await page.click('[data-sbox-intro]');
    let state = await page.evaluate(() => ({
        path: window.activeAccordionPath,
        blocks: window.getActiveBlocks().map(b => b.content),
        banner: document.querySelector('.accordion-back-title')?.textContent.trim(),
    }));
    expect(state.blocks, 'the introduction is what is on screen').toEqual(['Read this first.']);
    expect(state.banner).toContain('Introduction');

    // Back out, then into the SECOND section - an index alone could not say
    // which of a Section Box's several arrays the author meant.
    await page.click('.accordion-back-banner button');
    await page.click('[data-sbox-edit="1"]');
    state = await page.evaluate(() => ({
        blocks: window.getActiveBlocks().map(b => b.content),
        banner: document.querySelector('.accordion-back-title')?.textContent.trim(),
    }));

    expect(state.blocks).toEqual(['punish content']);
    expect(state.banner).toContain('Whiff Punish');
});

test('a hostile box title is not markup in the back banner', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await editor(page, [{
        type: 'sectionedbox',
        title: '<img src=x onerror="window.__PWN=1">',
        intro: [],
        sections: [{ title: 'ok', content: [] }],
    }]);
    await page.click('[data-sbox-intro]');
    await page.waitForTimeout(200);

    // The banner interpolated this title straight into insertAdjacentHTML
    // before C3 - an unescaped sink on every nested edit, found while
    // extending that walk rather than by looking for it.
    const out = await page.evaluate(() => ({
        fired: !!window.__PWN,
        injected: document.querySelectorAll('.accordion-back-banner img').length,
        text: document.querySelector('.accordion-back-title').textContent,
    }));

    expect(errors).toEqual([]);
    expect(out.fired).toBe(false);
    expect(out.injected).toBe(0);
    expect(out.text).toContain('<img');
});

test('a hostile ACCORDION title is not markup in the banner either', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    // The banner builds its heading in two branches - with a part label for a
    // Section Box, without one for every container that came before it. A first
    // attempt to falsify the escaping broke only the branch the Section Box
    // test does NOT take, and nothing went red. Both are pinned now.
    await editor(page, [{
        type: 'accordion',
        title: '<img src=x onerror="window.__PWN=1">',
        content: [{ type: 'paragraph', content: 'inner' }],
    }]);
    await page.click('.accordion-inner-block-wrapper button');
    await page.waitForTimeout(200);

    const out = await page.evaluate(() => ({
        fired: !!window.__PWN,
        injected: document.querySelectorAll('.accordion-back-banner img').length,
        text: document.querySelector('.accordion-back-title').textContent,
    }));

    expect(errors).toEqual([]);
    expect(out.fired).toBe(false);
    expect(out.injected).toBe(0);
    expect(out.text).toContain('<img');
});
