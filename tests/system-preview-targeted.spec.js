// Editing a system page repaints only the section being edited (v0.18 FT6).
//
// THE OLD BEHAVIOUR: every keystroke called loadPageDescriptions, which rebuilds
// EVERY tab and EVERY section of the page from scratch, and then hid all but the
// active tab on a 150ms timeout. On a long system page that is the whole
// document re-rendered per character typed, plus a window in which the wrong tab
// is the visible one.
//
// THE RISK IN FIXING IT is not performance, it is staleness. A preview that
// silently stops reflecting the data is worse than a slow one: the contributor
// believes their change did not take. So the fast path is gated on
// `systemPreviewMatchesData`, a whole-tab structural fingerprint, and anything
// it cannot verify falls back to the original rebuild.
//
// These tests are therefore mostly about the GATE, not about the repaint - the
// repaint is one call to a function that already existed. What has to be true is
// that the gate says "no" to every structural change.
const { test, expect } = require('@playwright/test');

// The fingerprint runs against the DOM the system renderer produces, so the
// fixture builds that DOM the same way rather than mocking the check.
async function mount(page, tab) {
    return page.evaluate((t) => {
        document.querySelectorAll('.fixture-tab').forEach(n => n.remove());

        const container = document.createElement('div');
        container.id = `tab-${t.tabId}`;
        container.className = 'tab-content fixture-tab';
        document.body.appendChild(container);

        t.sections.forEach((section, idx) => {
            const node = document.createElement('section');
            node.className = 'wiki-section system-content-grid-section';
            const width = section.width === undefined ? 100 : section.width;
            node.style.flex = `0 0 ${width}%`;
            node.style.maxWidth = `${width}%`;

            if (section.sectionTitle) {
                const h2 = document.createElement('h2');
                h2.className = 'section-title mb-4';
                // textContent, matching the renderer's escaped output - the
                // fingerprint compares against the RAW title, so a title with
                // an ampersand has to survive the round trip.
                h2.textContent = section.sectionTitle;
                node.appendChild(h2);
            }

            const content = document.createElement('div');
            content.id = `system-${t.tabId}-sec-${idx}`;
            node.appendChild(content);
            container.appendChild(node);
        });
        return true;
    }, tab);
}

const TAB = {
    tabId: 'basics',
    sections: [
        { sectionTitle: 'Opening', width: 100, blocks: [] },
        { sectionTitle: 'Details & Notes', width: 48, blocks: [] },
    ],
};

const check = (page, tab) =>
    page.evaluate((t) => window.systemPreviewMatchesData(t), tab);

async function open(page) {
    await page.goto('/edit.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.systemPreviewMatchesData === 'function');
}

test('an unchanged page matches, which is the only case that may take the fast path', async ({ page }) => {
    await open(page);
    await mount(page, TAB);
    // The positive, first and on its own. Every test below asserts a false;
    // without this one they would all pass against a function that returns
    // false unconditionally - and the feature would be silently off.
    expect(await check(page, TAB)).toBe(true);
});

test('a renamed section does not match', async ({ page }) => {
    await open(page);
    await mount(page, TAB);

    const renamed = JSON.parse(JSON.stringify(TAB));
    renamed.sections[0].sectionTitle = 'Opening Moves';
    expect(await check(page, renamed)).toBe(false);
});

test('an added section does not match', async ({ page }) => {
    await open(page);
    await mount(page, TAB);

    const added = JSON.parse(JSON.stringify(TAB));
    added.sections.push({ sectionTitle: 'Third', width: 100, blocks: [] });
    expect(await check(page, added)).toBe(false);
});

test('a deleted section does not match, even though every remaining node exists', async ({ page }) => {
    // The case a section-scoped check would get wrong. Deleting section 0
    // shifts section 1 into its id, so a check that looked only at the section
    // being edited would find a node, find a title, and be reading the wrong
    // one. The fingerprint covers the whole tab for exactly this.
    await open(page);
    await mount(page, TAB);

    const deleted = JSON.parse(JSON.stringify(TAB));
    deleted.sections.splice(0, 1);
    expect(await check(page, deleted)).toBe(false);
});

test('a resized section does not match', async ({ page }) => {
    await open(page);
    await mount(page, TAB);

    const resized = JSON.parse(JSON.stringify(TAB));
    resized.sections[1].width = 100;
    expect(await check(page, resized)).toBe(false);
});

test('a hidden tab does not match, because a tab switch must also move the nav', async ({ page }) => {
    await open(page);
    await mount(page, TAB);
    await page.evaluate((id) => {
        document.getElementById(`tab-${id}`).classList.add('hidden');
    }, TAB.tabId);

    expect(await check(page, TAB)).toBe(false);
});

test('a tab that was never rendered does not match', async ({ page }) => {
    await open(page);
    await mount(page, TAB);

    const other = JSON.parse(JSON.stringify(TAB));
    other.tabId = 'never-rendered';
    expect(await check(page, other)).toBe(false);
});

test('a title containing an ampersand still matches', async ({ page }) => {
    // The renderer escapes on the way in, so comparing its OUTPUT against the
    // raw data would report a mismatch for every title with an & or a quote in
    // it - and the fast path would switch itself off for those pages only,
    // which is the kind of bug nobody reports.
    await open(page);
    await mount(page, TAB);
    expect(await check(page, TAB)).toBe(true);

    const amp = JSON.parse(JSON.stringify(TAB));
    expect(amp.sections[1].sectionTitle).toContain('&');
});

test('an empty tab never takes the fast path', async ({ page }) => {
    await open(page);
    expect(await check(page, { tabId: 'x', sections: [] })).toBe(false);
    expect(await check(page, null)).toBe(false);
});
