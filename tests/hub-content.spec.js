// Protects the v0.11 hub CMS: the three dashboards render their intro prose
// from page_data instead of hardcoded markup.
//
// The contract that matters most here is the FALLBACK. These are the first
// paragraphs on the three most-visited pages on the site, and the static HTML
// is deliberately left in place so that "Supabase is briefly unreachable"
// never reads as "this wiki is empty". A test that only proved the CMS path
// works would pass against a build that blanks every dashboard on a failed
// fetch.
//
// It also pins the pre-merge state as correct rather than broken: migrations
// apply on merge, so until 20260809000001_hub_content.sql lands there is no
// row for these pages and the fallback is what visitors get. That is expected.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test('the seeded hub slots contain no heading blocks', () => {
    // Each hub page renders its heading as static markup outside the
    // replaceable container, so the ToC can index it and so it can be renamed
    // from owner.html. A heading block inside the slot would therefore render
    // a SECOND copy of the same words directly beneath the first.
    //
    // This was live in the seed until the owner's live preview showed
    // "ABOUT US / About Us" stacked. The specs missed it because they mock
    // their own slot content rather than reading the seed, so the seed is
    // asserted directly here.
    const sql = fs.readFileSync(
        path.join(__dirname, '..', 'supabase', 'migrations', '20260809000001_hub_content.sql'),
        'utf8'
    );
    expect(sql).toContain('"type": "paragraph"');
    expect(sql).not.toContain('"type": "heading"');
});

const HUBS = [
    { path: '/index.html', pageId: 'main-hub', slot: 'about', fallback: 'casual (shenanigans) battleground' },
    { path: '/characters/index.html', pageId: 'character-hub', slot: 'intro', fallback: 'Welcome to the Character Dashboard' },
    { path: '/systems/index.html', pageId: 'systems-hub', slot: 'intro', fallback: 'Welcome to the Side Dashboard' },
];

/**
 * Patches page_data reads only. Everything else keeps hitting the real client,
 * so the roster, directory and widgets on these pages still behave normally -
 * a fully faked client would not exercise the page as it actually runs.
 */
async function mockHubRow(page, { descData, fail = false }) {
    await page.addInitScript(({ descData, fail }) => {
        Object.defineProperty(window, 'supabase', {
            configurable: true,
            get() { return window.__lib; },
            set(lib) {
                window.__lib = lib;
                if (lib && lib.createClient && !lib.__patched) {
                    const orig = lib.createClient.bind(lib);
                    lib.createClient = (...args) => {
                        const client = orig(...args);
                        const origFrom = client.from.bind(client);

                        client.from = (table) => {
                            if (table !== 'page_data') return origFrom(table);
                            const chain = {
                                select() { return chain; },
                                eq() { return chain; },
                                maybeSingle: async () => fail
                                    ? { data: null, error: new Error('offline') }
                                    : { data: { desc_data: descData }, error: null },
                            };
                            return chain;
                        };
                        return client;
                    };
                    lib.__patched = true;
                }
            },
        });
    }, { descData, fail });
}

function hubDoc(slot, text) {
    return {
        tabs: [{
            tabId: slot,
            tabLabel: 'Slot',
            sections: [{ sectionTitle: 'S', layout: 'full', blocks: [
                { type: 'heading', size: 'h2', align: 'left', content: 'From the CMS' },
                { type: 'paragraph', align: 'left', content: text },
            ] }],
        }],
    };
}

for (const hub of HUBS) {
    test.describe(`${hub.pageId}`, () => {
        test('renders authored content into the slot when the CMS has it', async ({ page }) => {
            const errors = [];
            page.on('pageerror', e => errors.push(e.message));

            await mockHubRow(page, { descData: hubDoc(hub.slot, 'Authored in the editor.') });
            await page.goto(hub.path, { waitUntil: 'networkidle' });

            const section = page.locator('#about-section');
            await expect(section).toContainText('Authored in the editor.');
            await expect(section).toContainText('From the CMS');
            // The static copy must be gone once real content replaced it.
            await expect(section).not.toContainText(hub.fallback);
            expect(errors).toEqual([]);
        });

        test('keeps the static fallback when the CMS has no row', async ({ page }) => {
            const errors = [];
            page.on('pageerror', e => errors.push(e.message));

            await mockHubRow(page, { descData: null });
            await page.goto(hub.path, { waitUntil: 'networkidle' });

            await expect(page.locator('#about-section')).toContainText(hub.fallback);
            expect(errors).toEqual([]);
        });

        test('keeps the static fallback when the fetch fails outright', async ({ page }) => {
            const errors = [];
            page.on('pageerror', e => errors.push(e.message));

            await mockHubRow(page, { descData: null, fail: true });
            await page.goto(hub.path, { waitUntil: 'networkidle' });

            await expect(page.locator('#about-section')).toContainText(hub.fallback);
            expect(errors).toEqual([]);
        });

        test('an empty or mismatched slot does not blank the section', async ({ page }) => {
            // A row exists but names a different slot - the shape you get
            // mid-edit, or after renaming a tab in the editor.
            await mockHubRow(page, { descData: hubDoc('some-other-slot', 'Not for this container.') });
            await page.goto(hub.path, { waitUntil: 'networkidle' });

            const section = page.locator('#about-section');
            await expect(section).toContainText(hub.fallback);
            await expect(section).not.toContainText('Not for this container.');
        });
    });
}

test('the page keeps working around a hub slot: the roster still renders', async ({ page }) => {
    // Guards the reason renderHubSlot must not call loadPageDescriptions:
    // that function appends tab containers to .main-content-area and would
    // take the whole hub over, wiping the roster grid with it.
    await mockHubRow(page, { descData: hubDoc('intro', 'Hub prose.') });
    await page.goto('/characters/index.html', { waitUntil: 'networkidle' });

    await expect(page.locator('#about-section')).toContainText('Hub prose.');
    await expect(page.locator('.roster-card').first()).toBeVisible();
    // loadPageDescriptions' signature move is a #system-dynamic-nav bar.
    await expect(page.locator('#system-dynamic-nav')).toHaveCount(0);
});

test('blocksForSlot flattens sections and tolerates malformed input', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });

    const results = await page.evaluate(() => {
        const { blocksForSlot } = window.__hubInternals;
        return {
            missing: blocksForSlot(null, 'about').length,
            noTabs: blocksForSlot({}, 'about').length,
            wrongSlot: blocksForSlot({ tabs: [{ tabId: 'x', sections: [] }] }, 'about').length,
            nullSection: blocksForSlot({ tabs: [{ tabId: 'a', sections: [null, { blocks: [1, 2] }] }] }, 'a').length,
            flattened: blocksForSlot({ tabs: [{ tabId: 'a', sections: [{ blocks: [1] }, { blocks: [2, 3] }] }] }, 'a').length,
        };
    });

    expect(results).toEqual({ missing: 0, noTabs: 0, wrongSlot: 0, nullSection: 2, flattened: 3 });
});
