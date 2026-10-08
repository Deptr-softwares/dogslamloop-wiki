// Protects the v0.11 hub CMS: the three dashboards render their intro prose
// from page_data instead of hardcoded markup.
//
// THE CMS IS THE ONLY COPY (v1.0 Part 3). Until then each intro shipped a
// hand-written paragraph as a fallback, kept so that an outage still showed
// text. It went stale: the About Us a reader saw for the first moment of every
// visit was copy the owner had long since rewritten. Owner, 2026-10-08:
// "clear the old hardcoded texts in place of the CMS generated texts". So the
// contract now is that the old copy can never show: the container loads, then
// holds the CMS text, a line saying it could not load, or nothing.

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

// `old` is a phrase from the hand-written copy each page used to ship.
const HUBS = [
    { path: '/index.html', pageId: 'main-hub', slot: 'about', old: 'casual (shenanigans) battleground' },
    { path: '/characters/index.html', pageId: 'character-hub', slot: 'intro', old: 'Welcome to the Character Dashboard' },
    { path: '/systems/index.html', pageId: 'systems-hub', slot: 'intro', old: 'Welcome to the Side Dashboard' },
];

const COULD_NOT_LOAD = 'Could not load this text.';

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
            await expect(page.locator('#about-body')).not.toContainText('Loading...');
            expect(errors).toEqual([]);
        });

        test('shows a line, never old copy, when the fetch fails outright', async ({ page }) => {
            const errors = [];
            page.on('pageerror', e => errors.push(e.message));

            await mockHubRow(page, { descData: null, fail: true });
            await page.goto(hub.path, { waitUntil: 'networkidle' });

            await expect(page.locator('#about-body')).toHaveText(new RegExp(COULD_NOT_LOAD));
            await expect(page.locator('#about-section')).not.toContainText(hub.old);
            expect(errors).toEqual([]);
        });

        // A row that names a different slot is the shape you get mid-edit, or
        // after renaming a tab in the editor; no row at all is a hub nobody
        // has written for. Neither is a failure, so neither says so.
        test('a slot under another name leaves the section empty', async ({ page }) => {
            await mockHubRow(page, { descData: hubDoc('some-other-slot', 'Not for this container.') });
            await page.goto(hub.path, { waitUntil: 'networkidle' });

            await expect(page.locator('#about-body')).toHaveText('');
        });

        test('no row at all leaves the section empty', async ({ page }) => {
            await mockHubRow(page, { descData: null });
            await page.goto(hub.path, { waitUntil: 'networkidle' });

            await expect(page.locator('#about-body')).toHaveText('');
            await expect(page.locator('#about-section')).not.toContainText(hub.old);
        });
    });
}

// The five headings with no site_meta value, so the markup is their only copy
// (the owner chose to leave them, 2026-10-08). Every other heading key is set
// by site_meta and ships blank.
const HAND_WRITTEN_HEADINGS = ['others', 'tools', 'startHere', 'contribute', 'stats'];

for (const hub of HUBS) {
    test(`with every source unreachable, ${hub.path} shows nothing hand-written in the CMS regions`, async ({ page }) => {
        // The database AND the committed site_meta.json, so nothing can fill
        // a region and only what the page itself ships is left to see.
        await page.route(/supabase\.co/, route => route.abort());
        await page.route('**/data/site_meta.json*', route => route.abort());
        await page.goto(hub.path, { waitUntil: 'networkidle' });
        // The Supabase client retries for about 8 seconds before it reports
        // the failure (measured 2026-10-08).
        await expect(page.locator('#about-body')).toContainText(COULD_NOT_LOAD, { timeout: 20000 });

        const seen = await page.evaluate((ids) => Object.fromEntries(ids
            .filter(id => document.getElementById(id))
            .map(id => [id, document.getElementById(id).textContent.replace(/\s+/g, ' ').trim()])),
        ['about-body', 'game-info-fields', 'start-here-list', 'contribute-list']);
        // Positive first: the intro is on the page and says why it is empty.
        expect(seen['about-body']).toMatch(COULD_NOT_LOAD);
        for (const [id, text] of Object.entries(seen)) {
            if (id !== 'about-body') expect(text, `#${id}`).toBe('');
        }

        const headings = await page.evaluate(() => [...document.querySelectorAll('[data-heading-key]')]
            .map(el => [el.dataset.headingKey, el.textContent.trim()]));
        expect(headings.length).toBeGreaterThan(0);
        for (const [key, text] of headings) {
            if (HAND_WRITTEN_HEADINGS.includes(key)) expect(text, key).not.toBe('');
            else expect(text, `heading "${key}" ships hand-written text`).toBe('');
        }
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
