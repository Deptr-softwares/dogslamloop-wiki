// Regression test for a real bug the owner hit within minutes of merging
// v0.11.
//
// Saving a dashboard step list in owner.html wrote to the site_meta table, but
// the Side Dashboard rendered from data/site_meta.json - a committed artifact
// that only changes when the regeneration workflow runs. So the save appeared
// to work, reached the database, and changed nothing on the site. The tool's
// own hint said "Live immediately".
//
// tests/owner-page-meta.spec.js did not catch it because it mocks the JSON
// file and asserts the page renders what the mock contains. That passes
// whether the page reads the database or the file - it only ever proved the
// renderer works, never that it reads the source of truth.
//
// So these tests do the opposite: they make the database and the file DISAGREE
// and assert the database wins. That is the only shape of test that can tell
// the two sources apart.

const { test, expect } = require('@playwright/test');

const DB_LISTS = {
    startHere: [
        { title: 'From The Database', url: 'hud/index.html', description: 'Saved a moment ago.' },
    ],
};

const DB_HEADINGS = { about: 'Heading From The Database' };

async function mockSources(page, { dbAvailable = true } = {}) {
    // The committed file says one thing...
    await page.route('**/data/site_meta.json*', async route => {
        const meta = await (await route.fetch()).json();
        meta.hubs['systems-hub'].lists = {
            startHere: [{ title: 'From The Stale File', url: 'hud/index.html', description: 'Last regeneration run.' }],
        };
        meta.hubs['systems-hub'].headings = { about: 'Heading From The Stale File' };
        await route.fulfill({ json: meta });
    });

    // ...and the database says another.
    await page.addInitScript(({ DB_LISTS, DB_HEADINGS, dbAvailable }) => {
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
                            if (table !== 'site_meta') return origFrom(table);
                            const chain = {
                                select() { return chain; },
                                limit() { return chain; },
                                maybeSingle: async () => dbAvailable
                                    ? { data: {
                                        hubs: { 'systems-hub': { lists: DB_LISTS, headings: DB_HEADINGS } },
                                        game_info: { fields: [{ label: 'Source', value: 'Database' }], links: [] },
                                      }, error: null }
                                    : { data: null, error: new Error('offline') },
                            };
                            return chain;
                        };
                        return client;
                    };
                    lib.__patched = true;
                }
            },
        });
    }, { DB_LISTS, DB_HEADINGS, dbAvailable });
}

test('dashboard steps come from the database, not the committed file', async ({ page }) => {
    await mockSources(page);
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    await expect(page.locator('#start-here-list')).toContainText('From The Database');
    await expect(page.locator('#start-here-list')).not.toContainText('From The Stale File');
});

test('section headings come from the database too', async ({ page }) => {
    await mockSources(page);
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    await expect(page.locator('[data-heading-key="about"]')).toHaveText('Heading From The Database');
});

test('the game info panel comes from the database', async ({ page }) => {
    await page.route('**/data/site_meta.json*', async route => {
        const meta = await (await route.fetch()).json();
        meta.gameInfo.fields = [{ label: 'Source', value: 'Stale File' }];
        await route.fulfill({ json: meta });
    });
    await mockSources(page);

    await page.goto('/index.html', { waitUntil: 'networkidle' });
    await expect(page.locator('#game-info-fields')).toContainText('Database');
    await expect(page.locator('#game-info-fields')).not.toContainText('Stale File');
});

test('the committed file is still the fallback when the database is unreachable', async ({ page }) => {
    // The file exists precisely so a brief outage degrades to the last
    // regenerated content rather than to a blank dashboard.
    await mockSources(page, { dbAvailable: false });
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    await expect(page.locator('#start-here-list')).toContainText('From The Stale File');
});

test('one page load reads site_meta once, not once per widget', async ({ page }) => {
    // Three renderers share this data. Before the shared fetch they would have
    // been three round trips for one row.
    await page.addInitScript(() => {
        window.__siteMetaReads = 0;
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
                            if (table !== 'site_meta') return origFrom(table);
                            const chain = {
                                select() { return chain; },
                                limit() { return chain; },
                                maybeSingle: async () => {
                                    window.__siteMetaReads++;
                                    return { data: { hubs: {}, game_info: {} }, error: null };
                                },
                            };
                            return chain;
                        };
                        return client;
                    };
                    lib.__patched = true;
                }
            },
        });
    });

    await page.goto('/index.html', { waitUntil: 'networkidle' });
    expect(await page.evaluate(() => window.__siteMetaReads)).toBe(1);
});
