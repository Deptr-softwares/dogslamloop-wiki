// Replies to replies, and editing, on a thread (v1.0 batch 3). Spec:
// V1.0-DEVLOG.md, "SPEC 2026-10-04: batch 3".
//
// CAN: who is offered Reply on a reply and Edit; where the reply box opens and
// what it sends; the quote line and its jump; the edit round trip and the
// "edited" marks; moderators opening earlier versions; that every name and
// word the quote and history draw is text.
//
// CANNOT: that the database records which reply a reply answers, refuses an
// edit by anyone but the author, or hides earlier versions from readers. Those
// are 20261004000003_replies_and_editing.sql's, probed on the preview branch.
const { test, expect } = require('@playwright/test');

const PAGE = '/characters/Honored_one/index.html';
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SESSION = { user: { id: ME, email: 'me@site.test' }, access_token: 't' };

const row = (over = {}) => ({
    id: 'p1', page_id: 'honored_one', parent_id: null, reply_to: null,
    author_id: OTHER, author_name: 'Gojo main', body: 'Is Blue worth using?', images: [],
    source: 'site', discord_author_id: null, discord_author_handle: null, edited_at: null,
    status: 'visible', created_at: '2026-10-04T10:00:00Z', removed_at: null, removed_by: null,
    ...over,
});

async function openThread(page, { rows = [], session = null, roleRow = null, edits = [], editError = null } = {}) {
    await page.addInitScript(({ rows, session, roleRow, edits, editError }) => {
        window.__rpcCalls = [];
        window.__inserts = [];
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
                    client.rpc = async (name, params) => {
                        window.__rpcCalls.push({ name, params });
                        if (name === 'get_public_profiles' || name === 'get_page_experts') return { data: [], error: null };
                        if (name === 'edit_my_discussion_post') {
                            if (editError) return { data: null, error: editError };
                            // What the function does: new words, and the time.
                            const r = rows.find(x => x.id === params.p_post_id);
                            r.body = params.p_body;
                            r.edited_at = '2026-10-04T10:30:00Z';
                            return { data: r.edited_at, error: null };
                        }
                        return { data: 'ok', error: null };
                    };
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
                                insert(list) { window.__inserts.push(...list); return Promise.resolve({ error: null }); },
                                then(resolve) {
                                    if (q.head) return resolve({ data: null, count: rows.length, error: null });
                                    const out = q.parents ? rows.filter(r => q.parents.includes(r.parent_id))
                                        : q.top ? rows.filter(r => r.parent_id === null) : rows;
                                    return resolve({ data: out.map(r => ({ ...r })), error: null });
                                },
                            };
                        }
                        if (table === 'user_roles') {
                            return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: roleRow, error: null }) };
                        }
                        if (table === 'page_discussion_edits') {
                            const q = { post: null };
                            return {
                                select() { return this; },
                                eq(c, v) { if (c === 'post_id') q.post = v; return this; },
                                order() { return this; },
                                then(resolve) {
                                    window.__editsRead = q.post;
                                    return resolve({ data: edits.filter(e => e.post_id === q.post), error: null });
                                },
                            };
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
    }, { rows, session, roleRow, edits, editError });

    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await page.waitForSelector('#discussion-section .discussion-title', { timeout: 30000 });
}

// The conversation from the owner's choice, 2026-10-04: one step in, with a
// quote of what each reply to a reply answers.
const CONVERSATION = [
    row(),
    row({ id: 'r1', parent_id: 'p1', author_name: 'Yuta', body: 'Only in combos.', created_at: '2026-10-04T10:01:00Z' }),
    row({ id: 'r2', parent_id: 'p1', reply_to: 'r1', author_name: 'Toji', body: 'Not after the patch.', created_at: '2026-10-04T10:02:00Z' }),
    row({ id: 'r0', parent_id: 'p1', author_name: 'Mo', status: 'removed_by_author', body: '', created_at: '2026-10-04T10:00:30Z' }),
    row({ id: 'r3', parent_id: 'p1', reply_to: 'r0', author_name: 'Kai', body: 'what did they say?', created_at: '2026-10-04T10:03:00Z' }),
];

test('a reply to a reply quotes who and what it answers, and the quote jumps there', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openThread(page, { rows: CONVERSATION });

    const quote = page.locator('#post-r2 .discussion-quote');
    await expect(quote).toHaveText('↪ Yuta: Only in combos.');
    await expect(quote.locator('.discussion-quote-name')).toHaveText('↪ Yuta:');
    // Above the words it introduces.
    const order = await page.locator('#post-r2').evaluate(el => [...el.children].map(c => c.className.split(' ')[0]));
    expect(order.indexOf('discussion-quote')).toBeLessThan(order.indexOf('discussion-body'));
    // A reply that answers the post at the top quotes nothing.
    await expect(page.locator('#post-r1 .discussion-quote')).toHaveCount(0);
    // An answer to a removed message does not resurrect it.
    await expect(page.locator('#post-r3 .discussion-quote')).toHaveText('↪ a removed message');

    await quote.click();
    await expect(page.locator('#post-r1')).toHaveClass(/discussion-post-linked/);
    expect(errors).toEqual([]);
});

test('a quote shows the answered name and words as text, cut at 100 characters', async ({ page }) => {
    await openThread(page, { rows: [
        row(),
        row({ id: 'r1', parent_id: 'p1', author_name: '<img src=x onerror="window.__xss=1">', body: `<b>bold</b> ${'x'.repeat(200)}` }),
        row({ id: 'r2', parent_id: 'p1', reply_to: 'r1', body: 'ok', created_at: '2026-10-04T10:05:00Z' }),
    ] });
    const quote = page.locator('#post-r2 .discussion-quote');
    await expect(quote.locator('.discussion-quote-name')).toHaveText('↪ <img src=x onerror="window.__xss=1">:');
    const text = await quote.textContent();
    expect(text).toContain('<b>bold</b>');
    expect(text.endsWith('…')).toBe(true);
    await expect(quote.locator('img, b')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('Reply on a reply opens the box at the end of the conversation, naming who it answers, and sends that reply as the parent', async ({ page }) => {
    await openThread(page, { rows: CONVERSATION, session: SESSION });
    await page.locator('#post-r1 [data-reply-to="r1"]').click();

    const replies = page.locator('#post-p1 > .discussion-replies');
    const composer = replies.locator('.discussion-composer');
    await expect(composer).toHaveCount(1);
    expect(await replies.evaluate(el => el.lastElementChild.classList.contains('discussion-composer'))).toBe(true);
    await expect(composer.locator('.discussion-composer-heading')).toHaveText('Replying to Yuta');

    await composer.locator('.discussion-textarea').fill('Which patch?');
    await composer.locator('.discussion-submit').click();
    // The database flattens it under the post at the top and records r1 as the
    // reply it answers; the page sends only what was clicked.
    await expect.poll(() => page.evaluate(() => window.__inserts)).toEqual([
        { page_id: 'honored_one', parent_id: 'r1', body: 'Which patch?' },
    ]);
});

test('Reply is offered on every visible reply to anyone signed in, and to nobody banned or signed out', async ({ page }) => {
    await openThread(page, { rows: CONVERSATION, session: SESSION });
    await expect(page.locator('#post-r1 [data-reply-to="r1"]')).toHaveCount(1);
    await expect(page.locator('#post-r2 [data-reply-to="r2"]')).toHaveCount(1);
    await expect(page.locator('#post-r0 [data-reply-to]')).toHaveCount(0);

    const banned = await page.context().newPage();
    await openThread(banned, { rows: CONVERSATION, session: SESSION, roleRow: { role: 'viewer' } });
    await expect(banned.locator('.discussion-replies [data-reply-to]')).toHaveCount(0);

    const out = await page.context().newPage();
    await openThread(out, { rows: CONVERSATION });
    await expect(out.locator('[data-reply-to]')).toHaveCount(0);
});

test('Edit is offered on your own wiki posts and replies only; a banned account keeps Delete but not Edit', async ({ page }) => {
    const rows = [
        row({ id: 'mine', author_id: ME }),
        row({ id: 'theirs', created_at: '2026-10-04T09:00:00Z' }),
        row({ id: 'myreply', parent_id: 'theirs', author_id: ME, body: 'my reply' }),
        row({ id: 'discord', author_id: null, source: 'discord', discord_author_id: '200000000000000001', created_at: '2026-10-04T08:00:00Z' }),
        row({ id: 'gone', author_id: ME, status: 'removed_by_author', body: '', created_at: '2026-10-04T07:00:00Z' }),
    ];
    await openThread(page, { rows, session: SESSION });
    await expect(page.locator('#post-mine [data-edit-post="mine"]')).toHaveText('Edit');
    await expect(page.locator('#post-myreply [data-edit-post="myreply"]')).toHaveCount(1);
    await expect(page.locator('#post-theirs > .discussion-post-actions [data-edit-post]')).toHaveCount(0);
    await expect(page.locator('#post-discord [data-edit-post]')).toHaveCount(0);
    await expect(page.locator('#post-gone [data-edit-post]')).toHaveCount(0);

    const banned = await page.context().newPage();
    await openThread(banned, { rows, session: SESSION, roleRow: { role: 'viewer' } });
    await expect(banned.locator('[data-edit-post]')).toHaveCount(0);
    await expect(banned.locator('#post-mine [data-remove-post="mine"]')).toHaveCount(1);
});

test('editing sends the new words to edit_my_discussion_post, then shows them marked edited', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openThread(page, { rows: [row({ id: 'mine', author_id: ME, body: 'Blue is bad' })], session: SESSION });

    await page.locator('[data-edit-post="mine"]').click();
    const form = page.locator('#post-mine .discussion-edit-form');
    await expect(form.locator('.discussion-edit-text')).toHaveValue('Blue is bad');
    await expect(page.locator('#post-mine > .discussion-body')).toBeHidden();

    await form.locator('.discussion-edit-text').fill('Blue is fine in combos');
    await form.locator('.discussion-edit-save').click();

    await expect(page.locator('#post-mine > .discussion-body')).toHaveText('Blue is fine in combos');
    await expect(page.locator('#post-mine .discussion-edited')).toHaveText('edited');
    await expect(page.locator('.discussion-edit-form')).toHaveCount(0);
    const calls = await page.evaluate(() => window.__rpcCalls.filter(c => c.name === 'edit_my_discussion_post'));
    expect(calls).toEqual([{ name: 'edit_my_discussion_post', params: { p_post_id: 'mine', p_body: 'Blue is fine in combos' } }]);
    expect(errors).toEqual([]);
});

test('an edit cancelled or left unchanged sends nothing, and a refusal is shown beside the box', async ({ page }) => {
    await openThread(page, { rows: [row({ id: 'mine', author_id: ME, body: 'same' })], session: SESSION });
    await page.locator('[data-edit-post="mine"]').click();
    await page.locator('#post-mine [data-cancel-edit]').click();
    await expect(page.locator('#post-mine > .discussion-body')).toBeVisible();
    await expect(page.locator('.discussion-edit-form')).toHaveCount(0);

    await page.locator('[data-edit-post="mine"]').click();
    await page.locator('#post-mine .discussion-edit-save').click();
    await expect(page.locator('.discussion-edit-form')).toHaveCount(0);
    expect(await page.evaluate(() => window.__rpcCalls.some(c => c.name === 'edit_my_discussion_post'))).toBe(false);

    const refused = await page.context().newPage();
    await openThread(refused, {
        rows: [row({ id: 'mine', author_id: ME, body: 'same' })], session: SESSION,
        editError: { code: '53400', message: 'Slow down - you can edit a post once every 10 seconds.' },
    });
    await refused.locator('[data-edit-post="mine"]').click();
    await refused.locator('#post-mine .discussion-edit-text').fill('changed');
    await refused.locator('#post-mine .discussion-edit-save').click();
    await expect(refused.locator('#post-mine .discussion-edit-form .discussion-composer-status'))
        .toHaveText('Slow down - you can edit a post once every 10 seconds.');
});

test('a KLIPY link typed into an edit is saved as its GIF', async ({ page }) => {
    await page.route(/^https:\/\/api\.klipy\.com\//, r => r.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: { file: { md: { mp4: { url: 'https://static.klipy.com/ii/abc/de/clip.mp4' } } } } }),
    }));
    await openThread(page, { rows: [row({ id: 'mine', author_id: ME, body: 'gif soon' })], session: SESSION });
    await page.locator('[data-edit-post="mine"]').click();
    await page.locator('#post-mine .discussion-edit-text').fill('here https://klipy.com/gifs/ronaldo-smile-4');
    await page.locator('#post-mine .discussion-edit-save').click();
    await expect.poll(() => page.evaluate(() => (window.__rpcCalls.find(c => c.name === 'edit_my_discussion_post') || {}).params))
        .toEqual({ p_post_id: 'mine', p_body: 'here https://static.klipy.com/ii/abc/de/clip.mp4' });
});

test('a moderator opens what a post said before; a reader only sees that it was edited', async ({ page }) => {
    const rows = [row({ id: 'p1', edited_at: '2026-10-04T10:30:00Z', body: 'now' })];
    const edits = [
        { post_id: 'p1', body: 'second <b>version</b>', edited_at: '2026-10-04T10:30:00Z', edited_by: OTHER },
        { post_id: 'p1', body: 'first\nversion', edited_at: '2026-10-04T10:20:00Z', edited_by: null },
    ];
    await openThread(page, { rows, session: SESSION, roleRow: { role: 'reviewer' }, edits });

    const mark = page.locator('#post-p1 .discussion-edited');
    expect(await mark.evaluate(el => el.tagName)).toBe('BUTTON');
    await mark.click();
    const box = page.locator('#post-p1 > .discussion-edits');
    await expect(box.locator('.discussion-edits-title')).toHaveText('Earlier versions (moderators only)');
    await expect(box.locator('.discussion-edits-body')).toHaveText(['second <b>version</b>', 'firstversion']);
    await expect(box.locator('.discussion-edits-body b')).toHaveCount(0);
    // An edit made on Discord says so.
    await expect(box.locator('.discussion-edits-when').nth(1)).toContainText('changed on Discord');
    expect(await page.evaluate(() => window.__editsRead)).toBe('p1');
    // Above the words, and closed again by the same button.
    const order = await page.locator('#post-p1').evaluate(el => [...el.children].map(c => c.className.split(' ')[0]));
    expect(order.indexOf('discussion-edits')).toBeLessThan(order.indexOf('discussion-body'));
    await mark.click();
    await expect(box).toHaveCount(0);

    const reader = await page.context().newPage();
    await openThread(reader, { rows, session: SESSION, edits });
    const plain = reader.locator('#post-p1 .discussion-edited');
    await expect(plain).toHaveText('edited');
    expect(await plain.evaluate(el => el.tagName)).toBe('SPAN');
    expect(await reader.evaluate(() => window.__editsRead)).toBeUndefined();
});

test('on a phone, a long quote and the edit box never push the page sideways', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openThread(page, { rows: [
        row({ id: 'p1', author_id: ME }),
        row({ id: 'r1', parent_id: 'p1', author_name: 'AnExtremelyLongDisplayNameWithNoSpacesAtAll', body: 'x'.repeat(300) }),
        row({ id: 'r2', parent_id: 'p1', reply_to: 'r1', body: 'ok', created_at: '2026-10-04T10:05:00Z' }),
    ], session: SESSION });
    await page.locator('[data-edit-post="p1"]').click();
    await expect(page.locator('#post-r2 .discussion-quote')).toBeVisible();
    await expect(page.locator('#post-p1 .discussion-edit-text')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
});
