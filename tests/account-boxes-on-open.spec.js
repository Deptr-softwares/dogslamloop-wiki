// The profile, a public profile and the inbox (js/utility/account_boxes.js) load the
// first time one of them opens, never with the page, and only once. The dock's
// unread dot still shows at load, from its own count, and a box whose file cannot
// load says so. Supabase is stood in for: a signed-in reader with one notification.
const { test, expect } = require('@playwright/test');

async function signedIn(page) {
    const asked = [];
    page.on('request', request => { if (/js\/utility\/account_boxes\.js/.test(request.url())) asked.push(request.url()); });
    await page.addInitScript(() => {
        window.__inboxLists = 0;
        const notifications = [{
            id: 'n-1', created_at: '2026-11-20T00:00:00Z', user_id: 'me',
            message: 'Your edit to Boomcat was approved.', link: 'characters/Boomcat/index.html', is_read: false,
        }];
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
                        data: { session: { user: { id: 'me', email: 'me@example.com', user_metadata: {} }, access_token: 'tok' } },
                    });
                    client.auth.getUser = async () => ({ data: { user: { id: 'me' } } });
                    // Everything else answers empty, so this is not also a test of the page.
                    const inert = new Proxy({}, {
                        get(_t, prop) {
                            if (prop === 'then') return resolve => resolve({ data: [], error: null });
                            if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null });
                            return () => inert;
                        },
                    });
                    client.from = table => {
                        if (table !== 'user_notifications') return inert;
                        const chain = {
                            head: false,
                            select(_cols, opts) { chain.head = !!(opts && opts.head); return chain; },
                            eq() { return chain; },
                            order() { return chain; },
                            limit() { window.__inboxLists++; return Promise.resolve({ data: notifications, error: null }); },
                            then(resolve, reject) {
                                return Promise.resolve(chain.head ? { count: 1, error: null } : { data: notifications, error: null }).then(resolve, reject);
                            },
                        };
                        return chain;
                    };
                    client.rpc = async () => ({ data: [], error: null });
                    return client;
                };
            },
        });
    });
    return asked;
}

test('the account boxes load the first time one opens, and only once', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const asked = await signedIn(page);
    await page.goto('/index.html', { waitUntil: 'networkidle' });

    expect(asked, 'nothing of the boxes is fetched with the page').toEqual([]);
    expect(await page.evaluate(() => window.__inboxLists), 'nor the inbox list').toBe(0);
    await expect(page.locator('#dock-btn-inbox .dock-badge'), 'the unread dot is there from the start').toBeAttached();
    await expect(page.locator('#profile-modal-overlay')).toHaveCount(0);

    await page.locator('#dock-btn-inbox').click();
    await expect(page.locator('#site-notification-modal')).toBeVisible();
    await expect(page.locator('#site-notification-modal')).toContainText('Your edit to Boomcat was approved.');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/account_boxes\.js\?v=[0-9a-f]{8}$/);

    await page.locator('#site-notification-modal .modal-footer button').click();
    await page.locator('#dock-btn-auth').click();
    await expect(page.locator('#profile-modal-overlay')).toBeVisible();
    await expect(page.locator('#profile-current-name')).toHaveText('me');
    expect(asked, 'the second box comes from the file already loaded').toHaveLength(1);
    expect(errors).toEqual([]);
});

test('a box whose file cannot load says so', async ({ page }) => {
    await signedIn(page);
    await page.route('**/js/utility/account_boxes.js*', route => route.abort());
    await page.goto('/index.html', { waitUntil: 'networkidle' });
    await page.locator('#dock-btn-inbox').click();
    await expect(page.locator('#alert-modal-overlay')).toBeVisible();
    await expect(page.locator('#alert-modal-msg')).toHaveText('Could not open that. Try refreshing.');
});
