// One SHOW PREVIEW switch (W23): edit.html, admin.html and post-editor.html each
// kept their own copy of window.toggleMobilePreview, alike but for the words
// the button shows while the preview is up. One copy now, in site_utils.js,
// each button carrying its own words; and window.showMobilePreview, which the
// Overseer's page history and clip preview had each written out by hand.
const { test, expect } = require('@playwright/test');

const PHONE = { width: 390, height: 844 };

// A signed-in account with the given role; every other table is the real one.
async function signInAs(page, role) {
    await page.addInitScript((role) => {
        Object.defineProperty(window, 'supabase', {
            configurable: true,
            get() { return window.__supabaseLib; },
            set(lib) {
                window.__supabaseLib = lib;
                if (!lib || !lib.createClient || lib.__patched) return;
                const create = lib.createClient.bind(lib);
                lib.createClient = (...args) => {
                    const client = create(...args);
                    client.auth.getSession = async () => ({
                        data: { session: { user: { id: 'u1', email: 'staff@example.com' }, access_token: 'tok' } },
                    });
                    const from = client.from.bind(client);
                    client.from = (table) => {
                        if (table === 'user_roles') {
                            const result = { data: [{ role }], error: null };
                            const chain = {
                                select() { return chain; },
                                eq() { return chain; },
                                single: () => Promise.resolve({ data: { role }, error: null }),
                                then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
                            };
                            return chain;
                        }
                        // The fake token is refused by the real database, so
                        // the page history's read of the live page is answered here.
                        if (table === 'page_data') {
                            const chain = {
                                select() { return chain; },
                                eq() { return chain; },
                                maybeSingle: () => Promise.resolve({ data: { desc_data: {}, frame_data: {} }, error: null }),
                            };
                            return chain;
                        }
                        if (table === 'pending_revisions') {
                            const chain = {
                                select() { return chain; },
                                in() { return chain; },
                                eq() { return chain; },
                                order: () => Promise.resolve({ data: [], error: null }),
                            };
                            return chain;
                        }
                        return from(table);
                    };
                    return client;
                };
                lib.__patched = true;
            },
        });
    }, role);
}

const PAGES = [
    { name: 'the editor', url: '/edit.html?char=boomcat&type=character&tab=overview', role: null, back: 'HIDE PREVIEW' },
    { name: 'the Overseer', url: '/admin.html', role: 'admin', back: 'BACK TO QUEUE' },
    { name: 'the blog editor', url: '/post-editor.html', role: 'owner', back: 'BACK TO EDITOR' },
];

for (const p of PAGES) {
    test(`on ${p.name}, the switch shows the preview, says ${p.back}, and goes back`, async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        if (p.role) await signInAs(page, p.role);
        await page.setViewportSize(PHONE);
        await page.goto(p.url, { waitUntil: 'networkidle' });

        const toggle = page.locator('#mobile-preview-toggle');
        await expect(toggle).toBeVisible();
        await expect(toggle).toHaveText('SHOW PREVIEW');

        await toggle.click();
        await expect(page.locator('body')).toHaveClass(/\bmobile-preview-active\b/);
        await expect(toggle).toHaveText(p.back);

        await page.evaluate(() => window.toggleMobilePreview());
        await expect(page.locator('body')).not.toHaveClass(/\bmobile-preview-active\b/);
        await expect(toggle).toHaveText('SHOW PREVIEW');
        expect(errors).toEqual([]);
    });
}

test('opening a page\'s history on a phone takes the reviewer to it', async ({ page }) => {
    await signInAs(page, 'admin');
    await page.setViewportSize(PHONE);
    await page.goto('/admin.html', { waitUntil: 'networkidle' });
    await expect(page.locator('body')).not.toHaveClass(/\bmobile-preview-active\b/);

    await page.evaluate(() => window.openPageHistoryFor('boomcat'));

    await expect(page.locator('body')).toHaveClass(/\bmobile-preview-active\b/);
    await expect(page.locator('#mobile-preview-toggle')).toHaveText('BACK TO QUEUE');
});

test('showMobilePreview opens the preview once on a phone and does nothing on a wide screen', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(PAGES[0].url, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.showMobilePreview());
    await expect(page.locator('body'), 'no switch on a wide screen').not.toHaveClass(/\bmobile-preview-active\b/);

    await page.setViewportSize(PHONE);
    await page.evaluate(() => { window.showMobilePreview(); window.showMobilePreview(); });
    await expect(page.locator('body'), 'a second call does not close it again').toHaveClass(/\bmobile-preview-active\b/);
    await expect(page.locator('#mobile-preview-toggle')).toHaveText('HIDE PREVIEW');
});
