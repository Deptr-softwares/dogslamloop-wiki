// Coverage for the v0.11 dashboard widgets (js/dashboards.js).
//
// These are computed views of data the wiki already holds, so the risks are
// data-shaped rather than layout-shaped:
//
//   - They read page_data, the revision feed and the tier list. NONE of those
//     come from navigation.json, so none of them drop an archived page on
//     their own. Every widget has to consult the archive manifest, and a
//     missed one silently advertises a page that was deliberately retired.
//   - A failure must render an explanation. An empty widget and a broken
//     widget look identical to a reader, and only one is worth reporting.
//   - page_completeness does not exist in production until this version's
//     migration merges, so "the table isn't there yet" must not read as a
//     crash.

const { test, expect } = require('@playwright/test');

const COMPLETENESS = [
    // Fully written.
    { page_id: 'boomcat', page_type: 'character', has_profile: true, has_overview: true, has_playstyle: true,
      has_m1s: true, has_skills: true, has_specials: true, has_strategy: true, has_matchups: true, has_counterplay: true },
    // Missing two.
    { page_id: 'vessel', page_type: 'character', has_profile: true, has_overview: true, has_playstyle: true,
      has_m1s: true, has_skills: true, has_specials: true, has_strategy: true, has_matchups: false, has_counterplay: false },
    // Missing nearly everything.
    { page_id: 'honored_one', page_type: 'character', has_profile: true, has_overview: false, has_playstyle: false,
      has_m1s: false, has_skills: false, has_specials: false, has_strategy: false, has_matchups: false, has_counterplay: false },
];

const REVISIONS = [
    { page_id: 'vessel', author_name: 'Alice', created_at: new Date(Date.now() - 86400000).toISOString(), status: 'approved' },
    { page_id: 'vessel', author_name: 'Bob', created_at: new Date(Date.now() - 172800000).toISOString(), status: 'approved' },
    { page_id: 'boomcat', author_name: 'Carol', created_at: new Date(Date.now() - 259200000).toISOString(), status: 'approved' },
];

const TIERLIST = {
    tabs: [{
        id: 'overall',
        tiers: [
            { name: 'S', color: 'hsl(0, 80%, 60%)', characters: ['Boomcat', 'Vessel'] },
            { name: 'F', color: 'hsl(300, 80%, 60%)', characters: ['Honored-One'] },
        ],
    }],
};

async function mockDashboards(page, { completeness = COMPLETENESS, revisions = REVISIONS,
                                       tierlist = TIERLIST, archived = {}, failTable = null } = {}) {
    await page.route('**/data/archived-pages.json*', route => route.fulfill({ json: archived }));

    await page.addInitScript(({ completeness, revisions, tierlist, failTable }) => {
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
                            const fail = failTable === table
                                ? { code: 'PGRST205', message: 'Could not find the table' }
                                : null;

                            if (table === 'page_completeness') {
                                const chain = {
                                    select() { return chain; },
                                    eq: () => Promise.resolve({ data: fail ? null : completeness, error: fail }),
                                };
                                return chain;
                            }
                            if (table === 'pending_revisions') {
                                const chain = {
                                    select() { return chain; },
                                    eq() { return chain; },
                                    order() { return chain; },
                                    limit: () => Promise.resolve({ data: fail ? null : revisions, error: fail }),
                                    then(resolve, reject) {   // the stats query awaits after .eq()
                                        return Promise.resolve({ data: fail ? null : revisions, error: fail })
                                            .then(resolve, reject);
                                    },
                                };
                                return chain;
                            }
                            if (table === 'site_pages') {
                                const chain = {
                                    select() { return chain; },
                                    eq: () => Promise.resolve({ data: [], count: 39, error: null }),
                                };
                                return chain;
                            }
                            if (table === 'page_data') {
                                const chain = {
                                    select() { return chain; },
                                    eq() { return chain; },
                                    maybeSingle: async () => ({ data: { desc_data: tierlist }, error: fail }),
                                };
                                return chain;
                            }
                            return origFrom(table);
                        };
                        return client;
                    };
                    lib.__patched = true;
                }
            },
        });
    }, { completeness, revisions, tierlist, failTable });
}

// ---------------------------------------------------------------- needs work

test('needs-work lists work-in-progress characters, least complete first', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await mockDashboards(page);
    await page.goto('/characters/index.html', { waitUntil: 'networkidle' });

    const rows = page.locator('#needs-work .needs-work-row');
    await expect(rows.first()).toBeVisible();

    // Re-render without the row cap. The default shows six, and the real
    // roster has eighteen characters tied on "missing everything", so the
    // ordering being asserted here is invisible in the top six.
    await page.evaluate(() => window.buildNeedsWork('needs-work', 100));
    await expect(rows.first()).toBeVisible();

    const names = await page.locator('#needs-work .needs-work-name').allTextContents();
    // Honored One is missing 8 sections, Vessel 2 - so Honored One sorts first.
    expect(names.indexOf('Honored One')).toBeLessThan(names.indexOf('Vessel'));
    expect(names.indexOf('Honored One')).toBeGreaterThanOrEqual(0);
    // Boomcat is not flagged work-in-progress in navigation.json, so it must
    // not appear regardless of how complete it is.
    expect(names).not.toContain('Boomcat');

    await expect(rows.filter({ hasText: 'Vessel' })).toContainText('Matchups');
    await expect(rows.filter({ hasText: 'Vessel' })).toContainText('Counterplay');
    expect(errors).toEqual([]);
});

test('a work-in-progress page with nothing missing still appears', async ({ page }) => {
    // is_wip is an editorial judgement, not a measurement - a page can be
    // structurally complete and still be flagged as needing work.
    const complete = ['vessel', 'honored_one'].map(page_id => ({
        page_id, page_type: 'character', has_profile: true, has_overview: true, has_playstyle: true,
        has_m1s: true, has_skills: true, has_specials: true, has_strategy: true,
        has_matchups: true, has_counterplay: true,
    }));

    await mockDashboards(page, { completeness: complete });
    await page.goto('/characters/index.html', { waitUntil: 'networkidle' });
    await expect(page.locator('#needs-work .needs-work-row').first()).toBeVisible();

    await page.evaluate(() => window.buildNeedsWork('needs-work', 100));
    const rows = page.locator('#needs-work .needs-work-row');
    await expect(rows.filter({ hasText: 'Vessel' })).toContainText('in progress');
});

test('the list is capped, and says how many it left out', async ({ page }) => {
    await mockDashboards(page);
    await page.goto('/characters/index.html', { waitUntil: 'networkidle' });

    await expect(page.locator('#needs-work .needs-work-row')).toHaveCount(6);
    await expect(page.locator('#needs-work .needs-work-more')).toContainText('more');
});

test('a work-in-progress page with no completeness row counts as missing everything', async ({ page }) => {
    // register has no page_data row in production. It must appear, not vanish.
    await mockDashboards(page, { completeness: [] });
    await page.goto('/characters/index.html', { waitUntil: 'networkidle' });
    await expect(page.locator('#needs-work .needs-work-row').first()).toBeVisible();

    // Uncapped: with no completeness rows at all every character ties, so the
    // default six are just the alphabetical head of the roster.
    await page.evaluate(() => window.buildNeedsWork('needs-work', 100));
    await expect(page.locator('#needs-work .needs-work-row').first()).toBeVisible();

    const names = await page.locator('#needs-work .needs-work-name').allTextContents();
    expect(names).toContain('Register');
    // The Template page is documentation, not a character anyone should fill in.
    expect(names).not.toContain('Template & Guide');
});

test('needs-work reports a missing table instead of rendering nothing', async ({ page }) => {
    // The state between pushing this branch and merging its migration.
    await mockDashboards(page, { failTable: 'page_completeness' });
    await page.goto('/characters/index.html', { waitUntil: 'networkidle' });

    await expect(page.locator('#needs-work')).toContainText('Could not work out what needs writing');
});

// ---------------------------------------------------------------- recent edits

test('recent edits shows one row per character, newest first', async ({ page }) => {
    await mockDashboards(page);
    await page.goto('/characters/index.html', { waitUntil: 'networkidle' });

    const rows = page.locator('#recent-character-edits .recent-edit-row');
    await expect(rows.first()).toBeVisible();

    const names = await page.locator('#recent-character-edits .recent-edit-name').allTextContents();
    // Vessel was edited twice in a row; that is one piece of news, not two.
    expect(names.filter(n => n === 'Vessel')).toHaveLength(1);
    expect(names[0]).toBe('Vessel');
    await expect(rows.first()).toContainText('Alice');
});

// ---------------------------------------------------------------- tier snapshot

test('tier snapshot renders tiers with their characters', async ({ page }) => {
    await mockDashboards(page);
    await page.goto('/characters/index.html', { waitUntil: 'networkidle' });

    const rows = page.locator('#tier-snapshot .tier-snapshot-row');
    await expect(rows.first()).toBeVisible();
    await expect(rows.first()).toContainText('S');
    await expect(rows.first()).toContainText('Boomcat');
    await expect(page.locator('#tier-snapshot')).toContainText('Honored One');
});

// ---------------------------------------------------------------- archived filtering

test('every character widget hides a page whose entry points are hidden', async ({ page }) => {
    // The debt stage 1 left open: these widgets read page_data, the revision
    // feed and the tier list, none of which come from navigation.json, so none
    // drop an archived page on their own.
    await mockDashboards(page, {
        archived: {
            vessel: { name: 'Vessel', url: 'characters/Vessel/index.html', navId: 'Vessel', hideEntryPoints: true },
        },
    });
    await page.goto('/characters/index.html', { waitUntil: 'networkidle' });

    await expect(page.locator('#needs-work .needs-work-row').first()).toBeVisible();
    expect(await page.locator('#needs-work .needs-work-name').allTextContents()).not.toContain('Vessel');
    expect(await page.locator('#recent-character-edits .recent-edit-name').allTextContents()).not.toContain('Vessel');
    expect(await page.locator('#tier-snapshot .tier-snapshot-name').allTextContents()).not.toContain('Vessel');
});

test('archiving alone does not hide anything', async ({ page }) => {
    // hideEntryPoints defaults false, and archiving must stay a cheap,
    // reversible decision.
    await mockDashboards(page, {
        archived: {
            vessel: { name: 'Vessel', url: 'characters/Vessel/index.html', navId: 'Vessel', hideEntryPoints: false },
        },
    });
    await page.goto('/characters/index.html', { waitUntil: 'networkidle' });

    await expect(page.locator('#tier-snapshot .tier-snapshot-row').first()).toBeVisible();
    expect(await page.locator('#tier-snapshot .tier-snapshot-name').allTextContents()).toContain('Vessel');
});

// ---------------------------------------------------------------- side dashboard

test('wiki stats renders real counts', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await mockDashboards(page);
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    const stats = page.locator('#wiki-stats .wiki-stat');
    await expect(stats).toHaveCount(3);
    await expect(page.locator('#wiki-stats')).toContainText('39');       // live pages
    await expect(page.locator('#wiki-stats')).toContainText('3');        // approved edits
    expect(errors).toEqual([]);
});

test('the reading path is ordered and every step resolves', async ({ page }) => {
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    const steps = page.locator('#start-here-section .reading-step');
    await expect(steps).toHaveCount(6);
    await expect(steps.first()).toContainText('Starter Guide');

    // An <ol>, so the order is in the markup rather than only in the styling.
    expect(await page.locator('#start-here-section ol.reading-path').count()).toBe(1);

    for (const href of await steps.locator('a').evaluateAll(els => els.map(e => e.getAttribute('href')))) {
        const res = await page.request.get(`/systems/${href}`);
        expect(res.status(), `${href} does not resolve`).toBeLessThan(400);
    }
});

test('how-to-contribute links resolve', async ({ page }) => {
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    const links = page.locator('#contribute-section a');
    await expect(links.first()).toBeVisible();

    for (const href of await links.evaluateAll(els => els.map(e => e.getAttribute('href')))) {
        const res = await page.request.get(`/systems/${href}`);
        expect(res.status(), `${href} does not resolve`).toBeLessThan(400);
    }
});

test('the glossary stays hidden while the terminology page is a placeholder', async ({ page }) => {
    // Its only tab currently holds "Write your strategy here...". A glossary
    // box advertising an empty glossary is worse than no box.
    await mockDashboards(page, {
        tierlist: { tabs: [{ tabId: 'archetypes', sections: [{ blocks: [
            { type: 'heading', content: 'What is an archetype in JJS?' },
            { type: 'paragraph', content: 'Write your strategy here...' },
        ] }] }] },
    });
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    await expect(page.locator('#glossary-section')).toBeHidden();
});

test('the glossary appears once the terminology page has real content', async ({ page }) => {
    await mockDashboards(page, {
        tierlist: { tabs: [{ tabId: 'terms', sections: [{ blocks: [
            { type: 'heading', content: 'Startup' },
            { type: 'paragraph', content: 'Frames before a move becomes active.' },
            { type: 'heading', content: 'Recovery' },
            { type: 'paragraph', content: 'Frames after the active window, before you can act.' },
        ] }] }] },
    });
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    await expect(page.locator('#glossary-section')).toBeVisible();
    await expect(page.locator('#glossary-peek')).toContainText('Startup');
    await expect(page.locator('#glossary-peek')).toContainText('Frames before a move becomes active.');
});
