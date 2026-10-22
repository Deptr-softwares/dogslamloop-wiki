// The "On this page" sidebar on tool pages (v1.1 batch 10).
//
// Until then nothing on a tool page asked for the contents, so all four said
// "Loading contents..." for good. A tool page now lists its headings like a
// system page, and one with no headings hides "On this page" rather than
// titling an empty list (owner, 2026-10-22), with the header row going too
// when no edit button shares it.
//
// The page's content and its edit role are fixtures, so neither the owner
// writing headings into a tool's intro nor unlocking a tool changes this file.
const { test, expect } = require('@playwright/test');

const PAGE = '/tools/skill-builder-id-reader/index.html';
const PAGE_ID = 'skill_builder_id_reader';
const NAV = require('../data/navigation.json');

const heading = (content, size = 'h2') => ({ type: 'heading', content, size });

async function boot(page, { descData, editRole }) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.route('**/data/navigation.json*', route => {
        const nav = JSON.parse(JSON.stringify(NAV));
        Object.values(nav).flat().forEach(e => {
            if (e && e.cms_config && e.cms_config.pageId === PAGE_ID) e.cms_config.editRole = editRole;
        });
        return route.fulfill({ json: nav });
    });

    await page.addInitScript((desc) => {
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
                    const inert = new Proxy({}, {
                        get(_t, prop) {
                            if (prop === 'then') return (r) => r({ data: [], error: null });
                            if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null });
                            return () => inert;
                        },
                    });
                    client.from = (table) => {
                        if (table !== 'page_data') return inert;
                        const chain = {
                            select() { return chain; },
                            eq() { return chain; },
                            maybeSingle: async () => ({ data: { desc_data: desc }, error: null }),
                        };
                        return chain;
                    };
                    client.rpc = async () => ({ data: null, error: null });
                    return client;
                };
            },
        });
    }, descData);

    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await expect(page.locator('#tool-mount .tool-launch-btn')).toBeVisible();
    return errors;
}

const sidebar = (page) => page.locator('.local-sidebar-right');

test('a tool page lists its headings, and a link in the list goes to one', async ({ page }) => {
    const errors = await boot(page, {
        editRole: 'open',
        descData: {
            intro: [heading('Getting Started')],
            notes: [heading('Known Limits')],
            tool: { url: 'https://example.com/tool' },
        },
    });

    const toc = page.locator('#dynamic-toc');
    await expect(toc).toBeVisible();
    await expect(toc).not.toContainText('Loading contents');
    await expect(toc.locator('a')).toHaveText(['Getting Started', 'Known Limits']);
    await expect(sidebar(page).locator('.sidebar-master-title')).toBeVisible();

    await toc.locator('a', { hasText: 'Known Limits' }).click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#sec-known-limits');

    expect(errors).toEqual([]);
});

test('a locked tool page with no headings hides "On this page" and its header row', async ({ page }) => {
    const errors = await boot(page, { editRole: 'locked', descData: { tool: { url: 'https://example.com/tool' } } });

    await expect(page.locator('#dynamic-toc')).toBeHidden();
    await expect(sidebar(page).locator('.sidebar-master-title')).toBeHidden();
    await expect(sidebar(page).locator('.sidebar-tab-header')).toBeHidden();
    await expect(sidebar(page)).not.toContainText('Loading contents');
    // The rest of the sidebar stays.
    await expect(sidebar(page).locator('.kofi-btn-wrapper')).toBeVisible();

    expect(errors).toEqual([]);
});

test('an editable tool page with no headings keeps its edit button', async ({ page }) => {
    const errors = await boot(page, { editRole: 'open', descData: { tool: { url: 'https://example.com/tool' } } });

    await expect(page.locator('#dynamic-toc')).toBeHidden();
    await expect(sidebar(page).locator('.sidebar-master-title')).toBeHidden();
    await expect(page.locator('#btn-edit-current-tab')).toBeVisible();

    expect(errors).toEqual([]);
});
