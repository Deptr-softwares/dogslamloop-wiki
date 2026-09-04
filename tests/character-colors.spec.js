// A character's colour becomes data instead of code.
//
// Owner: "There is no way to set a character color code there. This ties into a
// bigger problem where creating a new character page can not account for
// including but not limited to making new color code, applying that color
// throughout the site (mainly auto-coloring), and probably more."
//
// window.CHARACTER_COLORS was a hardcoded literal in js/site_meta.js read
// SYNCHRONOUSLY by ten files, so a new character's colour needed a code edit, a
// PR and a release. The source is now site_pages.color, generated into a marked
// region of the same file - which keeps the literal synchronous, because making
// it a fetch would mean changing all ten consumers and inventing a load-order
// problem the site does not have.
//
// The generator tests below are node-only and run through the Playwright runner
// like tests/generate-pages.spec.js.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE_META = path.join(ROOT, 'js', 'site_meta.js');
const {
    buildCharacterColors, replaceRegion, COLORS_BEGIN, COLORS_END,
} = require('../scripts/fetch-content.js');

const ROWS = [
    { page_id: 'vessel', name: 'Vessel', page_type: 'character', color: 'hsl(0, 100%, 80%)', sort_order: 10 },
    { page_id: 'boomcat', name: 'Boomcat', page_type: 'character', color: '#c0c0bf', sort_order: 20 },
    { page_id: 'nocolor', name: 'No Colour', page_type: 'character', color: null, sort_order: 30 },
    { page_id: 'framedata', name: 'Frame Data', page_type: 'system', color: '#123456', sort_order: 40 },
];

// --- THE GENERATOR ---

test('only characters with a colour reach the dictionary', () => {
    const out = buildCharacterColors(ROWS);

    expect(out).toContain('"Vessel": "hsl(0, 100%, 80%)"');
    expect(out).toContain('"Boomcat": "#c0c0bf"');
    // A character with no colour is absent, not present-and-empty: every
    // consumer already falls back when the name is missing, and "" is a value
    // that renders as nothing.
    expect(out).not.toContain('No Colour');
    // A system page has no roster card and no name to colour in prose.
    expect(out).not.toContain('Frame Data');
});

test('the dictionary is keyed by name, which is what every consumer looks up', () => {
    // page_id is the database's key. pagebuilder.js has the name, and
    // internalstyling.js matches names in prose - so keying by page_id would
    // produce a dictionary nothing could read.
    const out = buildCharacterColors(ROWS);
    expect(out).not.toContain('vessel"');
    expect(out).toContain('"Vessel"');
});

test('a name with a quote in it cannot break the file', () => {
    // JSON.stringify rather than string concatenation. The name comes from the
    // database and this output is executable JavaScript.
    const out = buildCharacterColors([
        { name: 'He said "hi"', page_type: 'character', color: '#fff', sort_order: 1 },
    ]);
    expect(out).toContain('"He said \\"hi\\""');
    // And it still parses as JS, which is the actual claim.
    expect(() => new Function(out.replace(COLORS_BEGIN, '').replace(COLORS_END, ''))).not.toThrow();
});

test('a database without the column yet is skipped, not failed', () => {
    // THE DEPLOY WINDOW, and the reason this is not simply "throw on empty".
    // Migrations apply on merge to main, so between this landing on
    // next-update and the release, production has no `color` column and
    // select=* returns rows without the key. Failing there would take the FAQ
    // and collaborator refresh down with it over a column that has not shipped.
    const preMigration = ROWS.map(({ color, ...rest }) => rest);
    expect(buildCharacterColors(preMigration)).toBeNull();
});

test('the column existing but empty is still refused', () => {
    // The distinction the check above rests on. Present-and-all-NULL is the
    // dangerous case - it would un-colour the entire roster - and must not be
    // mistaken for not-deployed.
    const allNull = ROWS.map(r => ({ ...r, color: null }));
    expect(() => buildCharacterColors(allNull)).toThrow(/no character page has a colour/i);
});

test('an empty roster is refused rather than written', () => {
    // Same rule as fetchTable's zero-row guard: an empty result is a broken
    // query or a policy change, never a request to un-colour the whole roster.
    expect(() => buildCharacterColors([
        { name: 'Frame Data', page_type: 'system', color: '#123456', sort_order: 1 },
    ])).toThrow(/no character page has a colour/i);
});

test('the output is stable, so a rerun is not a diff', () => {
    expect(buildCharacterColors(ROWS)).toBe(buildCharacterColors([...ROWS].reverse()));
});

// --- THE REGION SWAP ---

test('replacing the region leaves the rest of the file byte-identical', () => {
    const before = fs.readFileSync(SITE_META, 'utf8');
    const after = replaceRegion(before, buildCharacterColors(ROWS));

    // The hand-authored halves must survive untouched. These are the whole
    // reason this is a region and not a whole-file generator.
    expect(after).toContain('window.CHARACTER_ALIASES');
    expect(after).toContain('window.applyCharacterTheme');
    expect(after.slice(after.indexOf(COLORS_END))).toBe(before.slice(before.indexOf(COLORS_END)));
    expect(after.slice(0, after.indexOf(COLORS_BEGIN))).toBe(before.slice(0, before.indexOf(COLORS_BEGIN)));
});

test('the swap is idempotent', () => {
    const before = fs.readFileSync(SITE_META, 'utf8');
    const once = replaceRegion(before, buildCharacterColors(ROWS));
    expect(replaceRegion(once, buildCharacterColors(ROWS))).toBe(once);
});

test('a file without the markers is refused, not guessed at', () => {
    // generate-pages.js takes the same line with its own marker. Writing
    // without a boundary would mean choosing one, and the wrong choice eats
    // hand-authored code.
    expect(() => replaceRegion('window.CHARACTER_COLORS = {};\n', 'x'))
        .toThrow(/missing the CHARACTER_COLORS generated-region markers/i);
});

test('the committed js/site_meta.js still carries both markers', () => {
    // If these are ever lost, the next regeneration fails loudly rather than
    // silently stopping - but the failure would block a release, so assert it
    // here where it costs nothing.
    const source = fs.readFileSync(SITE_META, 'utf8');
    expect(source).toContain(COLORS_BEGIN);
    expect(source).toContain(COLORS_END);
    expect(source.indexOf(COLORS_BEGIN)).toBeLessThan(source.indexOf(COLORS_END));
});

test('the hand-authored halves are OUTSIDE the generated region', () => {
    // The failure this guards against is somebody moving a marker rather than
    // deleting it, which would put CHARACTER_ALIASES inside the region and
    // delete it on the next regeneration.
    const source = fs.readFileSync(SITE_META, 'utf8');
    const end = source.indexOf(COLORS_END);

    expect(source.indexOf('window.CHARACTER_ALIASES')).toBeGreaterThan(end);
    expect(source.indexOf('window.applyCharacterTheme')).toBeGreaterThan(end);
});

test('the live dictionary and the roster still agree on every name', () => {
    // The join this whole feature rests on. CHARACTER_COLORS is keyed by name;
    // navigation.json carries the roster. A name in the dictionary that is not
    // on the roster is a colour nothing can use, and this is the direction that
    // catches a rename - both ways, because a consistency check only finds
    // drift in the direction it looks.
    const source = fs.readFileSync(SITE_META, 'utf8');
    const region = source.slice(source.indexOf(COLORS_BEGIN), source.indexOf(COLORS_END));
    const named = [...region.matchAll(/^\s{4}"([^"]+)":/gm)].map(m => m[1]);

    const nav = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'navigation.json'), 'utf8'));
    const roster = (nav.Characters || []).map(c => c.name);

    expect(named.length).toBeGreaterThan(0);
    for (const name of named) {
        expect(roster, `${name} has a colour but is not on the roster`).toContain(name);
    }
});

// --- THE OWNER TOOL ---

const META_PAGES = [
    { page_id: 'vessel', name: 'Vessel', page_type: 'character', category: 'Characters', status: 'live', is_wip: false, is_hidden: false, is_ea: false, is_base_only: false, is_missing_media: false, is_subjective: false, archetype: 'Rushdown', tier: 'A', release_date: null, color: 'hsl(0, 100%, 80%)', sort_order: 10 },
    { page_id: 'framedata', name: 'Frame Data', page_type: 'system', category: 'Systems', status: 'live', is_wip: false, is_hidden: false, is_ea: false, is_base_only: false, is_missing_media: false, is_subjective: false, archetype: null, tier: null, release_date: null, color: null, sort_order: 20 },
];

async function openPageMeta(page) {
    await page.addInitScript(({ pages }) => {
        window.__writes = [];
        Object.defineProperty(window, 'supabase', {
            configurable: true,
            get() { return window.__lib; },
            set(lib) {
                window.__lib = lib;
                if (lib && lib.createClient && !lib.__patched) {
                    const orig = lib.createClient.bind(lib);
                    lib.createClient = (...args) => {
                        const client = orig(...args);
                        client.auth.getSession = async () => ({
                            data: { session: { user: { id: 'u-owner', email: 'owner@site.test' }, access_token: 't' } },
                        });
                        client.from = (table) => {
                            if (table === 'user_roles') {
                                return { select() { return this; }, eq: async () => ({ data: [{ role: 'owner' }], error: null }) };
                            }
                            const chain = {
                                select() { return chain; }, order() { return chain; }, limit() { return chain; },
                                eq() { return chain; },
                                maybeSingle: async () => ({ data: null, error: null }),
                                single: async () => ({ data: null, error: null }),
                                insert: async () => ({ data: null, error: null }),
                                update(payload) {
                                    return { eq(col, val) { window.__writes.push({ table, payload, eq: [col, val] }); return Promise.resolve({ data: null, error: null }); } };
                                },
                                delete() { return { eq: async () => ({ data: null, error: null }) }; },
                                then(resolve) {
                                    return Promise.resolve({ data: table === 'site_pages' ? pages : [], error: null }).then(resolve);
                                },
                            };
                            return chain;
                        };
                        client.rpc = async (name) => (name.startsWith('list_') || name.startsWith('get_'))
                            ? { data: [], error: null } : { data: 'ok', error: null };
                        return client;
                    };
                    lib.__patched = true;
                }
            },
        });
    }, { pages: META_PAGES });

    await page.goto('/owner.html', { waitUntil: 'networkidle' });
    await page.click('.owner-nav-btn[data-group="pages"]');
    await page.selectOption('#page-meta-select', 'vessel');
}

test('a character page offers a colour, prefilled from the database', async ({ page }) => {
    await openPageMeta(page);
    await expect(page.locator('#page-meta-color')).toHaveValue('hsl(0, 100%, 80%)');
});

test('the swatch shows the colour rather than the string', async ({ page }) => {
    // The whole reason this control exists is picking something that looks
    // right, so assert what the browser painted - not that a value was set.
    await openPageMeta(page);
    const painted = await page.locator('#page-meta-color-swatch')
        .evaluate(el => getComputedStyle(el).backgroundColor);

    // hsl(0, 100%, 80%) resolves to rgb(255, 153, 153).
    expect(painted).toBe('rgb(255, 153, 153)');
});

test('a system page is offered no colour at all', async ({ page }) => {
    await openPageMeta(page);
    await page.selectOption('#page-meta-select', 'framedata');
    await expect(page.locator('#page-meta-color')).toBeHidden();
});

test('the picker writes into the text field, which stays the value', async ({ page }) => {
    await openPageMeta(page);
    await page.locator('#page-meta-color-picker').evaluate(el => {
        el.value = '#00ff00';
        el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#page-meta-color')).toHaveValue('#00ff00');
});

test('a saved colour reaches site_pages.color', async ({ page }) => {
    await openPageMeta(page);
    await page.fill('#page-meta-color', '#abcdef');
    await page.click('#btn-save-page-meta');

    await expect.poll(async () => await page.evaluate(() =>
        (window.__writes || []).filter(w => w.table === 'site_pages').map(w => w.payload.color)
    )).toEqual(['#abcdef']);
});

test('a colour the browser cannot parse is refused, not written', async ({ page }) => {
    // It would reach ten consumers and render as nothing on all of them.
    await openPageMeta(page);
    await page.fill('#page-meta-color', 'not a colour');
    await page.click('#btn-save-page-meta');

    await expect(page.locator('#page-meta-results')).toContainText('not a colour the browser understands');
    expect(await page.evaluate(() => (window.__writes || []).length)).toBe(0);
});

test('clearing the colour is allowed and stores NULL', async ({ page }) => {
    // Absent is a real state - it is what every new character page starts as,
    // and pagebuilder already falls back for a name it cannot find.
    await openPageMeta(page);
    await page.fill('#page-meta-color', '');
    await page.click('#btn-save-page-meta');

    await expect.poll(async () => await page.evaluate(() =>
        (window.__writes || []).filter(w => w.table === 'site_pages').map(w => w.payload.color)
    )).toEqual([null]);
});

test('a named CSS colour is accepted, which a hex-only regex would have refused', async ({ page }) => {
    await openPageMeta(page);
    await page.fill('#page-meta-color', 'rebeccapurple');
    await page.click('#btn-save-page-meta');

    await expect.poll(async () => await page.evaluate(() =>
        (window.__writes || []).filter(w => w.table === 'site_pages').map(w => w.payload.color)
    )).toEqual(['rebeccapurple']);
});

// --- THE MIGRATION ---

test('the colour column is added without touching policies', () => {
    const mig = fs.readFileSync(
        path.join(ROOT, 'supabase', 'migrations', '20260904000004_page_color.sql'), 'utf8');

    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS "color" text/);
    // A new column on an existing table inherits the table's policy and grants.
    // Adding another would be a second gate to keep in sync with the first.
    expect(mig).not.toMatch(/CREATE POLICY/);
    expect(mig).not.toMatch(/GRANT .* ON TABLE/);
});

test('the column is text, not a constrained type', () => {
    // hsl() and #rrggbb must both round-trip, and a CHECK constraint here would
    // have to reimplement CSS colour parsing in SQL. The owner tools check with
    // CSS.supports() instead, which understands every form the browser does.
    const mig = fs.readFileSync(
        path.join(ROOT, 'supabase', 'migrations', '20260904000004_page_color.sql'), 'utf8');
    expect(mig).not.toMatch(/CHECK \("color"/);
});
