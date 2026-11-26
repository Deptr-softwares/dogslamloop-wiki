// Dashboard Steps and Site Metadata, on owner.html, both save site_meta.hubs: the
// steps live in a hub's `lists`, the metadata in its `title`, `description` and
// `headings`. Each card used to send back the whole column as it was when the page
// opened, so saving one and then the other in the same visit undid the first.
// The fake row here keeps what each save writes, as the table does, which is the
// only way a test can see one save undo another.
const { test, expect } = require('@playwright/test');
const { pickOption } = require('./helpers/site-dropdown');

const ROW = {
    id: true,
    version: 'Beta v0.10',
    tagline: 'The Competitive JJS Wiki',
    hubs: {
        'main-hub': { title: 'Dogslamloop Wiki', description: 'Frame data.', headings: { about: 'About Us' } },
        'systems-hub': {
            title: 'Systems & Guides Hub',
            description: 'Systems.',
            headings: {},
            lists: { startHere: [{ title: 'Read the Writing Guide', url: '/systems/writing_guide/', description: '' }] },
        },
    },
    game_info: { title: 'Jujutsu Shenanigans', fields: [], links: [] },
};

async function ownerWithOneRow(page) {
    await page.addInitScript(row => {
        window.__row = row;
        window.__writes = 0;
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
                    client.auth.getSession = async () => ({
                        data: { session: { user: { id: 'u-owner', email: 'o@example.com' }, access_token: 't' } },
                    });
                    const origFrom = client.from.bind(client);
                    client.from = table => {
                        if (table === 'user_roles') {
                            return { select() { return this; }, eq: async () => ({ data: [{ role: 'owner' }], error: null }) };
                        }
                        if (table !== 'site_meta') return origFrom(table);
                        const chain = {
                            select() { return chain; },
                            limit() { return chain; },
                            // A copy, as a real read is: nothing the page does to it reaches the row.
                            maybeSingle: async () => ({ data: JSON.parse(JSON.stringify(window.__row)), error: null }),
                            update(payload) {
                                return {
                                    eq: async () => {
                                        window.__writes++;
                                        Object.assign(window.__row, JSON.parse(JSON.stringify(payload)));
                                        return { error: null };
                                    },
                                };
                            },
                        };
                        return chain;
                    };
                    return client;
                };
            },
        });
    }, ROW);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/owner.html', { waitUntil: 'networkidle' });
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('content'));
    await expect(page.locator('#meta-version')).toHaveValue('Beta v0.10', { timeout: 5000 });
    await expect(page.locator('#hub-list-steps .hub-step-title')).toHaveCount(1);
    return errors;
}

async function addStep(page) {
    await page.locator('#tool-hub-lists button', { hasText: '+ ADD STEP' }).click();
    await page.locator('#hub-list-steps .hub-step-title').last().fill('Learn the M1 trading');
    await page.locator('#btn-save-hub-lists').click();
    await expect(page.locator('#hub-list-results')).toContainText('Saved');
}

async function retitleSideDashboard(page) {
    await pickOption(page.locator('#meta-hub-select'), 'systems-hub');
    await page.fill('#meta-hub-title', 'Systems Hub');
    await page.click('#btn-save-site-meta');
    await expect(page.locator('#site-meta-results')).toContainText('Saved');
}

const savedHub = page => page.evaluate(() => window.__row.hubs['systems-hub']);

test('saving the steps and then the metadata keeps both', async ({ page }) => {
    const errors = await ownerWithOneRow(page);
    await addStep(page);
    await retitleSideDashboard(page);

    const hub = await savedHub(page);
    expect(hub.title, 'the metadata save went in').toBe('Systems Hub');
    expect(hub.lists.startHere.map(s => s.title), 'and did not undo the steps').toEqual(['Read the Writing Guide', 'Learn the M1 trading']);
    expect(await page.evaluate(() => window.__writes)).toBe(2);
    expect(errors).toEqual([]);
});

test('saving the metadata and then the steps keeps both', async ({ page }) => {
    const errors = await ownerWithOneRow(page);
    await retitleSideDashboard(page);
    await addStep(page);

    const hub = await savedHub(page);
    expect(hub.lists.startHere.map(s => s.title), 'the steps save went in').toEqual(['Read the Writing Guide', 'Learn the M1 trading']);
    expect(hub.title, 'and did not undo the metadata').toBe('Systems Hub');
    // The other hubs are sent back as they are.
    expect(await page.evaluate(() => window.__row.hubs['main-hub'].title)).toBe('Dogslamloop Wiki');
    expect(errors).toEqual([]);
});
