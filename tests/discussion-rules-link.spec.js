// The Rules link beside the reply box (v1.0 batch 4, D1). Spec:
// V1.0-DEVLOG.md, "SPEC 2026-10-05: batch 4".
//
// The Rules page is a CMS page the owner makes, named "Rules", id `rules`.
// The link takes its address from navigation.json, so it appears once the page
// is live and never points at a page that does not exist.
//
// CAN: where the link shows, where it goes from a page two folders deep, that
// it opens a new tab and leaves a half-written post alone, and that no Rules
// page means no link. The Forum's new-post form is tests/forum.spec.js's.
// CANNOT: the Rules page itself, which is owner content.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const PAGE = '/characters/Honored_one/index.html';
const ME = '11111111-1111-4111-8111-111111111111';
const SESSION = { user: { id: ME, email: 'me@site.test' }, access_token: 't' };
const NAV = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'navigation.json'), 'utf8'));
const RULES = {
    id: 'Rules', name: 'Rules', url: 'systems/rules/index.html',
    cms_config: { pageType: 'system', pageId: 'rules', editRole: 'locked' },
};

const post = {
    id: 'p1', page_id: 'honored_one', parent_id: null, reply_to: null,
    author_id: '22222222-2222-4222-8222-222222222222', author_name: 'Gojo main', body: 'Is Blue worth using?',
    images: [], source: 'site', discord_author_id: null, discord_author_handle: null, edited_at: null,
    status: 'visible', created_at: '2026-10-04T10:00:00Z', removed_at: null, removed_by: null,
};

async function openThread(page, { withRules }) {
    // The real sidebar's pages, with or without the owner's Rules page.
    const nav = withRules ? { ...NAV, 'Site Info': [...NAV['Site Info'], RULES] } : NAV;
    await page.route('**/data/navigation.json**', route => route.fulfill({ json: nav }));
    await page.addInitScript(({ session, rows }) => {
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
                    client.auth.getSession = async () => ({ data: { session } });
                    client.auth.onAuthStateChange = () => ({ data: { subscription: { unsubscribe() {} } } });
                    client.rpc = async () => ({ data: [], error: null });
                    client.from = (table) => {
                        if (table === 'page_discussions') {
                            const q = { top: false, parents: null, head: false };
                            return {
                                select(_c, o) { if (o && o.head) q.head = true; return this; },
                                eq() { return this; },
                                is(c, v) { if (c === 'parent_id' && v === null) q.top = true; return this; },
                                in(c, v) { if (c === 'parent_id') q.parents = v; return this; },
                                order() { return this; },
                                range() { return this; },
                                then(resolve) {
                                    if (q.head) return resolve({ data: null, count: rows.length, error: null });
                                    const out = q.parents ? rows.filter(r => q.parents.includes(r.parent_id))
                                        : q.top ? rows.filter(r => r.parent_id === null) : rows;
                                    return resolve({ data: out, error: null });
                                },
                            };
                        }
                        if (table === 'user_roles') {
                            return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: null, error: null }) };
                        }
                        const inert = new Proxy({}, { get(_t, prop) {
                            if (prop === 'then') return (resolve) => resolve({ data: [], error: null });
                            if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null });
                            return () => inert;
                        } });
                        return inert;
                    };
                    return client;
                };
            },
        });
    }, { session: SESSION, rows: [post] });
    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await expect(page.locator('#discussion-section .discussion-post')).toHaveCount(1);
}

test('the box that starts a conversation links the Rules page, in a new tab, leaving the post being written', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openThread(page, { withRules: true });

    const composer = page.locator('#discussion-section > .discussion-composer');
    const link = composer.locator('.discussion-rules-link');
    await expect(link).toHaveText('Rules');
    await expect(link).toBeVisible();
    // Two folders deep, the address still lands on the page.
    expect(new URL(await link.evaluate(a => a.href)).pathname).toBe('/systems/rules/index.html');

    await composer.locator('.discussion-textarea').fill('half a thought');
    const [rules] = await Promise.all([page.waitForEvent('popup'), link.click()]);
    expect(new URL(rules.url()).pathname).toBe('/systems/rules/index.html');
    await expect(composer.locator('.discussion-textarea')).toHaveValue('half a thought');
    expect(errors).toEqual([]);
});

test('a reply box carries no Rules link', async ({ page }) => {
    await openThread(page, { withRules: true });
    await page.locator('#post-p1 .discussion-action-btn', { hasText: 'Reply' }).first().click();
    const reply = page.locator('#post-p1 .discussion-composer');
    await expect(reply.locator('.discussion-textarea')).toBeVisible();
    await expect(reply.locator('.discussion-rules-link')).toHaveCount(0);
    await expect(page.locator('.discussion-rules-link')).toHaveCount(1);
});

test('until the Rules page exists there is no link at all', async ({ page }) => {
    await openThread(page, { withRules: false });
    await expect(page.locator('#discussion-section > .discussion-composer .discussion-textarea')).toBeVisible();
    await expect(page.locator('.discussion-rules-link')).toHaveCount(0);
});
