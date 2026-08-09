// Coverage for the Dashboard Text tool (owner.html + js/owner-hub-text.js).
//
// Hub prose was originally routed through edit.html. That was wrong for a
// reason the owner identified: the editor is built around character and system
// pages, and a probe confirmed it showed a generic "Editing Section" title,
// leftover matchups/counterplay tab containers, and a system-page preview that
// could never show the roster grid a dashboard's text is read against.
//
// The first replacement over-corrected into an iframe preview of the real
// dashboard. Removed - the owner had raised the preview to explain why the
// editor was the wrong tool, not to ask for one. Plain fields are the ask, so
// these tests cover exactly that: the form loads what is stored, and saving
// writes the right shape.

const { test, expect } = require('@playwright/test');

const MAIN_HUB_DESC = {
    tabs: [{
        tabId: 'about', tabLabel: 'About Us',
        sections: [{ sectionTitle: 'About Us', layout: 'full', blocks: [
            { type: 'paragraph', align: 'left', content: 'The committed intro paragraph.' },
        ] }],
    }],
};

async function mockOwner(page, { desc = MAIN_HUB_DESC } = {}) {
    await page.addInitScript(({ desc }) => {
        window.__hubWrites = [];
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
                            if (table === 'page_data') {
                                const chain = {
                                    select() { return chain; },
                                    eq() { return chain; },
                                    maybeSingle: async () => ({ data: { desc_data: desc }, error: null }),
                                    single: async () => ({ data: { desc_data: desc }, error: null }),
                                    upsert(payload, opts) {
                                        window.__hubWrites.push({ payload, opts });
                                        return Promise.resolve({ error: null });
                                    },
                                };
                                return chain;
                            }
                            if (table === 'site_meta') {
                                const chain = {
                                    select() { return chain; }, limit() { return chain; },
                                    maybeSingle: async () => ({ data: null, error: null }),
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
    }, { desc });
}

async function openOwner(page) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/owner.html', { waitUntil: 'networkidle' });
    // owner.html groups its tools as of v0.11; select the one under test.
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('content'));
    await expect(page.locator('#hub-text-body')).toHaveValue('The committed intro paragraph.', { timeout: 5000 });
    return errors;
}

test('loads the stored text into the form', async ({ page }) => {
    await mockOwner(page);
    const errors = await openOwner(page);

    await expect(page.locator('#hub-slot-select option')).toHaveCount(1);
    expect(errors).toEqual([]);
});



test('saving writes paragraphs into the slot, keyed on page_id', async ({ page }) => {
    await mockOwner(page);
    await openOwner(page);

    await page.fill('#hub-text-body', 'First para.\n\nSecond para.');
    await page.click('#btn-save-hub-text');
    await expect(page.locator('#hub-text-results')).toContainText('Saved');

    const writes = await page.evaluate(() => window.__hubWrites);
    expect(writes).toHaveLength(1);

    const { payload, opts } = writes[0];
    expect(opts).toEqual({ onConflict: 'page_id' });
    expect(payload.page_id).toBe('main-hub');
    expect(payload.page_type).toBe('system');

    const blocks = payload.desc_data.tabs[0].sections[0].blocks;
    expect(blocks).toEqual([
        { type: 'paragraph', align: 'left', content: 'First para.' },
        { type: 'paragraph', align: 'left', content: 'Second para.' },
    ]);
});


