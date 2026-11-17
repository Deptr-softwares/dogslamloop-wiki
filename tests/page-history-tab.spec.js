// The Page History tab (owner's Overseer card, v1.2).
//
// Every past live version of a page, with COMPARE TO LIVE and RESTORE, lived
// behind the PAGE HISTORY button in the review pane, which only appears once a
// submission is open. So rolling a page back needed a submission on that page
// to be sitting in the queue first. The owner picked "a page picker in the
// Overseer": a fourth tab, for review staff, that opens the same list for any
// page.
//
// The real admin.html as an admin. navigation.json is a two-page fixture, so
// nothing here depends on which pages the owner has made.
const { test, expect } = require('@playwright/test');

const NAV = {
    Characters: [
        { id: 'Vessel', name: 'Vessel', url: 'characters/Vessel/index.html', cms_config: { pageType: 'character', pageId: 'vessel', editRole: 'open' } },
        { id: 'Boomcat', name: 'Boomcat', url: 'characters/Boomcat/index.html', cms_config: { pageType: 'character', pageId: 'boomcat', editRole: 'open' } },
    ],
    'System Pages': [
        { id: 'Blocking', name: 'Blocking', url: 'systems/Blocking/index.html', cms_config: { pageType: 'system', pageId: 'blocking', editRole: 'open' } },
    ],
};

const LIVE = { boomcat: { desc_data: { tagline: 'LIVE TAGLINE' }, frame_data: {} } };
const HISTORY = {
    boomcat: [
        { id: 'h2', page_id: 'boomcat', page_type: 'character', version_timestamp: '2026-11-10T10:00:00Z', updated_by_user: 'editor-two', desc_data: { tagline: 'SECOND TAGLINE' }, frame_data: {} },
        { id: 'h1', page_id: 'boomcat', page_type: 'character', version_timestamp: '2026-11-01T10:00:00Z', updated_by_user: 'editor-one', desc_data: { tagline: 'FIRST TAGLINE' }, frame_data: {} },
    ],
};

const pendingRev = {
    id: '00000000-0000-4000-8000-000000000001',
    page_id: 'vessel', page_type: 'character', status: 'ticket_open',
    author_id: 'u-author', author_name: 'Someone', created_at: '2026-11-17T10:00:00Z',
    is_delta: true, target_scope: 'overview', target_key: 'full', delta_payload: [],
    qa_metadata: { changelog: 'Rewrote the Vessel overview.' },
    supporters: [], opposers: [], ticket_chat: [],
};

async function openOverseer(page, { rows = [], liveError = null } = {}) {
    await page.route('**/data/navigation.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NAV) }));
    await page.addInitScript(({ rows, live, history, liveError }) => {
        window.__reads = [];
        window.__upserts = [];
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
                        const q = { table, eq: {} };
                        const result = () => {
                            if (table === 'user_roles') return { data: [{ role: 'admin' }], error: null };
                            if (table === 'pending_revisions') return { data: rows.map(r => ({ ...r })), error: null };
                            if (table === 'page_history') {
                                window.__reads.push({ table, page_id: q.eq.page_id });
                                return { data: (history[q.eq.page_id] || []).map(r => ({ ...r })), error: null };
                            }
                            if (table === 'page_data') {
                                window.__reads.push({ table, page_id: q.eq.page_id });
                                if (liveError) return { data: null, error: liveError };
                                return { data: live[q.eq.page_id] || null, error: null };
                            }
                            return { data: [], error: null };
                        };
                        const chain = {
                            select() { return chain; }, in() { return chain; }, order() { return chain; },
                            eq(col, val) { q.eq[col] = val; return chain; },
                            single: async () => result(), maybeSingle: async () => result(),
                            upsert: async (payload) => { window.__upserts.push({ table, payload }); return { data: null, error: null }; },
                            then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
                        };
                        return chain;
                    };
                    const channel = { on() { return channel; }, subscribe() { return channel; } };
                    client.channel = () => channel;
                    client.removeChannel = () => {};
                    return client;
                };
            },
        });
    }, { rows, live: LIVE, history: HISTORY, liveError });
    await page.goto('/admin.html', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-queue-tab="revisions"]')).toBeVisible({ timeout: 15000 });
    await page.evaluate(() => {
        window.adminConfirm = async () => true;
        window.adminAlert = async () => {};
    });
}

const historyTab = (page) => page.locator('[data-queue-tab="history"]');
const list = (page) => page.locator('#page-history-container');

// The site's dropdown replaces the <select> and only ever dispatches change.
async function pick(page, pageId) {
    await page.evaluate((pageId) => {
        const select = document.getElementById('history-page-picker');
        select.value = pageId;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }, pageId);
}

test('the tab offers every page, by name, without a submission being open', async ({ page }) => {
    await openOverseer(page);
    await historyTab(page).click();

    const options = await page.locator('#history-page-picker option').evaluateAll(opts =>
        opts.filter(o => o.value).map(o => ({ value: o.value, text: o.textContent })));
    expect(options).toEqual([
        { value: 'blocking', text: 'Blocking' },
        { value: 'boomcat', text: 'Boomcat' },
        { value: 'vessel', text: 'Vessel' },
    ]);
    // Copied into the site's dropdown too: it copies options once, when it
    // builds, and this list arrives after that.
    await expect(page.locator('[data-queue-panel="history"] .manga-option', { hasText: 'Boomcat' })).toHaveCount(1);
});

test('picking a page lists its past versions in the review pane', async ({ page }) => {
    await openOverseer(page);
    await historyTab(page).click();
    await pick(page, 'boomcat');

    await expect(list(page)).toBeVisible();
    await expect(list(page).locator('.page-history-card')).toHaveCount(2);
    await expect(list(page)).toContainText('editor-two');
    await expect(page.locator('#preview-status-text')).toContainText('BOOMCAT');
    await expect(page.locator('#preview-content-area')).toHaveClass(/\bactive\b/);
    expect(await page.evaluate(() => window.__reads.filter(r => r.table === 'page_history').map(r => r.page_id))).toEqual(['boomcat']);
});

test('COMPARE TO LIVE compares against the picked page, as it is live now', async ({ page }) => {
    await openOverseer(page);
    await historyTab(page).click();
    await pick(page, 'boomcat');

    await list(page).locator('.page-history-card').nth(1).getByRole('button', { name: 'COMPARE TO LIVE' }).click();
    const diff = list(page).locator('.page-history-diff').nth(1);
    await expect(diff).toBeVisible();
    await expect(diff).toContainText('FIRST TAGLINE');
    await expect(diff).toContainText('LIVE TAGLINE');
});

test('RESTORE puts that version live on the picked page', async ({ page }) => {
    await openOverseer(page);
    await historyTab(page).click();
    await pick(page, 'boomcat');

    await list(page).locator('.page-history-card').nth(1).getByRole('button', { name: 'RESTORE THIS VERSION' }).click();
    await expect.poll(() => page.evaluate(() => window.__upserts.length)).toBe(1);
    const { table, payload } = await page.evaluate(() => window.__upserts[0]);
    expect(table).toBe('page_data');
    expect(payload[0].page_id).toBe('boomcat');
    expect(payload[0].desc_data).toEqual({ tagline: 'FIRST TAGLINE' });
});

test('picking a page puts away the submission that was open, and reviewing one puts the history away', async ({ page }) => {
    await openOverseer(page, { rows: [pendingRev] });
    await page.locator('#queue-container .admin-review-btn').click();
    await expect(page.locator('#ticket-workspace')).toBeVisible();

    await historyTab(page).click();
    await pick(page, 'boomcat');
    await expect(list(page)).toBeVisible();
    await expect(page.locator('#ticket-workspace')).toBeHidden();
    await expect(page.locator('#version-toggle-bar')).toBeHidden();
    await expect(page.locator('#preview-action-buttons')).toBeHidden();
    await expect(page.locator('#preview-status-text')).not.toContainText('VESSEL');
    expect(await page.evaluate(() => window.activePreviewRevId)).toBe(null);

    await page.locator('[data-queue-tab="revisions"]').click();
    await page.locator('#queue-container .admin-review-btn').click();
    await expect(page.locator('#preview-status-text')).toContainText('VESSEL');
    await expect(list(page)).toBeHidden();
});

test('a page with no recorded versions says so', async ({ page }) => {
    await openOverseer(page);
    await historyTab(page).click();
    await pick(page, 'vessel');
    await expect(list(page)).toContainText('No past live versions recorded for this page yet');
});

test('when the live page cannot be read, it says so rather than comparing against nothing', async ({ page }) => {
    // COMPARE TO LIVE against an empty page would show every field as removed.
    await openOverseer(page, { liveError: { code: '500', message: 'upstream timeout' } });
    await historyTab(page).click();
    await pick(page, 'boomcat');

    await expect(list(page)).toContainText('upstream timeout');
    await expect(list(page).locator('.page-history-card')).toHaveCount(0);
});
