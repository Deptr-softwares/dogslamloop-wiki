// Combo Card names as headings, and styled names - v1.0 Part 2, P2 and P5
// (owner, 2026-10-08).
//
// "Combo Card name are now considered a Heading, and can be detected by the
// Anchor system (so you can link sections to a combo card within a page)",
// "Combo Card multiple names are considered their own heading", and the bug:
// "Combo Card names can't be styled with internalStyling.js". The owner chose
// to have the names listed in the contents too, under their group.
//
// An anchor is made twice: from the DOM (assignSectionAnchors) and from the
// data (collectSectionTargets, which feeds the link picker and the search
// index). Both are checked here, both ways, because a link the picker offers
// and the page does not render is a link that silently does nothing.
//
// The styled-name half found an older bug: the data side slugged the raw
// shortcodes, so "[b]Neutral[/b]" was offered as sec-b-neutral-b while the
// page had sec-neutral. 49 search-index entries pointed at nothing. The
// heading below is styled for that reason.
const { test, expect } = require('@playwright/test');

const PAGE = '/characters/Boomcat/index.html';

const GROUP = {
    title: 'Zeta Starter Routes',
    content: [
        { type: 'heading', content: '[color=hsl(100, 100%, 75%)]Zeta Fundamentals[/color]' },
        { type: 'theorybox', title: 'Zeta Corner Loop', oneliner: 'zeta loop words', sequence: ['M1', 'M1'] },
        { type: 'paragraph', content: 'zeta words after the card' },
        { type: 'theorybox', title: '[color=#ff0000]Zeta Red[/color] Punish', sequence: ['M1'] },
        { type: 'theorybox', title: '', sequence: ['M1'] },
        {
            type: 'theorybox', title: 'Zeta Variants', multiSections: true, sections: [
                { label: 'Wall', title: 'Zeta Wall Opener', sequence: ['M1'] },
                { label: 'Mid', title: 'Zeta Mid Opener', sequence: ['M1'], content: [{ type: 'heading', content: 'Zeta Mid Notes' }] },
                { label: '', title: '[b]Zeta Third[/b]' },
            ],
        },
    ],
};

// Every id below, in page order.
const EXPECTED = [
    ['Zeta Fundamentals', 'sec-zeta-fundamentals'],
    ['Zeta Corner Loop', 'sec-zeta-corner-loop'],
    ['Zeta Red Punish', 'sec-zeta-red-punish'],
    ['Zeta Wall Opener', 'sec-zeta-wall-opener'],
    ['Zeta Mid Opener', 'sec-zeta-mid-opener'],
    ['Zeta Mid Notes', 'sec-zeta-mid-notes'],
    ['Zeta Third', 'sec-zeta-third'],
];

// Renders the group into the real Combos tab, then sweeps anchors BEFORE the
// styling pass: the order where raw shortcodes are still in the DOM, so the
// ids below prove the sweep takes them out itself.
async function boot(page) {
    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.renderDocumentTab === 'function'
        && typeof window.collectSectionTargets === 'function', { timeout: 45000 });
    await page.waitForTimeout(500);
    await page.evaluate((group) => {
        window.renderDocumentTab('combos', { comboGroups: [group] });
        window.assignSectionAnchors();
        window.applyInternalStyling();
    }, GROUP);
}

const minorHeadings = (page) => page.evaluate(() =>
    [...document.querySelectorAll('#tab-combos .wiki-block-heading, #tab-combos .theorybox-title')]
        .filter(h => h.id).map(h => [h.textContent.trim(), h.id]));

test('a card name, and each section name, is a heading with a stable id', async ({ page }) => {
    await boot(page);
    expect(await minorHeadings(page)).toEqual(EXPECTED);

    // "Combo" stands in for a missing name, and names nothing.
    const untitled = await page.evaluate(() => {
        const h = [...document.querySelectorAll('#tab-combos .theorybox-title')].find(x => x.textContent.trim() === 'Combo');
        return h && { id: h.id, untitled: h.classList.contains('is-untitled') };
    });
    expect(untitled).toEqual({ id: '', untitled: true });
});

test('the picker offers exactly the ids the page renders, under the group', async ({ page }) => {
    await boot(page);
    const offered = await page.evaluate((group) => {
        const all = window.collectSectionTargets({ comboGroups: [group] }, {});
        const parent = all.find(t => t.title === 'Zeta Starter Routes');
        return parent && parent.children.map(c => [c.title, c.id]);
    }, GROUP);

    // Both ways at once: same entries, same order, same ids. The titles are
    // what the reader sees, never "[b]Zeta Third[/b]".
    expect(offered).toEqual(EXPECTED);
    expect(await minorHeadings(page)).toEqual(offered);
});

test('a styled card name is styled in the Combos tab', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(() => {
        const h = document.getElementById('sec-zeta-red-punish');
        const span = h.querySelector('span');
        return {
            raw: h.textContent.includes('[color'),
            colour: span && getComputedStyle(span).color,
            title: getComputedStyle(h).color,
        };
    });
    expect(out.raw, 'the shortcode is gone from the name').toBe(false);
    // The colour the reader sees, not the class that should cause it.
    expect(out.colour).toBe('rgb(255, 0, 0)');
    expect(out.colour).not.toBe(out.title);
});

test('a tab label falling back to a styled name shows its plain text', async ({ page }) => {
    await boot(page);
    const labels = await page.evaluate(() =>
        [...document.querySelectorAll('#tab-combos .theorybox-sections .sbox-tab')].map(t => t.textContent));
    expect(labels).toEqual(['Wall', 'Mid', 'Zeta Third']);
});

test('a link to a section opens the card on that tab', async ({ page }) => {
    await boot(page);
    const panelOf = (id) => page.evaluate((x) => {
        const h = document.getElementById(x);
        const panel = h.closest('[data-sbox-panel]');
        const box = panel.parentElement;
        return {
            panelActive: panel.classList.contains('is-active'),
            shown: h.getClientRects().length > 0,
            activeTab: box.querySelector(':scope > .sbox-tabs > .sbox-tab.is-active').textContent,
        };
    }, id);

    expect((await panelOf('sec-zeta-mid-opener')).shown, 'starts hidden behind the first tab').toBe(false);

    expect(await page.evaluate(() => window.jumpToAnchor('#sec-zeta-mid-opener', { updateHash: false, behavior: 'auto' }))).toBe(true);
    await page.waitForTimeout(150);
    expect(await panelOf('sec-zeta-mid-opener')).toEqual({ panelActive: true, shown: true, activeTab: 'Mid' });

    // A heading inside the section's write-up reaches the same tab.
    await page.evaluate(() => document.querySelector('#tab-combos .theorybox-sections [data-sbox-tab="0"]').click());
    await page.evaluate(() => window.jumpToAnchor('#sec-zeta-mid-notes', { updateHash: false, behavior: 'auto' }));
    await page.waitForTimeout(150);
    expect(await panelOf('sec-zeta-mid-notes')).toEqual({ panelActive: true, shown: true, activeTab: 'Mid' });
});

test('the contents lists the names under their group, and its links switch the tab', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 950 });
    await boot(page);
    // Opens the Combos tab, which is what makes it the contents' subject.
    await page.evaluate(() => window.jumpToAnchor('#sec-zeta-corner-loop', { updateHash: false, behavior: 'auto' }));
    await page.waitForTimeout(200);
    await page.evaluate(() => window.refreshTOC());

    const group = await page.evaluate(() => {
        const major = [...document.querySelectorAll('#dynamic-toc .toc-link-major-toggle')]
            .find(a => a.textContent.trim() === 'Zeta Starter Routes');
        if (!major) return null;
        const list = major.closest('li').querySelector('.toc-sublist');
        return [...list.querySelectorAll('a')].map(a => a.textContent.trim());
    });
    expect(group).toEqual(EXPECTED.map(([title]) => title));

    // The reader's own control: a contents entry, clicked.
    await page.locator('#dynamic-toc a[href="#sec-zeta-wall-opener"]').click();
    await page.locator('#dynamic-toc a[href="#sec-zeta-mid-opener"]').click();
    await page.waitForTimeout(300);
    const active = await page.evaluate(() =>
        document.querySelector('#tab-combos .theorybox-sections > .sbox-tabs > .sbox-tab.is-active').textContent);
    expect(active).toBe('Mid');
});

test("a card's words are found under the card, and words after it under the heading before it", async ({ page }) => {
    // The full-text index hangs body text on the heading above it. A card is a
    // box with an end, so the paragraph after it goes back to whatever was in
    // scope before the card.
    await boot(page);
    const out = await page.evaluate((group) => {
        const all = window.collectSectionTargets({ comboGroups: [group] }, {}, { collectText: true });
        const parent = all.find(t => t.title === 'Zeta Starter Routes');
        const card = parent.children.find(c => c.title === 'Zeta Corner Loop');
        const fundamentals = parent.children.find(c => c.title === 'Zeta Fundamentals');
        return { card: card.text || [], before: fundamentals.text || [], parent: parent.text || [] };
    }, GROUP);

    expect(out.card).toContain('zeta loop words');
    expect(out.card, "the card's own name is its title, not its text").not.toContain('Zeta Corner Loop');
    // The heading above the card was in scope before it, so it is again after.
    expect(out.before).toContain('zeta words after the card');
    expect(out.card).not.toContain('zeta words after the card');
});
