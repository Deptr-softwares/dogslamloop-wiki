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

// --- INTRODUCTIONS (v0.14 owner tools) -----------------------------------
//
// Two introductions exist and only one is ever on screen: the page's own,
// shown before anybody is picked, and the author's, shown in its place once
// somebody is. That swap is the feature - two stacked would make every list
// read as a subsection of the owner's page, which is the opposite of what
// attributing them was for.

test('the page introduction shows while nobody is picked', async ({ page }) => {
    await mockLists(page, { lists: [list()] });
    await open(page);

    await expect(page.locator('#tier-page-intro')).toBeVisible();
    await expect(page.locator('.ctl-intro')).toHaveCount(0);
});

test('picking a person swaps the page introduction for theirs', async ({ page }) => {
    await mockLists(page, {
        lists: [list({ intro: [{ type: 'paragraph', content: 'I play zoners and rate them kindly.' }] })],
    });
    await open(page);

    await page.click('[data-list-slug="owner"]');

    await expect(page.locator('#tier-page-intro'), 'the page speaks until somebody else does').toBeHidden();
    const intro = page.locator('.ctl-intro');
    await expect(intro).toBeVisible();
    await expect(intro).toContainText('Tier List Introduction');
    await expect(intro).toContainText('zoners');
});

test('the introduction sits above the tiers, not below them', async ({ page }) => {
    // A reader should meet the author before the ranking, and the reasoning
    // only after it - otherwise the argument arrives before the thing it is
    // about.
    await mockLists(page, {
        lists: [list({ intro: [{ type: 'paragraph', content: 'who I am' }] })],
    });
    await open(page);
    await page.click('[data-list-slug="owner"]');

    const order = await page.evaluate(() => {
        const intro = document.querySelector('.ctl-intro');
        const firstRow = document.querySelector('.ctl-row');
        return !!(intro && firstRow
            && (intro.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    expect(order).toBe(true);
});

test('going back to nobody brings the page introduction back', async ({ page }) => {
    await mockLists(page, {
        lists: [list({ intro: [{ type: 'paragraph', content: 'mine' }] })],
    });
    await open(page, `${PAGE}?list=owner`);

    await expect(page.locator('#tier-page-intro')).toBeHidden();

    // Reloading without the parameter is how a reader gets back to the picker.
    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await expect(page.locator('#tier-page-intro')).toBeVisible();
});

test('a list with no introduction simply has none', async ({ page }) => {
    // Nobody is obliged to write one, and an empty bordered box would read as
    // something failing to load.
    await mockLists(page, { lists: [list({ intro: [] })] });
    await open(page);
    await page.click('[data-list-slug="owner"]');

    await expect(page.locator('.ctl-intro')).toHaveCount(0);
    await expect(page.locator('.ctl-row')).toHaveCount(3);
});

test('the reasoning actually renders, which it could not before', async ({ page }) => {
    // A regression test for a bug that shipped in PR #81 and was invisible for
    // a day: js/description.js was not loaded on this page, so
    // generateHTMLForBlocks did not exist and the reasoning section could
    // never have rendered at all.
    //
    // Thirteen tests missed it because every fixture had `reasoning: []`. An
    // empty array takes the same branch as a missing renderer, so the tests
    // agreed with the bug. This one supplies content, which is the only way
    // the difference is observable.
    await mockLists(page, {
        lists: [list({
            reasoning: [
                { type: 'heading', content: 'On the top tier' },
                { type: 'paragraph', content: 'Ten Shadows wins neutral for free.' },
            ],
        })],
    });
    await open(page);
    await page.click('[data-list-slug="owner"]');

    const reasoning = page.locator('.ctl-reasoning');
    await expect(reasoning).toBeVisible();
    await expect(reasoning).toContainText('On the top tier');
    await expect(reasoning).toContainText('wins neutral for free');

    // Rendered as real markup by the site's own block renderer, not dumped as
    // text - which is the whole reason for reusing it.
    const headings = await reasoning.locator('h1, h2, h3, h4').count();
    expect(headings).toBeGreaterThan(0);
});

test('the block renderer is present on this page at all', async ({ page }) => {
    // The direct form of the same check. Both introductions and the reasoning
    // depend on it, and its absence degrades silently to rendering nothing.
    await mockLists(page, { lists: [list()] });
    await open(page);

    const available = await page.evaluate(() => typeof window.generateHTMLForBlocks === 'function');
    expect(available, 'js/description.js must be loaded for the block sections to render').toBe(true);
});

// --- THE STOREFRONT (v0.14) ----------------------------------------------
//
// The foundations were reworked over several PRs and the page's own chrome was
// left behind: its edit button still pointed at the contributor editor, and
// its sidebar header ran off the right edge of the window.

test('the edit button opens the tier list editor, not the page editor', async ({ page, request }) => {
    // The old button routed to edit.html, which edits the page_data row holding
    // the retired 22-tab shape - so it opened the wrong editor on data nothing
    // renders any more.
    const html = await (await request.get(PAGE)).text();
    await page.goto('about:blank');

    const wiring = await page.evaluate((html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const btn = doc.getElementById('btn-edit-current-tab');
        return {
            exists: !!btn,
            href: btn ? btn.getAttribute('href') : null,
            // The id is kept - tests/routing.spec.js asserts elevated pages
            // still offer an edit affordance, and that is still true. What had
            // to change is the destination, and that nothing re-binds it.
            mobileHref: (doc.getElementById('btn-edit-current-tab-mobile') || {}).getAttribute
                ? doc.getElementById('btn-edit-current-tab-mobile').getAttribute('href') : null,
            callsOldWiring: html.includes('initTabEditorButtons('),
        };
    }, html);

    expect(wiring.exists).toBe(true);
    expect(wiring.href).toContain('tier-editor.html');
    expect(wiring.href).not.toContain('edit.html');
    expect(wiring.mobileHref, 'a phone needs the same route').toContain('tier-editor.html');
    expect(wiring.callsOldWiring, 'nothing re-points it at edit.html/history.html').toBe(false);
});

test('the sidebar header stays inside the window', async ({ page }) => {
    // The reported symptom: title and buttons on one non-wrapping row, running
    // past the right edge. Measured against the viewport rather than compared
    // to a pixel value, so it is not an OS-dependent assertion.
    await mockLists(page, { lists: [list()] });
    await open(page);

    const overflow = await page.evaluate(() => {
        const header = document.querySelector('.tierlist-sidebar-header');
        if (!header) return { missing: true };
        const rect = header.getBoundingClientRect();
        const widest = Array.from(header.querySelectorAll('*'))
            .reduce((max, el) => Math.max(max, el.getBoundingClientRect().right), 0);
        return {
            missing: false,
            headerRight: rect.right,
            widestChildRight: widest,
            viewportWidth: window.innerWidth,
            documentScrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
    });

    expect(overflow.missing).toBe(false);
    expect(overflow.widestChildRight).toBeLessThanOrEqual(overflow.viewportWidth);
    expect(overflow.headerRight).toBeLessThanOrEqual(overflow.viewportWidth);
    expect(overflow.documentScrolls, 'nothing pushes the page sideways').toBe(false);
});
