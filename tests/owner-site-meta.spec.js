// Coverage for v0.11's Site Metadata and Game Info tools (owner.html +
// js/owner-site-meta.js).
//
// These drive the real controls rather than asserting the page rendered. The
// post-editor shipped into a PR with a green suite and three bugs that made it
// unusable because its test only checked that the page loaded, and this file
// is the same shape of UI: forms that read one row, mutate part of it, and
// write it back.
//
// The sharp edge specific to this tool is that one database row backs three
// dashboards behind a selector. A save has to send the other two hubs back
// untouched, and switching the selector must not discard what was typed. Both
// are pinned below, because both fail silently - you would only notice when a
// dashboard's title turned up blank days later.

const { test, expect } = require('@playwright/test');

const META_ROW = {
    id: true,
    version: 'Beta v0.10',
    tagline: 'The Competitive JJS Wiki',
    hubs: {
        'main-hub': {
            title: 'Dogslamloop Wiki',
            description: 'Frame data, matchups, and strategy guides.',
            headings: { about: 'About Us', credits: 'Credits' },
        },
        'character-hub': {
            title: 'Character Dashboard',
            description: 'Every character.',
            headings: { about: 'Roster Overview' },
        },
        'systems-hub': { title: 'Systems & Guides Hub', description: 'Systems.', headings: {} },
    },
    game_info: {
        title: 'Jujutsu\nShenanigans',
        linksLabel: 'Official Links',
        fields: [{ label: 'Developers', value: "Tze's Shenanigans", subtext: '(Tze, Imed, Frost)' }],
        links: [{ name: 'Official Discord', url: 'https://discord.gg/original' }],
    },
};

async function mockOwner(page, { row = META_ROW, loadError = null } = {}) {
    await page.addInitScript(({ row, loadError }) => {
        window.__metaWrites = [];
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
                            if (table === 'site_meta') {
                                const chain = {
                                    select() { return chain; },
                                    limit() { return chain; },
                                    maybeSingle: async () => ({ data: loadError ? null : row, error: loadError }),
                                    update(payload) {
                                        return {
                                            eq: (col, val) => {
                                                window.__metaWrites.push({ payload, col, val });
                                                return Promise.resolve({ error: null });
                                            },
                                        };
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
    }, { row, loadError });
}

async function openOwner(page) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/owner.html', { waitUntil: 'networkidle' });
    // The RBAC gate retries once over ~600ms before denying, so wait on the
    // populated field rather than a fixed timeout.
    await expect(page.locator('#meta-version')).toHaveValue('Beta v0.10', { timeout: 5000 });
    return errors;
}

test('loads the row into the form', async ({ page }) => {
    await mockOwner(page);
    const errors = await openOwner(page);

    await expect(page.locator('#meta-tagline')).toHaveValue('The Competitive JJS Wiki');
    await expect(page.locator('#meta-hub-title')).toHaveValue('Dogslamloop Wiki');
    await expect(page.locator('.meta-heading-input')).toHaveCount(2);
    expect(errors).toEqual([]);
});

test('saving sends the edited values and preserves the untouched hubs', async ({ page }) => {
    await mockOwner(page);
    await openOwner(page);

    await page.fill('#meta-tagline', 'A Better Tagline');
    await page.fill('#meta-hub-title', 'Home');
    await page.locator('.meta-heading-input[data-heading-key="credits"]').fill('Thanks To');
    await page.click('#btn-save-site-meta');

    await expect(page.locator('#site-meta-results')).toContainText('Saved');

    const writes = await page.evaluate(() => window.__metaWrites);
    expect(writes).toHaveLength(1);

    const { payload, col, val } = writes[0];
    expect({ col, val }).toEqual({ col: 'id', val: true });
    expect(payload.tagline).toBe('A Better Tagline');
    expect(payload.hubs['main-hub'].title).toBe('Home');
    expect(payload.hubs['main-hub'].headings.credits).toBe('Thanks To');

    // The two hubs the form was not showing must survive the write.
    expect(payload.hubs['character-hub'].title).toBe('Character Dashboard');
    expect(payload.hubs['systems-hub'].title).toBe('Systems & Guides Hub');
});

test('switching dashboards swaps the fields and keeps unsaved edits', async ({ page }) => {
    await mockOwner(page);
    await openOwner(page);

    await page.fill('#meta-hub-title', 'Edited But Not Saved');
    await page.selectOption('#meta-hub-select', 'character-hub');
    await expect(page.locator('#meta-hub-title')).toHaveValue('Character Dashboard');
    await expect(page.locator('.meta-heading-input')).toHaveCount(1);

    // Back again: the pending edit must still be there.
    await page.selectOption('#meta-hub-select', 'main-hub');
    await expect(page.locator('#meta-hub-title')).toHaveValue('Edited But Not Saved');
});

test('a dashboard with no headings says so instead of rendering nothing', async ({ page }) => {
    await mockOwner(page);
    await openOwner(page);

    await page.selectOption('#meta-hub-select', 'systems-hub');
    await expect(page.locator('#meta-hub-headings')).toContainText('no editable headings');
});

test('game info: adding a link and saving writes it', async ({ page }) => {
    await mockOwner(page);
    await openOwner(page);

    await page.click('#tool-game-info button:has-text("+ ADD LINK")');
    const urls = page.locator('.gi-link-url');
    await expect(urls).toHaveCount(2);

    await urls.nth(1).fill('https://discord.gg/rotated-invite');
    await page.locator('.gi-link-name').nth(1).fill('New Discord');
    await page.click('#btn-save-game-info');

    await expect(page.locator('#game-info-results')).toContainText('Saved');
    const writes = await page.evaluate(() => window.__metaWrites);
    const links = writes[writes.length - 1].payload.game_info.links;
    expect(links).toContainEqual({ name: 'New Discord', url: 'https://discord.gg/rotated-invite' });
});

test('game info: a non-http link is refused rather than silently rewritten', async ({ page }) => {
    await mockOwner(page);
    await openOwner(page);

    await page.locator('.gi-link-url').first().fill('javascript:alert(1)');
    await page.click('#btn-save-game-info');

    await expect(page.locator('#game-info-results')).toContainText('must start with http');
    // Nothing may reach the database.
    expect(await page.evaluate(() => window.__metaWrites)).toEqual([]);
});

test('game info: deleting a row keeps edits typed into the others', async ({ page }) => {
    await mockOwner(page);
    await openOwner(page);

    await page.click('#tool-game-info button:has-text("+ ADD FACT")');
    await expect(page.locator('.gi-field-label')).toHaveCount(2);

    await page.locator('.gi-field-value').first().fill('Edited Studio');
    await page.locator('.gi-field-label').nth(1).fill('Throwaway');
    await page.locator('.gi-field-delete').nth(1).click();

    await expect(page.locator('.gi-field-label')).toHaveCount(1);
    await expect(page.locator('.gi-field-value').first()).toHaveValue('Edited Studio');
});

test('a missing table reports the pre-migration state, not a crash', async ({ page }) => {
    // Migrations apply on merge, so between pushing and merging this table
    // does not exist. That must read as "not deployed yet", not as an error.
    await mockOwner(page, { loadError: { code: 'PGRST205', message: 'Could not find the table' } });

    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/owner.html', { waitUntil: 'networkidle' });

    await expect(page.locator('#site-meta-results')).toContainText("hasn't been deployed", { timeout: 5000 });
    expect(errors).toEqual([]);
});
