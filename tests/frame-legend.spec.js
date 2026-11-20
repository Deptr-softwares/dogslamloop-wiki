// The words the Frame Data Color Legend and the Color Codes page show readers,
// kept in step with the owner's Terminologies page (Round 2, 2026-11-12).
const { test, expect } = require('@playwright/test');

// Each legend item is a swatch, a name, and an optional description after it.
async function legendItems(page) {
    await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
    await page.locator('#nav-m1s').click();
    const items = page.locator('#tab-m1s .legend-grid .legend-item');
    await expect(items.first()).toBeVisible();
    return items.evaluateAll(nodes => nodes.map(n => {
        const name = n.querySelector('.legend-name').textContent.trim();
        const all = n.querySelector('.legend-name').parentElement.textContent;
        return { name, desc: all.slice(all.indexOf(name) + name.length).trim() };
    }));
}

// The legend's columns follow its own width (owner, 2026-11-18). From a 1024px
// screen the sidebar takes its share, and 7 columns in what was left cut
// "Explosion" short and stood descriptions one word to a line. A 1440px screen
// still gives it all 7.
for (const [width, sevenColumns] of [[1100, false], [1440, true]]) {
    test(`at a ${width}px screen the legend has ${sevenColumns ? 'all 7 columns' : 'fewer columns'}, and no name runs past its own`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
        await page.evaluate(async () => {
            window.cachedMasterFrameData = window.cachedMasterFrameData || {};
            window.cachedMasterFrameData['boomcat'] = { m1s: [{ id: 'jab', name: 'Jab', stats: [], variants: { standard: {
                label: 'Standard', totalScale: 20, bars: [{ type: 'single', phases: [{ duration: 10, styleClass: 'bg-tick-start', label: 'Startup: 10f' }] }],
            } } }] };
            await window.loadMoveSection('boomcat', 'm1s');
        });
        await page.locator('#nav-m1s').click();
        const grid = page.locator('#tab-m1s .legend-grid');
        await expect(grid).toBeVisible();

        const out = await grid.evaluate(el => ({
            columns: getComputedStyle(el).gridTemplateColumns.split(' ').length,
            // A name wider than its column runs into the next one's swatch.
            runOver: [...el.querySelectorAll('.legend-item')].filter(item => {
                const range = document.createRange();
                range.selectNodeContents(item.querySelector('.legend-name'));
                return range.getBoundingClientRect().right > item.getBoundingClientRect().right + 1;
            }).map(item => item.querySelector('.legend-name').textContent),
        }));
        if (sevenColumns) expect(out.columns).toBe(7);
        else expect(out.columns).toBeLessThan(7);
        expect(out.runOver).toEqual([]);
    });
}

test('the legend under a Frame Track no longer offers Reverse Hitcancel', async ({ page }) => {
    // Retired 2026-11-12: no Frame Track on any page ever used it.
    const names = (await legendItems(page)).map(i => i.name);

    expect(names).toContain('Melee I-Frames');
    expect(names).not.toContain('Reverse Hitcancel');
});

test('the legend describes Block Endlag as the blocker\'s stun', async ({ page }) => {
    // Round 2 (2026-11-12): Block Endlag is the stun of the player who
    // blocked, "Otherwise known as Block Stun". It used to say "aka Extended
    // Recovery", the attacker's endlag on block, which is Recovery now.
    const items = await legendItems(page);
    const blockEndlag = items.find(i => i.name === 'Block Endlag');

    expect(blockEndlag.desc).toBe('aka Block Stun');
    expect(items.find(i => i.name === 'Recovery').desc).toBe('aka Whiff endlag');
});

test('the Misc line reads as a sentence', async ({ page }) => {
    const misc = (await legendItems(page)).find(i => i.name === 'Misc');

    expect(misc.desc).toBe('Variable frame data aka no hard number so it always comes with a note');
});

test('an old revision that still names Reverse Hitcancel draws only the overlays that remain', async ({ page }) => {
    // History renders old revisions, and the overlay was retired, not
    // migrated out of the data. It must vanish quietly, not break the track.
    await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
        window.cachedMasterFrameData = window.cachedMasterFrameData || {};
        window.cachedMasterFrameData['boomcat'] = {
            m1s: [{
                id: 'old_move', name: 'Old Move', input: 'M1', type: 'Attack', damageType: 'Melee', stats: [],
                variants: {
                    standard: {
                        label: 'On Hit', totalScale: 20,
                        bars: [{ type: 'single', phases: [
                            { duration: 10, styleClass: 'bg-tick-start', label: 'Startup: 10f' },
                            { duration: 10, styleClass: 'bg-tick-active', label: 'Active: 10f',
                              overlays: ['reverse-hitcancel', 'iframe-melee'] },
                        ] }],
                    },
                },
            }],
        };
        await window.loadMoveSection('boomcat', 'm1s');
    });
    await page.locator('#nav-m1s').click();

    const card = page.locator('#tab-m1s .skill-entry-card').first();
    await expect(card).toContainText('Old Move');
    await expect(card.locator('.window-overlay')).toHaveCount(1);
    await expect(card.locator('.window-overlay')).toHaveClass(/span-iframe-melee/);
    await expect(card).toContainText('Melee I-Frames');
    await expect(card).not.toContainText('Reverse Hitcancel');
});

test('the Color Codes page no longer shows a Reverse Hitcancel overlay', async ({ page }) => {
    // Its swatches are a Block since v1.2, so the page is served a row with
    // the overlay grid in it (production has none until the release).
    await page.route('**/rest/v1/page_data*', route => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ page_id: 'color_codes', page_type: 'system', frame_data: {}, desc_data: { tabs: [{
            tabId: 'overview', tabLabel: 'Overview',
            sections: [{ sectionTitle: 'Stackable Overlays', layout: 'full', blocks: [{ type: 'colorswatches', set: 'overlays' }] }],
        }] } }),
    }));
    await page.goto('/systems/color-codes/index.html', { waitUntil: 'networkidle' });
    const titles = await page.locator('.swatch-title').allTextContents();

    expect(titles).toContain('Swarm I-Frames');
    expect(titles).not.toContain('Reverse Hitcancel');
});
