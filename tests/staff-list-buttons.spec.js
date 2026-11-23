// A staff list's buttons act on their own row, and no row's value is written
// into an inline handler to get there: the review queue's REVIEW button and the
// blog list's EDIT and DELETE are bound in JS to the row they were drawn for.
// Escaping a value inside a JS string inside an onclick protects nothing,
// because the browser decodes it back before the handler runs. Each list is
// clicked out of order, so a button bound to the wrong row fails.
//
// Also here: a failed queue read shows the database's message as text.
const { test, expect } = require('@playwright/test');

const EVIL = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';

// A signed-in session with the given role, and canned answers per table.
async function mockStaff(page, { role, tables }) {
    await page.addInitScript(({ role, tables }) => {
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
                        const answer = () => {
                            if (table === 'user_roles') return { data: [{ role }], error: null };
                            if (q.delete) {
                                window.__deleted = (window.__deleted || []).concat(`${table}:${q.id}`);
                                return { data: null, error: null };
                            }
                            const t = tables[table];
                            if (!t) return { data: [], error: null };
                            if (t.error) return { data: null, error: t.error };
                            if (q.single) return { data: t.rows.find(r => r.id === q.id) || null, error: null };
                            return { data: t.rows.map(r => ({ ...r })), error: null };
                        };
                        const chain = {
                            select() { return chain; }, in() { return chain; }, order() { return chain; },
                            limit() { return chain; }, range() { return chain; }, neq() { return chain; },
                            not() { return chain; }, is() { return chain; },
                            eq(col, val) { q[col] = val; return chain; },
                            delete() { q.delete = true; return chain; },
                            single: async () => { q.single = true; return answer(); },
                            maybeSingle: async () => { q.single = true; return answer(); },
                            then(resolve, reject) { return Promise.resolve(answer()).then(resolve, reject); },
                        };
                        return chain;
                    };
                    return client;
                };
            },
        });
    }, { role, tables });
}

const revision = (id, pageId, minutes) => ({
    id, page_id: pageId, page_type: 'character', status: 'pending', author_id: 'u-author',
    author_name: 'Someone', created_at: new Date(Date.parse('2026-11-21T10:00:00Z') + minutes * 60000).toISOString(),
    is_delta: true, target_scope: 'overview', target_key: 'full', delta_payload: [],
    qa_metadata: {}, supporters: [], opposers: [], ticket_chat: [],
});
const REVS = [
    revision('00000000-0000-4000-8000-00000000000a', 'boomcat', 0),
    revision('00000000-0000-4000-8000-00000000000b', 'vessel', 1),
];

test('each REVIEW button opens its own revision', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await mockStaff(page, { role: 'admin', tables: { pending_revisions: { rows: REVS }, page_data: { rows: [] } } });
    await page.goto('/overseer.html', { waitUntil: 'networkidle' });
    await expect(page.locator('#queue-container .update-log-item')).toHaveCount(2, { timeout: 15000 });

    const card = (pageId) => page.locator('#queue-container .update-log-item', { hasText: pageId.toUpperCase() });
    await card('vessel').locator('.admin-review-btn').click();
    await expect.poll(() => page.evaluate(() => window.activePreviewRevId)).toBe(REVS[1].id);
    // Opening a submission puts the queue away; ☰ QUEUE brings it back.
    await page.locator('#queue-toggle').click();
    await card('boomcat').locator('.admin-review-btn').click();
    await expect.poll(() => page.evaluate(() => window.activePreviewRevId)).toBe(REVS[0].id);
    expect(errors).toEqual([]);
});

test('a failed queue read shows its message as text', async ({ page }) => {
    await mockStaff(page, { role: 'admin', tables: { pending_revisions: { error: { message: EVIL, code: 'XX000' } } } });
    await page.goto('/overseer.html', { waitUntil: 'networkidle' });

    await expect(page.locator('#queue-container .admin-error-text')).toHaveText(`Error: ${EVIL}`, { timeout: 15000 });
    expect(await page.locator('#queue-container img').count(), 'the message never became an element').toBe(0);
    expect(await page.evaluate(() => window.__xss || 0)).toBe(0);
});

test("the blog list's EDIT and DELETE act on their own post", async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const post = (id, title) => ({
        id, kind: 'blog', status: 'draft', title, slug: id, summary: '', content: [],
        published_at: null, updated_at: '2026-11-21T10:00:00Z',
    });
    await mockStaff(page, { role: 'owner', tables: { site_posts: { rows: [post('p-1', 'First post'), post('p-2', 'Second post')] } } });
    await page.goto('/post-editor.html', { waitUntil: 'networkidle' });
    await expect(page.locator('#post-admin-list .post-admin-row')).toHaveCount(2, { timeout: 15000 });

    const row = (title) => page.locator('#post-admin-list .post-admin-row', { hasText: title });
    await row('Second post').locator('[data-post-action="edit"]').click();
    await expect(page.locator('#post-title')).toHaveValue('Second post');
    await row('First post').locator('[data-post-action="edit"]').click();
    await expect(page.locator('#post-title')).toHaveValue('First post');

    await row('Second post').locator('[data-post-action="delete"]').click();
    await page.locator('#editor-modal-confirm').click();
    await expect.poll(() => page.evaluate(() => window.__deleted || [])).toEqual(['site_posts:p-2']);
    expect(errors).toEqual([]);
});
