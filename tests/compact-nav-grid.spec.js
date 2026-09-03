// v0.17: the home page's three navigation columns, compacted.
//
// Owner, 2026-09-03: "The buttons that guide user to the other pages are too
// big, some navigation elements are hidden down deep under a column by a scroll
// bar (problem persist across all 3 columns: Guides and Such, Others, and
// Tools). I like to compact them using the not-slanted style regular button
// (not system button). The buttons would be divided into 2 columns inside the
// column, if there is an odd amount of buttons/pages in a category, the last
// button would widen to cover both column."
//
// The column that must NOT change is the Systems Hub. buildSystemsDirectory
// fills both it and the home page's narrow column, and two fixed columns on a
// full-width page would leave most of it empty - so `compact` is opted into.
// That split is what the second half of this file protects.
const { test, expect } = require('@playwright/test');

const HOME_GRIDS = ['#systems-grid', '#others-grid', '#tools-grid'];

async function openHome(page) {
    await page.setViewportSize({ width: 1500, height: 1200 });
    await page.goto('/index.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('#systems-grid .system-directory-btn');
    await page.waitForSelector('#others-grid .system-directory-btn');
    await page.waitForSelector('#tools-grid .system-directory-btn');
}

// --- ALL THREE COLUMNS, NOT JUST THE ONE THAT WAS LOOKED AT ---

test('every home navigation column is compact and unslanted', async ({ page }) => {
    await openHome(page);

    for (const id of HOME_GRIDS) {
        const grids = page.locator(`${id} .system-button-grid`);
        const n = await grids.count();
        expect(n, `${id} rendered at least one group`).toBeGreaterThan(0);

        for (let i = 0; i < n; i++) {
            await expect(grids.nth(i), `${id} group ${i}`).toHaveClass(/system-button-grid-compact/);
        }

        // The owner asked for the not-slanted button specifically. Read the
        // computed transform rather than the class: skewX is what they were
        // pointing at, and `none` is the whole request.
        const transforms = await page.locator(`${id} .system-directory-btn`)
            .evaluateAll(els => els.map(e => getComputedStyle(e).transform));
        expect(transforms.length).toBeGreaterThan(0);
        expect(transforms.every(t => t === 'none'), `${id} buttons are not skewed`).toBe(true);
    }
});

test('the buttons really sit in two columns', async ({ page }) => {
    // A grid declaring two columns and rendering one is the failure this is
    // here for - which is exactly what the old auto-fill minmax(220px) did in a
    // column this narrow.
    await openHome(page);

    const group = page.locator('#systems-grid .system-button-grid').first();
    const lefts = await group.locator('.system-directory-btn')
        .evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().left)));

    expect(lefts.length, 'this group has enough buttons to prove it').toBeGreaterThan(1);
    expect(new Set(lefts).size, 'two distinct x positions').toBe(2);
});

test('an odd last button spans both columns', async ({ page }) => {
    await openHome(page);

    const checked = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('.system-button-grid-compact').forEach(grid => {
            const btns = [...grid.querySelectorAll('.system-directory-btn')];
            if (btns.length % 2 !== 1) return;             // even: nothing to widen
            const last = btns[btns.length - 1];
            out.push({
                count: btns.length,
                lastWidth: Math.round(last.getBoundingClientRect().width),
                gridWidth: Math.round(grid.getBoundingClientRect().width),
                firstWidth: Math.round(btns[0].getBoundingClientRect().width),
            });
        });
        return out;
    });

    expect(checked.length, 'at least one group has an odd number of buttons').toBeGreaterThan(0);
    for (const g of checked) {
        // Spans the whole grid rather than sitting in one track. Compared
        // against the grid's own width, not a pixel literal, so this survives a
        // layout change that is not this one.
        expect(g.lastWidth, `${g.count} buttons: last one is full width`)
            .toBeGreaterThan(g.gridWidth * 0.9);

        // Only from three up. In a one-button group the last button IS the
        // first, so comparing them can never show a span - the Tools column is
        // entirely one-button groups, and this assertion failed there against a
        // layout that was correct.
        if (g.count >= 3) {
            expect(g.lastWidth, 'and is wider than a single-track button')
                .toBeGreaterThan(g.firstWidth * 1.5);
        }
    }

    // At least one group must actually exercise the multi-row case, or the
    // check above is only ever proving that a lone button fills its row.
    expect(checked.some(g => g.count >= 3),
        'a group with three or more buttons exists to prove the span').toBe(true);
});

// --- THE BUG THE TESTS DID NOT CATCH THE FIRST TIME ---

test('no page name is truncated', async ({ page }) => {
    // The first version of this layout shipped names like "FUNDAMENT...",
    // "COLLABORA..." and "RECENT CHA...". .btn-manga-text is nowrap +
    // text-overflow: ellipsis by default, and two narrow columns made that
    // visible everywhere. It passed every structural assertion; it was found by
    // looking at the rendered column.
    //
    // A truncated name is not a name, and it is worse than the scroll bar this
    // replaces. Page names are owner-authored, so this cannot be fixed by
    // choosing a font size that fits today's longest.
    await openHome(page);

    const clipped = await page.evaluate(() =>
        [...document.querySelectorAll('.system-button-grid-compact .btn-manga-text')]
            .filter(el => el.scrollWidth > el.clientWidth + 1)
            .map(el => el.textContent.trim()));

    expect(clipped, 'these names do not fit and are being cut off').toEqual([]);
});

test('the text wraps rather than ellipsising', async ({ page }) => {
    // The positive half of the assertion above: if the rule were ever reverted
    // to nowrap, a short-named site would still pass the clipping test.
    await openHome(page);
    const style = await page.locator('.system-button-grid-compact .btn-manga-text').first()
        .evaluate(el => {
            const s = getComputedStyle(el);
            return { whiteSpace: s.whiteSpace, textOverflow: s.textOverflow };
        });
    expect(style.whiteSpace).not.toBe('nowrap');
    expect(style.textOverflow).not.toBe('ellipsis');
});

// --- CATEGORY ORDER ---

test('Guides is first and System Pages is last', async ({ page }) => {
    // Owner, 2026-09-03. navigation.json's key order comes from
    // site_pages.sort_order, which is the owner's ordering of the registry
    // rather than of this box, so the two ends are pinned in code.
    await openHome(page);
    const headings = await page.locator('#systems-grid .sidebar-master-title')
        .evaluateAll(els => els.map(e => e.textContent.trim()));

    expect(headings.length, 'more than one category to order').toBeGreaterThan(1);
    expect(headings[0]).toBe('Guides');
    expect(headings[headings.length - 1]).toBe('System Pages');
});

test('an unpinned category keeps its place between them', async ({ page }) => {
    // The pinning must not become a hardcoded list of every category: one the
    // owner creates next month has to appear without a code change, in the
    // position navigation.json gives it.
    await openHome(page);
    const ordered = await page.evaluate(() =>
        window.orderSystemsCategories(['System Pages', 'Site Info', 'Guides', 'Brand New']));

    expect(ordered[0]).toBe('Guides');
    expect(ordered[ordered.length - 1]).toBe('System Pages');
    // Site Info and Brand New are both unpinned, and sort is stable, so they
    // keep the order they arrived in.
    expect(ordered.slice(1, -1)).toEqual(['Site Info', 'Brand New']);
});

test('the ordering does not drop or duplicate a category', async ({ page }) => {
    await openHome(page);
    const { input, output } = await page.evaluate(() => {
        const input = ['A', 'System Pages', 'B', 'Guides', 'C'];
        return { input, output: window.orderSystemsCategories(input) };
    });
    expect(output.length).toBe(input.length);
    expect([...output].sort()).toEqual([...input].sort());
});

// --- THE WIP BADGE ---

test('no WIP badge in the navigation columns', async ({ page }) => {
    // Owner, 2026-09-03: "kinda off and not fitting. The WIP tag being on the
    // left sidebar navigation is good enough." The live site has WIP pages in
    // Others, so this is asserted against real data rather than a fixture that
    // happens to contain none.
    await openHome(page);
    for (const id of HOME_GRIDS) {
        expect(await page.locator(`${id} .update-badge`).count(), `${id} has no badges`).toBe(0);
    }
    // Paired positive: the sidebar still has them, so this cannot pass by the
    // isWip flag having been lost everywhere.
    const sidebar = page.locator('#global-sidebar-nav');
    expect(await sidebar.locator('.badge-wip').count(),
        'the sidebar still warns').toBeGreaterThan(0);
});

// --- THE PAGE THAT MUST NOT HAVE CHANGED ---

test('the Systems Hub keeps its wide, slanted layout', async ({ page }) => {
    // buildSystemsDirectory fills this too. Two fixed columns here would leave a
    // full-width page mostly empty, which is why compact is a parameter rather
    // than the new default.
    await page.setViewportSize({ width: 1500, height: 1200 });
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('#systems-grid .system-directory-btn');

    const grid = page.locator('#systems-grid .system-button-grid').first();
    await expect(grid).not.toHaveClass(/system-button-grid-compact/);

    // Still skewed.
    const transform = await page.locator('#systems-grid .system-directory-btn').first()
        .evaluate(el => getComputedStyle(el).transform);
    expect(transform).not.toBe('none');

    // And still more than two columns at this width.
    const lefts = await grid.locator('.system-directory-btn')
        .evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(lefts).size, 'a wide page uses its width').toBeGreaterThan(2);
});

test('one column on a phone', async ({ page }) => {
    // Two 0.7rem buttons side by side at 390px would put two or three words on
    // a line each. The span rule has to be undone with it, or the last button
    // stays full width while its neighbours already are.
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/index.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('#systems-grid .system-directory-btn');

    const lefts = await page.locator('#systems-grid .system-button-grid').first()
        .locator('.system-directory-btn')
        .evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(lefts).size, 'stacked').toBe(1);
});
