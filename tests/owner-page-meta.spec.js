// Coverage for the Page Details and Dashboard Steps tools.
//
// Page Details edits site_pages columns that drive presentation rather than
// content: the WIP/EA badges, the roster filters, and a character's archetype,
// tier and release date. Until v0.11 the only way to change one was a SQL
// edit.
//
// The trap specific to this form is that archetype/tier/release_date apply to
// characters only - scripts/fetch-registry.js omits them for other page types
// on purpose - so offering them for a system page would be offering an edit
// that is silently dropped on the next regeneration run.
//
// Dashboard Steps edits the Side Dashboard's ordered lists. Order IS the
// content there, so reordering and the round-trip through the form are what
// these pin.

const { test, expect } = require('@playwright/test');

const PAGES = [
    { page_id: 'boomcat', name: 'Boomcat', page_type: 'character', category: 'Characters', status: 'live',
      is_wip: false, is_ea: false, is_base_only: false, is_missing_media: false, is_subjective: false,
      archetype: 'TBD', tier: 'TBD', release_date: 'TBD' },
    { page_id: 'framedata', name: 'Frame data', page_type: 'system', category: 'System Pages', status: 'live',
      is_wip: true, is_ea: false, is_base_only: false, is_missing_media: false, is_subjective: false,
      archetype: null, tier: null, release_date: null },
    { page_id: 'source-code', name: 'Source Code', page_type: 'external', category: 'Site Info', status: 'archived',
      is_wip: false, is_ea: false, is_base_only: false, is_missing_media: false, is_subjective: false,
      archetype: null, tier: null, release_date: null },
];

const HUBS = {
    'systems-hub': {
        title: 'Systems & Guides Hub',
        lists: {
            startHere: [
                { title: 'Starter Guide', url: 'starter-guide/index.html', description: 'First.' },
                { title: 'HUD', url: 'hud/index.html', description: 'Second.' },
            ],
            contribute: [{ title: 'Sign in', url: '', description: 'Sidebar button.' }],
        },
    },
};

async function mockOwner(page, { pages = PAGES, hubs = HUBS } = {}) {
    await page.addInitScript(({ pages, hubs }) => {
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
                            data: { session: { user: { id: 'u-admin', email: 'a@b.c' }, access_token: 't' } },
                        });
                        const origFrom = client.from.bind(client);

                        client.from = (table) => {
                            if (table === 'user_roles') {
                                return { select() { return this; }, eq: async () => ({ data: [{ role: 'admin' }], error: null }) };
                            }
                            if (table === 'site_pages') {
                                let orderCalls = 0;
                                const chain = {
                                    select() { return chain; },
                                    eq() { return chain; },
                                    limit() { return Promise.resolve({ data: [{ sort_order: 90 }], error: null }); },
                                    order() {
                                        orderCalls++;
                                        return orderCalls >= 2 ? Promise.resolve({ data: pages, error: null }) : chain;
                                    },
                                    update(payload) {
                                        return { eq: (col, val) => {
                                            window.__writes.push({ table: 'site_pages', payload, val });
                                            return Promise.resolve({ error: null });
                                        }};
                                    },
                                };
                                return chain;
                            }
                            if (table === 'site_meta') {
                                const chain = {
                                    select() { return chain; },
                                    limit() { return chain; },
                                    maybeSingle: async () => ({ data: { hubs, version: 'v', tagline: 't', game_info: {} }, error: null }),
                                    update(payload) {
                                        return { eq: (col, val) => {
                                            window.__writes.push({ table: 'site_meta', payload, val });
                                            return Promise.resolve({ error: null });
                                        }};
                                    },
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
    }, { pages, hubs });
}

async function openGroup(page, group) {
    await page.goto('/owner.html', { waitUntil: 'networkidle' });
    await page.evaluate((g) => window.showOwnerGroup && window.showOwnerGroup(g), group);
}

// ---------------------------------------------------------------- page details

test('page details loads a character with all its fields', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await mockOwner(page);
    await openGroup(page, 'pages');

    await expect(page.locator('#page-meta-select')).toHaveValue('boomcat', { timeout: 5000 });
    await expect(page.locator('.page-meta-checkbox')).toHaveCount(5);
    await expect(page.locator('#page-meta-character-fields')).toBeVisible();
    await expect(page.locator('#page-meta-archetype')).toHaveValue('TBD');
    expect(errors).toEqual([]);
});

test('character-only fields are hidden for a system page', async ({ page }) => {
    // fetch-registry omits archetype/tier/release_date for non-characters, so
    // offering them here would offer an edit that is silently dropped.
    await mockOwner(page);
    await openGroup(page, 'pages');
    await expect(page.locator('#page-meta-select')).toHaveValue('boomcat', { timeout: 5000 });

    await page.selectOption('#page-meta-select', 'framedata');
    await expect(page.locator('#page-meta-character-fields')).toBeHidden();
    // Flags still apply - a system page can be work-in-progress.
    await expect(page.locator('.page-meta-checkbox')).toHaveCount(5);
    await expect(page.locator('.page-meta-checkbox[data-column="is_wip"]')).toBeChecked();
});

test('saving writes the flags and the character fields', async ({ page }) => {
    await mockOwner(page);
    await openGroup(page, 'pages');
    await expect(page.locator('#page-meta-select')).toHaveValue('boomcat', { timeout: 5000 });

    await page.locator('.page-meta-checkbox[data-column="is_wip"]').check();
    await page.locator('.page-meta-checkbox[data-column="is_ea"]').check();
    await page.fill('#page-meta-archetype', 'Rushdown');
    await page.fill('#page-meta-tier', 'S');
    await page.fill('#page-meta-release', '2026-04-12');
    await page.click('#btn-save-page-meta');

    await expect(page.locator('#page-meta-results')).toContainText('Saved');

    const writes = await page.evaluate(() => window.__writes.filter(w => w.table === 'site_pages'));
    expect(writes).toHaveLength(1);
    expect(writes[0].val).toBe('boomcat');
    expect(writes[0].payload.is_wip).toBe(true);
    expect(writes[0].payload.is_ea).toBe(true);
    expect(writes[0].payload.is_base_only).toBe(false);
    expect(writes[0].payload.archetype).toBe('Rushdown');
    expect(writes[0].payload.tier).toBe('S');
});

test('a cleared character field is written as null, not an empty string', async ({ page }) => {
    await mockOwner(page);
    await openGroup(page, 'pages');
    await expect(page.locator('#page-meta-select')).toHaveValue('boomcat', { timeout: 5000 });

    await page.fill('#page-meta-archetype', '   ');
    await page.click('#btn-save-page-meta');

    const writes = await page.evaluate(() => window.__writes.filter(w => w.table === 'site_pages'));
    expect(writes[0].payload.archetype).toBeNull();
});

test('archived pages are listed, so their details can be fixed before restoring', async ({ page }) => {
    await mockOwner(page);
    await openGroup(page, 'pages');
    await expect(page.locator('#page-meta-select')).toHaveValue('boomcat', { timeout: 5000 });

    const options = await page.locator('#page-meta-select option').allTextContents();
    expect(options.some(o => o.includes('Source Code') && o.includes('archived'))).toBe(true);
});

// ---------------------------------------------------------------- dashboard steps

test('dashboard steps load in their stored order', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await mockOwner(page);
    await openGroup(page, 'content');

    await expect(page.locator('.hub-step-title').first()).toHaveValue('Starter Guide', { timeout: 5000 });
    await expect(page.locator('.hub-step-title')).toHaveCount(2);
    expect(errors).toEqual([]);
});

test('reordering a step changes what is saved', async ({ page }) => {
    // Order is the content here, so this is the behaviour that matters most.
    await mockOwner(page);
    await openGroup(page, 'content');
    await expect(page.locator('.hub-step-title').first()).toHaveValue('Starter Guide', { timeout: 5000 });

    await page.locator('.hub-step-down').first().click();
    await expect(page.locator('.hub-step-title').first()).toHaveValue('HUD');

    await page.click('#btn-save-hub-lists');
    await expect(page.locator('#hub-list-results')).toContainText('Saved');

    const writes = await page.evaluate(() => window.__writes.filter(w => w.table === 'site_meta'));
    const steps = writes[writes.length - 1].payload.hubs['systems-hub'].lists.startHere;
    expect(steps.map(s => s.title)).toEqual(['HUD', 'Starter Guide']);
});

test('reordering keeps text typed into another row', async ({ page }) => {
    await mockOwner(page);
    await openGroup(page, 'content');
    await expect(page.locator('.hub-step-title').first()).toHaveValue('Starter Guide', { timeout: 5000 });

    await page.locator('.hub-step-desc').nth(1).fill('Edited description.');
    await page.locator('.hub-step-down').first().click();

    await expect(page.locator('.hub-step-desc').first()).toHaveValue('Edited description.');
});

test('a step with no link is allowed - it is an instruction, not a page', async ({ page }) => {
    await mockOwner(page);
    await openGroup(page, 'content');
    await expect(page.locator('.hub-step-title').first()).toHaveValue('Starter Guide', { timeout: 5000 });

    await page.selectOption('#hub-list-select', 'contribute');
    await expect(page.locator('.hub-step-url').first()).toHaveValue('');

    await page.click('#btn-save-hub-lists');
    await expect(page.locator('#hub-list-results')).toContainText('Saved');
});

test('a non-http scheme in a step link is refused', async ({ page }) => {
    await mockOwner(page);
    await openGroup(page, 'content');
    await expect(page.locator('.hub-step-title').first()).toHaveValue('Starter Guide', { timeout: 5000 });

    await page.locator('.hub-step-url').first().fill('javascript:alert(1)');
    await page.click('#btn-save-hub-lists');

    await expect(page.locator('#hub-list-results')).toContainText('must be a page path or an http(s) link');
    expect(await page.evaluate(() => window.__writes.filter(w => w.table === 'site_meta'))).toEqual([]);
});

// ---------------------------------------------------------------- rendering

test('the Side Dashboard renders its steps from site_meta', async ({ page }) => {
    await page.route('**/data/site_meta.json*', async route => {
        const meta = await (await route.fetch()).json();
        meta.hubs['systems-hub'].lists.startHere = [
            { title: 'A Curated First Step', url: 'hud/index.html', description: 'Chosen by the owner.' },
        ];
        await route.fulfill({ json: meta });
    });

    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    await expect(page.locator('#start-here-list')).toContainText('A Curated First Step');
    await expect(page.locator('#start-here-list .reading-step')).toHaveCount(1);
    // The static markup it replaced must be gone, not appended to.
    await expect(page.locator('#start-here-list')).not.toContainText('Fundamentals');
});

test('the Side Dashboard keeps its static steps when site_meta has none', async ({ page }) => {
    await page.route('**/data/site_meta.json*', async route => {
        const meta = await (await route.fetch()).json();
        meta.hubs['systems-hub'].lists = {};
        await route.fulfill({ json: meta });
    });

    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });
    await expect(page.locator('#start-here-list')).toContainText('Starter Guide');
    await expect(page.locator('#contribute-list')).toContainText('Sign in');
});

test('a hostile step cannot inject markup or a javascript href', async ({ page }) => {
    await page.route('**/data/site_meta.json*', async route => {
        const meta = await (await route.fetch()).json();
        meta.hubs['systems-hub'].lists.startHere = [
            { title: '<img src=x onerror=window.__xss=1>', url: 'javascript:window.__xss=1', description: 'x' },
        ];
        await route.fulfill({ json: meta });
    });

    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    // A rejected link renders as plain text rather than a dead anchor.
    await expect(page.locator('#start-here-list a')).toHaveCount(0);
});
