// Coverage for the media garbage collector's safety rails (js/owner.js).
//
// The collector decides a file is unused by NOT finding its name in the page
// data, so every one of these tests is really the same question asked from a
// different angle: when the scan cannot see the references, does the tool
// stay its hand? The version this replaces answered no. A failed read on
// page_history, or a table longer than one PostgREST page, made every file in
// the library look unreferenced - and it deleted them and reported success.
//
// Storage is mocked here for the first time in this suite, so the harness
// below is deliberately explicit: it records every list, range and remove
// call, and the assertions are mostly about calls that must NOT have
// happened.
const { test, expect } = require('@playwright/test');

// Matches GC_PAGE_SIZE in js/owner.js. Hard-coded rather than read from the
// page, because a test that silently follows the constant would stop testing
// pagination the moment the constant changed to something the mock returns in
// one page.
const PAGE_SIZE = 200;

// A row's worth of stored JSON referencing a file, in the shape the real
// data uses: a full public URL ending in the raw file name.
const ref = (name) => `{"image":"https://x.supabase.co/storage/v1/object/public/wiki-media/${name}"}`;

async function mockOwner(page, config) {
    await page.addInitScript((cfg) => {
        window.__gc = { removed: [], ranges: [], listOffsets: [] };

        // Anything the page loads that this test does not care about. A Proxy
        // so it answers every builder method, and thenable so any terminal
        // call resolves - the alternative is enumerating owner.js's loaders
        // and having them make real network calls when one is missed.
        const inertChain = () => new Proxy({}, {
            get(_target, prop) {
                if (prop === 'then') return (resolve) => resolve({ data: [], error: null });
                return () => inertChain();
            },
        });

        const TRACKED = ['page_data', 'pending_revisions', 'page_history'];

        const trackedChain = (table) => {
            const rows = (cfg.tables[table] || []).map(text => ({
                desc_data: text, frame_data: '', delta_payload: '',
            }));
            return {
                select() { return this; },
                order() { return this; },
                range(from, to) {
                    window.__gc.ranges.push({ table, from, to });
                    if (cfg.errorOn === table) {
                        return Promise.resolve({ data: null, error: { message: 'permission denied for table ' + table } });
                    }
                    return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
                },
            };
        };

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
                        client.from = (table) => {
                            if (table === 'user_roles') {
                                return { select() { return this; }, eq: async () => ({ data: [{ role: 'admin' }], error: null }) };
                            }
                            if (TRACKED.includes(table)) return trackedChain(table);
                            return inertChain();
                        };
                        client.rpc = async (name) => (name === 'get_my_role'
                            ? { data: 'admin', error: null }
                            : { data: [], error: null });
                        client.storage = {
                            from: () => ({
                                list: async (_path, opts) => {
                                    window.__gc.listOffsets.push(opts.offset);
                                    if (cfg.listError) return { data: null, error: { message: cfg.listError } };
                                    const names = cfg.files.slice(opts.offset, opts.offset + opts.limit);
                                    return { data: names.map(name => ({ name })), error: null };
                                },
                                remove: async (names) => {
                                    window.__gc.removed.push(names);
                                    if (cfg.removeError) return { data: null, error: { message: cfg.removeError } };
                                    const kept = cfg.removePartial ? names.slice(0, cfg.removePartial) : names;
                                    return { data: kept.map(name => ({ name })), error: null };
                                },
                            }),
                        };
                        return client;
                    };
                    lib.__patched = true;
                }
            },
        });
    }, {
        files: [], tables: {}, errorOn: null, listError: null,
        removeError: null, removePartial: 0, ...config,
    });
}

async function openTool(page) {
    await page.goto('/owner.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('danger'));
    await expect(page.locator('#tool-media-gc')).toBeVisible();
}

async function scan(page) {
    await page.click('#btn-run-gc');
    await expect(page.locator('#btn-run-gc')).toBeEnabled();
}

const removals = (page) => page.evaluate(() => window.__gc.removed);

test('a reference table it cannot read stops the run instead of emptying the library', async ({ page }) => {
    // The whole reason this file exists. page_history is admin-only, so a
    // grant or policy regression lands here first - and under the old code
    // that regression deleted every file in the library.
    await mockOwner(page, {
        files: ['Portrait.webp', 'Clip.webm'],
        tables: { page_data: [ref('Portrait.webp')], pending_revisions: [], page_history: [ref('Clip.webm')] },
        errorOn: 'page_history',
    });
    await openTool(page);
    await scan(page);

    await expect(page.locator('#gc-results')).toContainText('Stopped, nothing deleted');
    await expect(page.locator('#gc-results')).toContainText('page_history');
    await expect(page.locator('#btn-purge-gc')).toBeHidden();
    expect(await removals(page)).toEqual([]);
});

test('a reference table longer than one page is read to the end', async ({ page }) => {
    // PostgREST caps rows per request. A file referenced only by row 240 is
    // referenced; a scan that reads the first page and stops calls it an
    // orphan and deletes it.
    const history = Array.from({ length: PAGE_SIZE + 50 }, (_, i) => ref(`filler-${i}.webp`));
    history[PAGE_SIZE + 20] = ref('LateReference.webp');

    await mockOwner(page, {
        files: ['LateReference.webp'],
        tables: { page_data: [ref('unrelated.webp')], pending_revisions: [], page_history: history },
    });
    await openTool(page);
    await scan(page);

    await expect(page.locator('#gc-results')).toContainText('All 1 files are still linked');
    await expect(page.locator('#btn-purge-gc')).toBeHidden();

    const pages = await page.evaluate(() => window.__gc.ranges.filter(r => r.table === 'page_history'));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]).toMatchObject({ from: 0, to: PAGE_SIZE - 1 });
});

test('page data that comes back empty is not read as a wiki referencing nothing', async ({ page }) => {
    await mockOwner(page, {
        files: ['Portrait.webp', 'Clip.webm'],
        tables: { page_data: [], pending_revisions: [], page_history: [] },
    });
    await openTool(page);
    await scan(page);

    await expect(page.locator('#gc-results')).toContainText('Stopped, nothing deleted');
    expect(await removals(page)).toEqual([]);
});

test('scanning lists what it found and deletes nothing', async ({ page }) => {
    await mockOwner(page, {
        files: ['Used.webp', 'Stray.webp', 'AlsoStray.webm'],
        tables: { page_data: [ref('Used.webp')], pending_revisions: [], page_history: [] },
    });
    await openTool(page);
    await scan(page);

    expect(await removals(page)).toEqual([]);
    await expect(page.locator('#gc-results')).toContainText('2 of 3 files are unused');
    await expect(page.locator('.gc-orphan-list li')).toHaveText(['Stray.webp', 'AlsoStray.webm']);
    await expect(page.locator('#btn-purge-gc')).toBeVisible();
    await expect(page.locator('#btn-purge-gc')).toHaveText('DELETE 2 UNUSED FILES');
});

test('deleting is a second click, and cancelling it removes nothing', async ({ page }) => {
    await mockOwner(page, {
        files: ['Used.webp', 'Stray.webp'],
        tables: { page_data: [ref('Used.webp')], pending_revisions: [], page_history: [] },
    });
    await openTool(page);
    await scan(page);

    await page.click('#btn-purge-gc');
    await expect(page.locator('#admin-confirm-msg')).toContainText('Permanently delete 1 unused file?');
    await page.click('#btn-admin-confirm-cancel');

    expect(await removals(page)).toEqual([]);
    // Still purgeable - cancelling is not a reason to throw the scan away.
    await expect(page.locator('#btn-purge-gc')).toBeVisible();
});

test('confirming deletes exactly what the scan listed', async ({ page }) => {
    await mockOwner(page, {
        files: ['Used.webp', 'Stray.webp', 'AlsoStray.webm'],
        tables: { page_data: [ref('Used.webp')], pending_revisions: [], page_history: [] },
    });
    await openTool(page);
    await scan(page);

    await page.click('#btn-purge-gc');
    await page.click('#btn-admin-confirm-ok');

    await expect(page.locator('#gc-results')).toContainText('Deleted 2 unused files');
    expect(await removals(page)).toEqual([['Stray.webp', 'AlsoStray.webm']]);
});

test('a spent list cannot be deleted twice', async ({ page }) => {
    await mockOwner(page, {
        files: ['Used.webp', 'Stray.webp'],
        tables: { page_data: [ref('Used.webp')], pending_revisions: [], page_history: [] },
    });
    await openTool(page);
    await scan(page);

    await page.click('#btn-purge-gc');
    await page.click('#btn-admin-confirm-ok');
    await expect(page.locator('#gc-results')).toContainText('Deleted 1 unused file');
    await expect(page.locator('#btn-purge-gc')).toBeHidden();

    // The button is gone, so reach past it - the guard has to live in the
    // function, not in the markup.
    await page.evaluate(() => window.purgeOrphanedMedia());
    await expect(page.locator('#gc-results')).toContainText('Run a scan first');
    expect(await removals(page)).toHaveLength(1);
});

test('a sweep of most of the library says so, with the numbers', async ({ page }) => {
    await mockOwner(page, {
        files: ['Used.webp', 'A.webp', 'B.webp', 'C.webp'],
        tables: { page_data: [ref('Used.webp')], pending_revisions: [], page_history: [] },
    });
    await openTool(page);
    await scan(page);

    await page.click('#btn-purge-gc');
    const message = await page.locator('#admin-confirm-msg').textContent();
    expect(message).toContain('75% of the media library (3 of 4 files)');
    expect(message).toContain('usually a broken scan');
});

test('a partial deletion is reported as partial, not as success', async ({ page }) => {
    await mockOwner(page, {
        files: ['Used.webp', 'A.webp', 'B.webp'],
        tables: { page_data: [ref('Used.webp')], pending_revisions: [], page_history: [] },
        removePartial: 1,
    });
    await openTool(page);
    await scan(page);

    await page.click('#btn-purge-gc');
    await page.click('#btn-admin-confirm-ok');

    await expect(page.locator('#gc-results')).toContainText('Deleted 1 of 2 files');
    await expect(page.locator('#gc-results .owner-success-text')).toHaveCount(0);
});

test('a name stored url-encoded still counts as referenced', async ({ page }) => {
    // Uploads with spaces are stored raw in some rows and percent-encoded in
    // others depending on which editor wrote them. Both are references.
    await mockOwner(page, {
        files: ['Big Slam.webp', 'Stray.webp'],
        tables: { page_data: [ref('Big%20Slam.webp')], pending_revisions: [], page_history: [] },
    });
    await openTool(page);
    await scan(page);

    await expect(page.locator('.gc-orphan-list li')).toHaveText(['Stray.webp']);
});

test('a library listing that fails stops the run', async ({ page }) => {
    await mockOwner(page, { files: [], listError: 'network error', tables: { page_data: [ref('x.webp')] } });
    await openTool(page);
    await scan(page);

    await expect(page.locator('#gc-results')).toContainText('Could not list the media library');
    expect(await removals(page)).toEqual([]);
});
