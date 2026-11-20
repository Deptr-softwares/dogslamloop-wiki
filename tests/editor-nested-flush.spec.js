// Editing inside a Section Box or a Dropdown, then switching away.
//
// Reported by an editor, 2026-11-20: "If you switch to another section of a
// page while editing inside a section block, the entirety of the page outside
// of that section of the section block gets deleted. Also editing inside a
// section block fucks up the entire preview section of the page."
//
// Inside a container, getActiveBlocks() is the container's own list, not the
// page's. Four write-backs used it: a Combos/Techs card, the Combos/Techs
// introduction, a matchup and a keyed entry (Counterplay, Starter Guide). So
// leaving one of them from inside a box saved the box's blocks as the whole
// section, and a card's live preview showed only the box's blocks while the
// author typed in it. The page's own list is the buffer, currentStrategyBlocks.
const { test, expect } = require('@playwright/test');

const p = (content) => ({ type: 'paragraph', content });
// A Section Box between two paragraphs: what must survive is everything
// around the box as well as the box.
const BOXED = () => [
    p('Before the box.'),
    { type: 'sectionedbox', title: 'Box', intro: [], sections: [{ title: 'Inside', content: [p('inside text')] }] },
    p('After the box.'),
];
// The page as the buffer holds it, flattened to what an author would check.
const outline = (blocks) => (blocks || []).map(b => (b.type === 'sectionedbox'
    ? `box[${b.sections.map(s => s.content.map(c => c.content).join('|')).join(';')}]`
    : b.type === 'accordion' ? `dropdown[${(b.content || []).map(c => c.content).join('|')}]` : b.content));

async function openEditor(page, tab, desc) {
    await page.goto(`/edit.html?char=testchar&tab=${tab}`, { waitUntil: 'networkidle' });
    await page.evaluate(async ({ tab, desc }) => {
        window.currentEditorPageType = 'character';
        window.currentEditorCharId = 'testchar';
        window.currentEditorTabId = tab;
        // The page's own boot found no session and left its selections set
        // with an empty buffer: cleared so nothing is flushed over the seed.
        window.currentOverviewSection = null;
        window.currentMatchupIndex = undefined;
        window.currentKeyedIndex = {};
        window.currentDocSection = null;
        window.currentDocCardIndex = undefined;
        const frame = { m1s: [], skills: [], specials: [] };
        window.originalCloudDescData = JSON.parse(JSON.stringify(desc));
        window.originalCloudFrameData = JSON.parse(JSON.stringify(frame));
        await window.initEditorModes('testchar', desc, frame);
        initFullTabEditor('testchar', tab, window.currentEditorDescData, window.currentEditorFrameData);
    }, { tab, desc });
}

// Into the box's first section and type there, the way an author does.
async function typeInsideTheBox(page) {
    await page.locator('#block-list [data-sbox-edit="0"]').click();
    const inner = page.locator('#block-list textarea[data-field="content-array"]');
    await expect(inner).toHaveCount(1);
    await expect(inner).toHaveValue('inside text');
    await inner.fill('inside text, edited');
    await page.waitForTimeout(400);
}

test('a Techs card: the preview keeps the whole card while the author types inside a box, and switching cards keeps it all', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 950 });
    await openEditor(page, 'techs', {
        techGroups: [{ title: 'Wall Techs', content: [
            { type: 'theorybox', title: 'Card A', sequence: [], content: BOXED() },
            { type: 'theorybox', title: 'Card B', sequence: [], content: [p('Card B text.')] },
        ] }],
    });

    await page.locator('#techs-nav-group-0').click();
    await page.locator('#combo-cards-panel [data-card="0"]').click();
    await typeInsideTheBox(page);

    const preview = await page.evaluate(() => document.getElementById('tab-techs')?.textContent || '');
    expect(preview, 'the preview still shows the card around the box').toContain('Before the box.');
    expect(preview).toContain('After the box.');
    expect(preview).toContain('inside text, edited');

    await page.locator('#combo-cards-panel [data-card="1"]').click();
    const saved = await page.evaluate(() => window.currentEditorDescData.techGroups[0].content.map(c => c.content));
    expect(outline(saved[0]), 'Card A keeps everything around the box, and the edit').toEqual(
        ['Before the box.', 'box[inside text, edited]', 'After the box.']);
    expect(outline(saved[1])).toEqual(['Card B text.']);
});

test('the Techs introduction keeps its blocks when the author leaves it from inside a box', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 950 });
    await openEditor(page, 'techs', {
        techIntro: BOXED(),
        techGroups: [{ title: 'Wall Techs', content: [] }],
    });

    await typeInsideTheBox(page);
    await page.locator('#techs-nav-group-0').click();

    const intro = await page.evaluate(() => window.currentEditorDescData.techIntro);
    expect(outline(intro)).toEqual(['Before the box.', 'box[inside text, edited]', 'After the box.']);
});

test('a matchup keeps its blocks when the author switches matchup from inside a box', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 950 });
    await openEditor(page, 'matchups', {
        matchups: [
            { character: 'Vessel', content: BOXED() },
            { character: 'Switcher', content: [p('Switcher text.')] },
        ],
    });

    await typeInsideTheBox(page);
    await page.locator('#matchup-nav-1').click();

    const saved = await page.evaluate(() => window.currentEditorDescData.matchups.map(m => m.content));
    expect(outline(saved[0])).toEqual(['Before the box.', 'box[inside text, edited]', 'After the box.']);
    expect(outline(saved[1])).toEqual(['Switcher text.']);
});

test('a Counterplay entry keeps its blocks when the author switches entry from inside a Dropdown', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 950 });
    const dropdown = { type: 'accordion', title: 'More', content: [p('inside text')] };
    await openEditor(page, 'counterplay', {
        counterplay: [
            { title: 'General', content: [p('Before the box.'), dropdown, p('After the box.')] },
            { title: 'Vessel', content: [p('Vessel text.')] },
        ],
    });

    // A Dropdown is entered by its index alone, the older half of the same path.
    await page.locator('#block-list button[onclick*="activeAccordionPath.push(1)"]').click();
    const inner = page.locator('#block-list textarea[data-field="content-array"]');
    await expect(inner).toHaveCount(1);
    await inner.fill('inside text, edited');
    await page.waitForTimeout(400);
    await page.locator('#counterplay-nav-1').click();

    const saved = await page.evaluate(() => window.currentEditorDescData.counterplay.map(m => m.content));
    expect(outline(saved[0])).toEqual(['Before the box.', 'dropdown[inside text, edited]', 'After the box.']);
    expect(outline(saved[1])).toEqual(['Vessel text.']);
});
