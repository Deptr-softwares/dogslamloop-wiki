// Coverage for the Dashboard Text tool (owner.html + js/owner-hub-text.js).
//
// Hub prose was originally routed through edit.html. That was wrong for a
// reason the owner identified: the editor's preview builds a system-page
// layout, so it structurally could not show the roster grid, FAQ and Credits
// that a dashboard's text has to be read against. A probe confirmed it also
// carried leftover matchups/counterplay tab containers and a generic "Editing
// Section" title.
//
// So the preview here is an iframe of the REAL dashboard. These tests drive it
// end to end - type in the textarea, assert the text appears inside the frame
// alongside the page's own sections - because a preview that silently stops
// updating looks identical to one that has nothing to show yet.

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
    await expect(page.locator('#hub-text-body')).toHaveValue('The committed intro paragraph.', { timeout: 5000 });
    return errors;
}

test('loads the stored text into the form', async ({ page }) => {
    await mockOwner(page);
    const errors = await openOwner(page);

    await expect(page.locator('#hub-slot-select option')).toHaveCount(1);
    expect(errors).toEqual([]);
});

test('typing updates the preview, shown against the real dashboard', async ({ page }) => {
    await mockOwner(page);
    await openOwner(page);

    await page.fill('#hub-text-body', 'A brand new introduction.\n\nAnd a second paragraph.');

    const frame = page.frameLocator('#hub-preview-frame');
    await expect(frame.locator('#about-body')).toContainText('A brand new introduction.', { timeout: 8000 });
    await expect(frame.locator('#about-body')).toContainText('And a second paragraph.');

    // The point of an iframe preview: the surrounding page is really there.
    await expect(frame.locator('#roster-section')).toBeVisible();
    await expect(frame.locator('#faq-section')).toBeVisible();
    await expect(frame.locator('.home-main-title')).toHaveText('Main Dashboard');
});

test('the preview never writes to the database', async ({ page }) => {
    await mockOwner(page);
    await openOwner(page);

    await page.fill('#hub-text-body', 'Typed but not saved.');
    const frame = page.frameLocator('#hub-preview-frame');
    await expect(frame.locator('#about-body')).toContainText('Typed but not saved.', { timeout: 8000 });

    expect(await page.evaluate(() => window.__hubWrites)).toEqual([]);
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

test('switching dashboard repoints the preview at that page', async ({ page }) => {
    await mockOwner(page);
    await openOwner(page);

    await page.selectOption('#hub-text-select', 'character-hub');

    const frame = page.frameLocator('#hub-preview-frame');
    await expect(frame.locator('.home-main-title')).toHaveText('Character Dashboard', { timeout: 8000 });
    await expect(frame.locator('.roster-card').first()).toBeVisible();
});

test('a dashboard opened directly ignores preview messages', async ({ page }) => {
    // The receiver is an authoring aid. A top-level page a visitor is reading
    // must not be paintable by anything, same-origin or not.
    await page.goto('/index.html', { waitUntil: 'networkidle' });

    await page.evaluate(() => {
        window.postMessage({
            type: 'dsl-hub-preview',
            containerId: 'about-body',
            blocks: [{ type: 'paragraph', content: 'INJECTED' }],
        }, window.location.origin);
    });
    await page.waitForTimeout(300);

    await expect(page.locator('#about-body')).not.toContainText('INJECTED');
});
