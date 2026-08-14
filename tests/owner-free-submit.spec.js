// The owner's controls for the community ranking (owner.html +
// js/owner-tier-lists.js), added with v0.14 item 4.
//
// These are the emergency stop. When a brigade is under way the useful
// response is to close voting from this panel within a minute, so "the button
// exists" is not the claim worth testing - "the button writes what it says"
// is. Every test below drives the real control and inspects the write.
//
// The gate itself is enforced in SQL and cannot be reached from a browser; the
// migration's half is covered in free-submit-tier-list.spec.js.

const { test, expect } = require('@playwright/test');

const SETTINGS = {
    id: true,
    intro: [],
    free_submit_open: true,
    free_submit_min_age_days: 7,
    free_submit_min_contributions: 1,
    free_submit_min_votes: 10,
};

async function mockOwner(page, { row = SETTINGS, loadError = null } = {}) {
    await page.addInitScript(({ row, loadError }) => {
        window.__fsWrites = [];
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
                        data: { session: { user: { id: 'u-admin', email: 'a@b.c' }, access_token: 't' } },
                    });

                    const origFrom = client.from.bind(client);
                    client.from = (table) => {
                        if (table === 'user_roles') {
                            return { select() { return this; }, eq: async () => ({ data: [{ role: 'admin' }], error: null }) };
                        }
                        if (table === 'tier_page_settings') {
                            return {
                                select() { return this; },
                                maybeSingle: async () => ({ data: loadError ? null : row, error: loadError }),
                                update(payload) {
                                    return {
                                        eq: (col, val) => {
                                            window.__fsWrites.push({ payload, col, val });
                                            return Promise.resolve({ error: null });
                                        },
                                    };
                                },
                            };
                        }
                        return origFrom(table);
                    };
                    client.rpc = async () => ({ data: [], error: null });
                    return client;
                };
            },
        });
    }, { row, loadError });
}

async function openPanel(page) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/owner.html', { waitUntil: 'networkidle' });
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('tierlists'));
    // The panel loads on demand rather than at boot, so this is also the proof
    // that opening the group is what fetches the settings.
    await page.evaluate(() => window.loadFreeSubmitSettings && window.loadFreeSubmitSettings());
    await expect(page.locator('#fs-setting-age')).toHaveValue('7', { timeout: 5000 });
    return errors;
}

test('the current settings load into the form', async ({ page }) => {
    await mockOwner(page);
    const errors = await openPanel(page);

    await expect(page.locator('#fs-setting-open')).toHaveValue('true');
    await expect(page.locator('#fs-setting-contrib')).toHaveValue('1');
    await expect(page.locator('#fs-setting-floor')).toHaveValue('10');
    expect(errors).toEqual([]);
});

test('closing voting writes false, not a truthy string', async ({ page }) => {
    await mockOwner(page);
    await openPanel(page);

    await page.selectOption('#fs-setting-open', 'false');
    await page.click('#btn-save-free-submit');

    await expect(page.locator('#fs-setting-results')).toContainText('Saved');

    const writes = await page.evaluate(() => window.__fsWrites);
    expect(writes).toHaveLength(1);
    // A select yields the STRING "false", which is truthy. Writing it straight
    // through would leave voting open while the panel claimed it was closed -
    // the emergency stop failing silently in the one moment it matters.
    expect(writes[0].payload.free_submit_open).toBe(false);
    expect({ col: writes[0].col, val: writes[0].val }).toEqual({ col: 'id', val: true });
});

test('raising the gate writes the numbers as numbers', async ({ page }) => {
    await mockOwner(page);
    await openPanel(page);

    await page.fill('#fs-setting-age', '30');
    await page.fill('#fs-setting-contrib', '2');
    await page.fill('#fs-setting-floor', '25');
    await page.click('#btn-save-free-submit');

    await expect(page.locator('#fs-setting-results')).toContainText('Saved');

    const { payload } = (await page.evaluate(() => window.__fsWrites))[0];
    expect(payload.free_submit_min_age_days).toBe(30);
    expect(payload.free_submit_min_contributions).toBe(2);
    expect(payload.free_submit_min_votes).toBe(25);
});

test('a blank age field is refused rather than saved as zero', async ({ page }) => {
    await mockOwner(page);
    await openPanel(page);

    await page.fill('#fs-setting-age', '');
    await page.click('#btn-save-free-submit');

    await expect(page.locator('#fs-setting-results')).toContainText('must be filled in');

    // Nothing written. A blank coerced to 0 would open voting to every account
    // ever made, which is the precise failure the gate exists to prevent.
    expect(await page.evaluate(() => window.__fsWrites)).toHaveLength(0);
});

test('a vote floor of zero is refused', async ({ page }) => {
    await mockOwner(page);
    await openPanel(page);

    await page.fill('#fs-setting-floor', '0');
    await page.click('#btn-save-free-submit');

    await expect(page.locator('#fs-setting-results')).toContainText('at least 1');
    expect(await page.evaluate(() => window.__fsWrites)).toHaveLength(0);
});

test('before the migration lands the panel says so instead of erroring', async ({ page }) => {
    await mockOwner(page, {
        loadError: { message: 'column tier_page_settings.free_submit_open does not exist', code: 'PGRST205' },
    });

    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/owner.html', { waitUntil: 'networkidle' });
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('tierlists'));
    await page.evaluate(() => window.loadFreeSubmitSettings && window.loadFreeSubmitSettings());

    await expect(page.locator('#fs-setting-results')).toContainText('arrives with the next release');
    expect(errors).toEqual([]);
});
