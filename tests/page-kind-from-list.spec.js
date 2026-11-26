// A submission names the kind of page it is for (character, system, tier
// list...), but that is only the submitter's word. Which renderer the
// Overseer's preview and History run, which editor an intercept opens, and
// the kind approval writes onto the live row all come from the site's own
// page list instead (owner, 2026-11-21). Each case is tried both ways round:
// a page the list calls a character, submitted as a tier list, and the tier
// list page submitted as a character.
//
// The page list is a frozen fixture, so nothing here depends on the owner's
// real pages.
const { test, expect } = require('@playwright/test');

const PAGE_LIST = {
    Characters: [{ id: 'Boomcat', name: 'Boomcat', url: 'characters/Boomcat/index.html',
        cms_config: { pageType: 'character', pageId: 'boomcat', editRole: 'open' } }],
    Guides: [{ id: 'tierlist', name: 'Tier List', url: 'systems/tierlist/index.html',
        cms_config: { pageType: 'tierlist', pageId: 'tierlist', editRole: 'elevated' } }],
};

const TIER_DATA = {
    tabs: [{ id: 'overall', label: 'Overall', tiers: [{ name: 'S', color: '#ff0000', characters: [] }], changelog: [] }],
};

const revision = (id, pageId, namedKind, minutes = 0) => ({
    id, page_id: pageId, page_type: namedKind, status: 'pending', author_id: 'u-author',
    author_name: 'Someone', created_at: new Date(Date.parse('2026-11-21T10:00:00Z') + minutes * 60000).toISOString(),
    is_delta: false, target_scope: null, target_key: null, delta_payload: null,
    desc_data: TIER_DATA, frame_data: {},
    qa_metadata: {}, supporters: [], opposers: [], ticket_chat: [],
});

// An archived page is off the menus but still on the list, with its kind.
const ARCHIVED = {
    oldguide: { name: 'Old Guide', url: 'systems/oldguide/index.html', pageType: 'system', navId: 'oldguide', hideEntryPoints: false },
};

async function servePageList(page) {
    await page.route('**/data/navigation.json**', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(PAGE_LIST),
    }));
    await page.route('**/data/archived-pages.json**', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(ARCHIVED),
    }));
}

// A signed-in admin, canned rows per table, and every write recorded.
async function mockStaff(page, tables) {
    await page.addInitScript((tables) => {
        window.__writes = [];
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
                    client.auth.getSession = async () => ({ data: { session: { user: { id: 'u-staff', email: 'staff@example.com' }, access_token: 'tok' } } });
                    client.from = (table) => {
                        const q = {};
                        const write = (op) => (payload) => { window.__writes.push({ table, op, payload }); q.write = true; return chain; };
                        const answer = () => {
                            if (table === 'user_roles') return { data: [{ role: 'admin' }], error: null };
                            if (q.write) return { data: null, error: null };
                            const rows = tables[table] || [];
                            if (q.single) {
                                const row = rows.find(r => r.page_id === q.page_id || r.id === q.id);
                                return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
                            }
                            return { data: rows.map(r => ({ ...r })), error: null };
                        };
                        const chain = {
                            select() { return chain; }, in() { return chain; }, order() { return chain; },
                            limit() { return chain; }, range() { return chain; }, neq() { return chain; },
                            not() { return chain; }, is() { return chain; },
                            eq(col, val) { q[col] = val; return chain; },
                            upsert: write('upsert'), insert: write('insert'), update: write('update'),
                            single: async () => { q.single = true; return answer(); },
                            maybeSingle: async () => { q.single = true; return answer(); },
                            then(resolve, reject) { return Promise.resolve(answer()).then(resolve, reject); },
                        };
                        return chain;
                    };
                    client.rpc = async () => ({ data: null, error: null });
                    return client;
                };
            },
        });
    }, tables);
}

async function openOverseer(page, rows, pageData = []) {
    await servePageList(page);
    await mockStaff(page, { pending_revisions: rows, page_data: pageData });
    await page.goto('/overseer.html', { waitUntil: 'networkidle' });
    await expect(page.locator('#queue-container .update-log-item')).toHaveCount(rows.length, { timeout: 15000 });
}

const card = (page, pageId) => page.locator('#queue-container .update-log-item', { hasText: pageId.toUpperCase() });

test('the Overseer previews a submission as its page kind, whatever kind it names', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openOverseer(page, [
        revision('00000000-0000-4000-8000-0000000000a1', 'boomcat', 'tierlist', 0),
        revision('00000000-0000-4000-8000-0000000000a2', 'tierlist', 'character', 1),
    ]);

    await card(page, 'boomcat').locator('.admin-review-btn').click();
    await expect.poll(() => page.evaluate(() => window.activePreviewRevId)).toBe('00000000-0000-4000-8000-0000000000a1');
    expect(await page.evaluate(() => window.activePreviewPageType)).toBe('character');
    await expect(page.locator('#tier-list-ui')).toHaveCount(0);

    await page.locator('#queue-toggle').click();
    await card(page, 'tierlist').locator('.admin-review-btn').click();
    await expect.poll(() => page.evaluate(() => window.activePreviewRevId)).toBe('00000000-0000-4000-8000-0000000000a2');
    expect(await page.evaluate(() => window.activePreviewPageType)).toBe('tierlist');
    await expect(page.locator('#tier-list-ui .tier-list-row')).toHaveCount(1);
    expect(errors).toEqual([]);
});

test('an intercept opens the editor as the page kind, archived pages included', async ({ page }) => {
    await openOverseer(page, [
        revision('00000000-0000-4000-8000-0000000000b1', 'boomcat', 'tierlist', 0),
        revision('00000000-0000-4000-8000-0000000000b2', 'oldguide', 'character', 1),
    ]);

    const kindOpened = (revId) => page.evaluate(async (revId) => {
        let url = null;
        window.open = (u) => { url = u; return null; };
        window.adminConfirm = async () => true;
        window.activePreviewRevId = revId;
        await window.editCurrentTicket();
        return new URLSearchParams(url.split('?')[1]).get('type');
    }, revId);
    expect(await kindOpened('00000000-0000-4000-8000-0000000000b1')).toBe('character');
    expect(await kindOpened('00000000-0000-4000-8000-0000000000b2'), 'from the archived list').toBe('system');
});

test('approval writes the page kind onto the live row', async ({ page }) => {
    // boomcat is on the list; "unlisted" is not, so its live row's own kind
    // stands. Neither takes the kind the submission names.
    await openOverseer(page, [
        revision('00000000-0000-4000-8000-0000000000c1', 'boomcat', 'tierlist', 0),
        revision('00000000-0000-4000-8000-0000000000c2', 'unlisted', 'tierlist', 1),
    ], [{ page_id: 'unlisted', page_type: 'system', desc_data: {}, frame_data: {} }]);

    const approve = (revId) => page.evaluate(async (revId) => {
        window.adminPrompt = async () => 'checked';
        window.__alerts = window.__alerts || [];
        window.adminAlert = (m) => window.__alerts.push(m);
        window.activePreviewRevId = revId;
        await approveCurrentPreview();
        const writes = (table, op) => window.__writes.filter(w => w.table === table && w.op === op).map(w => w.payload[0]);
        return {
            kinds: writes('page_data', 'upsert').map(p => p.page_type),
            links: writes('user_notifications', 'insert').map(p => p.link),
        };
    }, revId);

    expect((await approve('00000000-0000-4000-8000-0000000000c1')).kinds).toEqual(['character']);
    const both = await approve('00000000-0000-4000-8000-0000000000c2');
    expect(both.kinds).toEqual(['character', 'system']);
    // The author's notification links each page by the same kind.
    expect(both.links).toEqual(['characters/Boomcat/index.html', 'systems/unlisted/index.html']);
    // Said in a toast each time, never a box.
    await expect(page.locator('.site-toast-msg')).toHaveText(Array(2).fill('Revision approved and merged to live database!'));
    expect(await page.evaluate(() => window.__alerts)).toEqual([]);
});

test("a decline's notification links the page by the list, not the kind it names", async ({ page }) => {
    await openOverseer(page, [revision('00000000-0000-4000-8000-0000000000c3', 'unlisted', 'system')]);

    const links = await page.evaluate(async () => {
        window.adminPrompt = async () => 'not this time';
        window.__alerts = [];
        window.adminAlert = (m) => window.__alerts.push(m);
        window.activePreviewRevId = '00000000-0000-4000-8000-0000000000c3';
        await rejectCurrentPreview();
        return window.__writes.filter(w => w.table === 'user_notifications' && w.op === 'insert').map(w => w.payload[0].link);
    });
    // Not on the list, so the default folder, not the one the kind it names would pick.
    expect(links).toEqual(['characters/Unlisted/index.html']);
    await expect(page.locator('.site-toast-msg')).toHaveText('Revision declined and author notified.');
    expect(await page.evaluate(() => window.__alerts)).toEqual([]);
});

test('restoring an old version writes the page kind, not the one the version carries', async ({ page }) => {
    await openOverseer(page, [revision('00000000-0000-4000-8000-0000000000e1', 'boomcat', 'character')]);

    const kinds = await page.evaluate(async () => {
        window.adminConfirm = async () => true;
        window.__alerts = [];
        window.adminAlert = (m) => window.__alerts.push(m);
        await window.restorePageHistoryVersion({
            page_id: 'boomcat', page_type: 'tierlist', desc_data: {}, frame_data: {},
            version_timestamp: '2026-08-01T00:00:00Z',
        }, 'boomcat');
        return window.__writes.filter(w => w.table === 'page_data' && w.op === 'upsert').map(w => w.payload[0].page_type);
    });
    expect(kinds).toEqual(['character']);
    await expect(page.locator('.site-toast-msg')).toHaveText('Version restored - the page is now live with this content.');
    expect(await page.evaluate(() => window.__alerts)).toEqual([]);
});

test('Recent Changes links each page by the list, not the kind its revision names', async ({ page }) => {
    await servePageList(page);
    const approved = [
        { ...revision('00000000-0000-4000-8000-0000000000f1', 'boomcat', 'system', 0), status: 'approved' },
        { ...revision('00000000-0000-4000-8000-0000000000f2', 'unlisted', 'system', 1), status: 'approved' },
    ];
    await page.route('**/rest/v1/approved_revisions**', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(approved),
    }));

    await page.goto('/recent-changes.html', { waitUntil: 'networkidle' });
    await expect(page.locator('.change-card-page-link', { hasText: 'BOOMCAT' })).toHaveAttribute('href', 'characters/Boomcat/index.html', { timeout: 15000 });
    await expect(page.locator('.change-card-page-link', { hasText: 'UNLISTED' })).toHaveAttribute('href', 'characters/Unlisted/index.html');
});

test('History shows a version as its page kind, whatever kind it names', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await servePageList(page);
    const approved = { ...revision('00000000-0000-4000-8000-0000000000d1', 'tierlist', 'character'), status: 'approved' };
    await page.route('**/rest/v1/approved_revisions**', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify([approved]),
    }));

    await page.goto('/history.html?page=tierlist', { waitUntil: 'networkidle' });
    await expect(page.locator('#tier-list-ui .tier-list-row')).toHaveCount(1, { timeout: 15000 });
    expect(await page.evaluate(() => window.currentEditorPageType)).toBe('tierlist');
    expect(errors).toEqual([]);
});

test('History does not draw a character page as a tier list because a version says so', async ({ page }) => {
    await servePageList(page);
    const approved = { ...revision('00000000-0000-4000-8000-0000000000d2', 'boomcat', 'tierlist'), status: 'approved' };
    await page.route('**/rest/v1/approved_revisions**', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify([approved]),
    }));

    await page.goto('/history.html?page=boomcat', { waitUntil: 'networkidle' });
    await expect.poll(() => page.evaluate(() => window.currentEditorPageType), { timeout: 15000 }).toBe('character');
    await expect(page.locator('#tier-list-ui')).toHaveCount(0);
});
