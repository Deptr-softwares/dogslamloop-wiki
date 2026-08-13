// The Certified Tier List, as N per-person lists (v0.14 item 3).
//
// The page held 22 tabs - one Overall plus 21 "vs <character>" - and now holds
// one list per assigned individual, credited by name.
//
// The claim this page exists to make: frame data is measurable and a tier list
// is opinion, and an unattributed ranking quietly presents the second as the
// first. Most of what follows tests that the page keeps making it - a reader
// lands on nobody, every list is named, and no combined ranking is offered.
//
// Not reachable from a browser, and probed live instead: per-row ownership
// (the assignee edits their own list and nobody else's), and the note-per-move
// rule, which is a NOT NULL plus a length floor in the schema.
const { test, expect } = require('@playwright/test');

const PAGE = '/systems/tierlist/index.html';

const list = (over = {}) => ({
    id: over.slug ? `id-${over.slug}` : 'id-owner',
    slug: 'owner',
    author_name: 'Air Putrifier',
    blurb: 'The original certified ranking.',
    status: 'published',
    updated_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    tiers: [
        { name: 'S', color: 'hsl(0, 80%, 60%)', characters: ['ten_shadows', 'puppet_master'] },
        { name: 'A', color: 'hsl(30, 80%, 60%)', characters: ['true_cannon'] },
        { name: 'F', color: 'hsl(300, 80%, 60%)', characters: [] },
    ],
    reasoning: [],
    ...over,
});

async function mockLists(page, { lists = [], changes = [], listError = null } = {}) {
    await page.addInitScript(({ lists, changes, listError }) => {
        Object.defineProperty(window, 'supabase', {
            configurable: true,
            get() { return window.__lib; },
            set(lib) {
                window.__lib = lib;
                if (!lib || !lib.createClient || lib.__patched) return;
                lib.__patched = true;
                const orig = lib.createClient.bind(lib);
                lib.createClient = (...args) => {
                    const client = orig(...args);
                    client.auth.getSession = async () => ({ data: { session: null } });

                    client.from = (table) => {
                        if (table === 'tier_lists') {
                            const q = {};
                            const chain = {
                                select() { return chain; },
                                eq(col, val) { q[col] = val; return chain; },
                                order() { return chain; },
                                maybeSingle: async () => {
                                    if (listError) return { data: null, error: listError };
                                    return { data: lists.find(l => l.slug === q.slug) || null, error: null };
                                },
                                then(resolve) {
                                    if (listError) return resolve({ data: null, error: listError });
                                    return resolve({ data: lists, error: null });
                                },
                            };
                            return chain;
                        }
                        if (table === 'tier_list_changes') {
                            const chain = {
                                select() { return chain; }, eq() { return chain; },
                                order() { return chain; }, limit() { return chain; },
                                then(resolve) { return resolve({ data: changes, error: null }); },
                            };
                            return chain;
                        }
                        const inert = new Proxy({}, {
                            get(_t, prop) {
                                if (prop === 'then') return (r) => r({ data: [], error: null });
                                if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null });
                                return () => inert;
                            },
                        });
                        return inert;
                    };
                    client.rpc = async () => ({ data: null, error: null });
                    return client;
                };
            },
        });
    }, { lists, changes, listError });
}

async function open(page, url = PAGE) {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('#tier-list-ui');
}

test('a reader lands on nobody', async ({ page }) => {
    // The feature, not a loading state. There is no unattributed default to
    // mistake for the wiki's own opinion.
    await mockLists(page, { lists: [list(), list({ slug: 'guest', author_name: 'frameperfect' })] });
    await open(page);

    await expect(page.locator('.ctl-nobody')).toBeVisible();
    await expect(page.locator('.ctl-nobody-title')).toContainText('Pick someone');
    await expect(page.locator('.ctl-row'), 'no placements rendered until a name is clicked').toHaveCount(0);
    await expect(page.locator('.ctl-author-btn.active')).toHaveCount(0);
});

test('the page offers no combined or default ranking', async ({ page }) => {
    // Averaging opinions into an official one is exactly what this design
    // rejects, so nothing on the page should offer it.
    await mockLists(page, { lists: [list(), list({ slug: 'b', author_name: 'voidwalker' })] });
    await open(page);

    const buttons = await page.locator('.ctl-author-btn').allTextContents();
    expect(buttons).toHaveLength(2);
    const combined = buttons.filter(t => /overall|combined|average|consensus|official/i.test(t));
    expect(combined, 'every entry is a person').toEqual([]);
});

test('clicking a name loads that person\'s list', async ({ page }) => {
    await mockLists(page, { lists: [list()] });
    await open(page);

    await page.click('[data-list-slug="owner"]');

    await expect(page.locator('.ctl-author')).toHaveText('Air Putrifier');
    await expect(page.locator('.ctl-row')).toHaveCount(3);
    await expect(page.locator('.ctl-label').first()).toHaveText('S');
    await expect(page.locator('.ctl-author-btn.active')).toHaveCount(1);
    await expect(page.locator('.ctl-nobody')).toHaveCount(0);
});

test('portraits resolve from page_id, the key the migration rewrote them to', async ({ page }) => {
    // The old tabs stored navigation display slugs and leaned on a normalizer;
    // three of the twenty-one differed from their real page id by more than
    // punctuation and only matched by luck. This lookup is exact.
    await mockLists(page, {
        lists: [list({ tiers: [{ name: 'S', color: '#f00', characters: ['aspiring_mangaka', 'crow_charmer', 'locust_guy'] }] })],
    });
    await open(page);
    await page.click('[data-list-slug="owner"]');

    const names = await page.locator('.tier-portrait-name').allTextContents();
    // These three are the reason the keys were rewritten: their navigation
    // slugs were Mangaka / Sus-Sister / Locust, which match neither their
    // page_id nor their display name. Resolving from page_id gets the proper
    // name out, which the old normalizer also managed - but only because the
    // slug happened to agree, which is not a property anybody was maintaining.
    expect(names).toEqual(['Aspiring Mangaka', 'Crow Charmer', 'Locust Guy']);
    // Resolved, so they link to the character page rather than dead-ending.
    const hrefs = await page.locator('.tier-portrait').evaluateAll(els => els.map(e => e.getAttribute('href')));
    expect(hrefs.every(h => h && h !== '#')).toBe(true);
});

test('an unresolved character key is visible rather than silently dropped', async ({ page }) => {
    // The migration keeps an unmatched key rather than discarding the
    // placement: losing one silently would be worse than showing one that
    // needs fixing.
    await mockLists(page, {
        lists: [list({ tiers: [{ name: 'S', color: '#f00', characters: ['ten_shadows', 'not_a_character'] }] })],
    });
    await open(page);
    await page.click('[data-list-slug="owner"]');

    await expect(page.locator('.tier-portrait')).toHaveCount(2);
    await expect(page.locator('.tier-portrait-name').nth(1)).toHaveText('not a character');
});

test('an empty tier says so instead of collapsing', async ({ page }) => {
    await mockLists(page, { lists: [list()] });
    await open(page);
    await page.click('[data-list-slug="owner"]');

    const lastRow = page.locator('.ctl-row').last();
    await expect(lastRow.locator('.ctl-label')).toHaveText('F');
    await expect(lastRow.locator('.ctl-empty-note')).toHaveText('nobody');
});

test('every move in the changelog carries its note', async ({ page }) => {
    // The owner's rule, enforced by NOT NULL plus a length floor in the
    // schema. A changelog saying "moved Vessel from D to B" and nothing else
    // is the artefact this was meant to prevent.
    await mockLists(page, {
        lists: [list()],
        changes: [
            { id: 'c1', list_id: 'id-owner', character_id: 'vessel', from_tier: 'F', to_tier: 'D', note: 'Buffed dash cancel makes the neutral survivable.', created_at: '2026-08-12T00:00:00Z' },
            { id: 'c2', list_id: 'id-owner', character_id: 'boomcat', from_tier: null, to_tier: 'B', note: 'New character, provisional placement.', created_at: '2026-08-11T00:00:00Z' },
        ],
    });
    await open(page);
    await page.click('[data-list-slug="owner"]');

    const entries = page.locator('.ctl-change');
    await expect(entries).toHaveCount(2);
    await expect(entries.nth(0).locator('.ctl-change-move')).toHaveText('F → D');
    await expect(entries.nth(0).locator('.ctl-change-note')).toContainText('dash cancel');
    // A first placement is a real event with its own wording.
    await expect(entries.nth(1).locator('.ctl-change-move')).toHaveText('added to B');

    const notes = await entries.locator('.ctl-change-note').allTextContents();
    expect(notes.every(n => n.trim().length > 0), 'no move without a note').toBe(true);
});

test('the picker says when each list was last updated', async ({ page }) => {
    // What gives a returning reader a reason to pick one out of several.
    await mockLists(page, {
        lists: [
            list({ slug: 'a', author_name: 'alpha', updated_at: new Date().toISOString() }),
            list({ slug: 'b', author_name: 'beta', updated_at: new Date(Date.now() - 5 * 86400000).toISOString() }),
        ],
    });
    await open(page);

    await expect(page.locator('[data-list-slug="a"] .ctl-author-updated')).toHaveText('updated today');
    await expect(page.locator('[data-list-slug="b"] .ctl-author-updated')).toHaveText('updated 5 days ago');
});

test('a shared ?list= link opens on that person', async ({ page }) => {
    await mockLists(page, { lists: [list(), list({ slug: 'guest', author_name: 'frameperfect' })] });
    await open(page, `${PAGE}?list=guest`);

    await expect(page.locator('.ctl-author')).toHaveText('frameperfect');
    await expect(page.locator('[data-list-slug="guest"]')).toHaveClass(/active/);
});

test('an unknown ?list= still lands on nobody rather than erroring', async ({ page }) => {
    await mockLists(page, { lists: [list()] });
    await open(page, `${PAGE}?list=does-not-exist`);

    await expect(page.locator('.ctl-nobody')).toBeVisible();
});

test('author names and notes are never parsed as markup', async ({ page }) => {
    await mockLists(page, {
        lists: [list({ author_name: '<img src=x onerror="window.__pwned=1">evil', blurb: '<b>bold</b>' })],
        changes: [{ id: 'c1', list_id: 'id-owner', character_id: 'vessel', from_tier: 'F', to_tier: 'D', note: '<script>window.__pwned2=1</script>', created_at: '2026-08-12T00:00:00Z' }],
    });
    await open(page);
    await page.click('[data-list-slug="owner"]');

    const result = await page.evaluate(() => ({
        pwned: !!window.__pwned,
        pwned2: !!window.__pwned2,
        imgs: document.querySelectorAll('#tier-list-ui img:not(.tier-portrait-img)').length,
        bolds: document.querySelectorAll('#tier-list-ui b, #changelog-container b').length,
        scripts: document.querySelectorAll('#changelog-container script').length,
    }));

    expect(result.pwned).toBe(false);
    expect(result.pwned2).toBe(false);
    expect(result.imgs).toBe(0);
    expect(result.bolds).toBe(0);
    expect(result.scripts).toBe(0);
});

test('a missing migration says so rather than rendering a broken page', async ({ page }) => {
    // The normal state between writing the migration and the release.
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));

    await mockLists(page, { listError: { code: 'PGRST205', message: 'Could not find the table' } });
    await open(page);

    await expect(page.locator('#tier-list-ui')).toContainText('next release');
    expect(pageErrors).toEqual([]);
});

test('the intro explains why the lists are attributed', async ({ page, request }) => {
    // Asserted against the served markup: it is hand-authored copy, and it is
    // the only place the page states the reasoning behind its own design.
    const html = await (await request.get(PAGE)).text();
    expect(html).toContain('belongs to one person');
    expect(html).toMatch(/opinion/i);
});
