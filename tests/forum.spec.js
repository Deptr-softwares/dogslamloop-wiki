// The Forum page (v1.0 batch 2). Spec: V1.0-DEVLOG.md, "SPEC 2026-10-04:
// batch 2, the Forum".
//
// CAN: the list (rows, categories, the Discord chip, text never markup), the
// category filter, NEW POST for who may and the prompt for who may not, what a
// new post sends to create_forum_post, one post's page (its header, its
// conversation read oldest first with the reply box last), a removed post, and
// whole-post moderation; and the link on the Main Dashboard.
//
// CANNOT: forum_threads itself, its RLS, create_forum_post's rules or
// moderate_forum_thread's guard. 20261004000002_forum.sql is probed on the
// preview branch; tests/discord-relay-*.spec.js cover the Discord side.
const { test, expect } = require('@playwright/test');

const ME = '11111111-1111-4111-8111-111111111111';
const SESSION = { user: { id: ME, email: 'me@site.test' }, access_token: 't' };
const T1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const T2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const T3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const thread = (over = {}) => ({
    id: T1, title: 'Best Boomcat combo?', tag: 'Question', source: 'site', author_name: 'Kai',
    discord_author_handle: null, status: 'visible', created_at: '2026-10-04T10:00:00Z',
    last_post_at: '2026-10-04T11:00:00Z', post_count: 3, ...over,
});
const message = (over = {}) => ({
    id: 'm1', page_id: `forum:${T1}`, parent_id: null, author_id: 'x', author_name: 'Kai', body: 'opening',
    images: [], source: 'site', discord_author_id: null, discord_author_handle: null, edited_at: null,
    status: 'visible', created_at: '2026-10-04T10:00:00Z', removed_at: null, removed_by: null, ...over,
});

async function openForum(page, { path = '/forum.html', threads = [], messages = [], session = null, roleRow = null, createResult = null } = {}) {
    await page.addInitScript(({ threads, messages, session, roleRow, createResult }) => {
        window.__queries = [];
        window.__rpcCalls = [];
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
                        // Kept across a reload: moderating a post reloads the page.
                        const kept = JSON.parse(sessionStorage.getItem('__rpcCalls') || '[]');
                        kept.push({ name, params });
                        sessionStorage.setItem('__rpcCalls', JSON.stringify(kept));
                        if (name === 'create_forum_post') return createResult || { data: null, error: { message: 'no' } };
                        if (name === 'get_public_profiles' || name === 'get_page_experts') return { data: [], error: null };
                        return { data: 'ok', error: null };
                    };
                    const table = (name, rows) => {
                        const q = { table: name, eq: {}, in: {}, is: {}, order: [], single: false, head: false };
                        window.__queries.push(q);
                        const run = () => {
                            let out = rows.filter(r => Object.entries(q.eq).every(([k, v]) => r[k] === v)
                                && Object.entries(q.in).every(([k, v]) => v.includes(r[k]))
                                && Object.entries(q.is).every(([k, v]) => r[k] === v));
                            const [first] = q.order;
                            if (first) out = [...out].sort((a, b) => (a[first.col] < b[first.col] ? -1 : a[first.col] > b[first.col] ? 1 : 0) * (first.asc ? 1 : -1));
                            return out;
                        };
                        const chain = {
                            select(_c, o) { if (o && o.head) q.head = true; return chain; },
                            eq(c, v) { q.eq[c] = v; return chain; },
                            in(c, v) { if (c === 'parent_id') { q.parents = v; } else { q.in[c] = v; } return chain; },
                            is(c, v) { q.is[c] = v; return chain; },
                            order(col, o) { q.order.push({ col, asc: !!(o && o.ascending) }); return chain; },
                            range() { return chain; },
                            maybeSingle: async () => { q.single = true; return { data: run()[0] || null, error: null }; },
                            then(resolve) {
                                if (q.head) return resolve({ data: null, count: run().length, error: null });
                                let out = run();
                                if (q.parents) out = rows.filter(r => q.parents.includes(r.parent_id));
                                return resolve({ data: out, error: null });
                            },
                        };
                        return chain;
                    };
                    client.from = (name) => {
                        if (name === 'forum_threads') return table(name, threads);
                        if (name === 'page_discussions') return table(name, messages);
                        if (name === 'user_roles') {
                            return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: roleRow, error: null }) };
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
    }, { threads, messages, session, roleRow, createResult });
    await page.goto(path, { waitUntil: 'networkidle' });
}

test('the list shows each post with its category, starter, replies and activity, as text', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await openForum(page, { threads: [
        thread(),
        thread({ id: T2, title: '<img src=x onerror="window.__xss=1">', tag: 'Art', source: 'discord', author_name: 'Mo', discord_author_handle: 'mo', post_count: 2, last_post_at: '2026-10-04T12:00:00Z' }),
        thread({ id: T3, status: 'removed', title: '', post_count: 1 }),
    ] });

    const rows = page.locator('.forum-row');
    await expect(rows).toHaveCount(2);
    // Most recently active first.
    await expect(rows.nth(0)).toHaveAttribute('href', `forum.html?post=${T2}`);
    await expect(rows.nth(0).locator('.forum-row-title')).toHaveText('<img src=x onerror="window.__xss=1">');
    await expect(rows.nth(0).locator('.discussion-discord')).toHaveText('DISCORD');
    await expect(rows.nth(0).locator('.discussion-handle')).toHaveText('@mo');
    await expect(rows.nth(0).locator('.forum-row-count')).toHaveText('1 reply');
    await expect(rows.nth(1).locator('.forum-tag')).toHaveText('Question');
    await expect(rows.nth(1).locator('.forum-row-count')).toHaveText('2 replies');
    await expect(page.locator('.forum-row img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    expect(errors).toEqual([]);
});

test('a category shows only its posts, and All shows them all again', async ({ page }) => {
    await openForum(page, { threads: [thread(), thread({ id: T2, title: 'My art', tag: 'Art' })] });
    await expect(page.locator('.forum-row')).toHaveCount(2);
    await expect(page.locator('.forum-filter')).toHaveText(['All', 'Question', 'Guide', 'Discussion', 'Art', 'Game Update', 'Promotion']);

    await page.locator('.forum-filter', { hasText: 'Art' }).click();
    await expect(page.locator('.forum-row')).toHaveCount(1);
    await expect(page.locator('.forum-row-title')).toHaveText('My art');
    await expect(page.locator('.forum-filter[aria-pressed="true"]')).toHaveText('Art');
    const last = await page.evaluate(() => window.__queries.filter(q => q.table === 'forum_threads').at(-1));
    expect(last.eq).toEqual({ tag: 'Art' });

    await page.locator('.forum-filter', { hasText: 'All' }).click();
    await expect(page.locator('.forum-row')).toHaveCount(2);
});

test('signed out, NEW POST asks to sign in; banned, it says the account cannot post', async ({ page }) => {
    await openForum(page);
    await page.locator('.forum-new-btn').click();
    await expect(page.locator('.forum-new-panel .discussion-signin')).toContainText('Sign in');
    await expect(page.locator('.forum-new-panel form')).toHaveCount(0);

    const banned = await page.context().newPage();
    await openForum(banned, { session: SESSION, roleRow: { role: 'viewer' } });
    await banned.locator('.forum-new-btn').click();
    await expect(banned.locator('.forum-new-panel')).toContainText('can read discussions but not post in them');
    await expect(banned.locator('.forum-new-panel form')).toHaveCount(0);
});

test('a new post sends its title, category and opening message, then opens the post', async ({ page }) => {
    await openForum(page, {
        session: SESSION, roleRow: null,
        threads: [thread({ id: T3, title: 'Brand new', post_count: 1 })],
        messages: [message({ page_id: `forum:${T3}`, body: 'first words' })],
        createResult: { data: T3, error: null },
    });
    await page.locator('.forum-new-btn').click();
    const panel = page.locator('.forum-new-panel');
    await expect(panel.locator('.forum-title-input')).toBeFocused();

    // Nothing is sent without a title and a category.
    await panel.locator('.discussion-textarea').fill('first words');
    await panel.locator('.discussion-submit').click();
    await expect(panel.locator('.discussion-composer-status')).toHaveText('Give the post a title.');
    await panel.locator('.forum-title-input').fill('  Brand new  ');
    await panel.locator('.discussion-submit').click();
    await expect(panel.locator('.discussion-composer-status')).toHaveText('Pick a category.');
    expect(await page.evaluate(() => window.__rpcCalls.filter(c => c.name === 'create_forum_post').length)).toBe(0);

    await panel.locator('.forum-tag-select').selectOption('Guide');
    await panel.locator('.discussion-submit').click();
    // Made, so the browser goes to the new post. What was sent is the next
    // test's: this page's record of it went with the navigation.
    await page.waitForURL(`**/forum.html?post=${T3}`);
    await expect(page.locator('.forum-post-title')).toHaveText('Brand new');
});

test('what a new post sends to create_forum_post', async ({ page }) => {
    await openForum(page, { session: SESSION, createResult: { data: null, error: { message: 'Slow down - you can start a new post once every 2 minutes.' } } });
    await page.locator('.forum-new-btn').click();
    const panel = page.locator('.forum-new-panel');
    await panel.locator('.forum-title-input').fill('  Brand new  ');
    await panel.locator('.forum-tag-select').selectOption('Game Update');
    await panel.locator('.discussion-textarea').fill('first words');
    await panel.locator('.discussion-submit').click();

    // Refused here, so the page stays and the reason is shown as written.
    await expect(panel.locator('.discussion-composer-status')).toHaveText('Slow down - you can start a new post once every 2 minutes.');
    const calls = await page.evaluate(() => window.__rpcCalls.filter(c => c.name === 'create_forum_post'));
    expect(calls).toEqual([{ name: 'create_forum_post', params: { p_title: 'Brand new', p_tag: 'Game Update', p_body: 'first words', p_images: [] } }]);
    await expect(panel.locator('.discussion-textarea')).toHaveValue('first words');
});

test('a post page reads oldest first, with the reply box after the conversation', async ({ page }) => {
    await openForum(page, {
        path: `/forum.html?post=${T1}`,
        session: SESSION,
        threads: [thread()],
        messages: [
            message({ id: 'm2', body: 'second', created_at: '2026-10-04T10:05:00Z' }),
            message({ id: 'm1', body: 'opening', created_at: '2026-10-04T10:00:00Z' }),
            message({ id: 'r1', parent_id: 'm1', body: 'a reply', created_at: '2026-10-04T10:01:00Z' }),
            message({ id: 'other', page_id: 'boomcat', body: 'not this thread' }),
        ],
    });
    await expect(page.locator('.forum-post-title')).toHaveText('Best Boomcat combo?');
    await expect(page).toHaveTitle('Best Boomcat combo? | Forum | Dogslamloop Wiki');
    await expect(page.locator('.forum-post-meta .forum-tag')).toHaveText('Question');
    await expect(page.locator('#forum-back')).toHaveAttribute('href', 'forum.html');

    const bodies = page.locator('.discussion-list > .discussion-post > .discussion-body');
    await expect(bodies).toHaveText(['opening', 'second']);
    await expect(page.locator('#post-m1 .discussion-replies .discussion-body')).toHaveText('a reply');

    const order = await page.evaluate(() => {
        const root = document.getElementById('discussion-section');
        const kids = [...root.children].map(c => c.className.split(' ')[0]);
        return kids;
    });
    expect(order.indexOf('discussion-list')).toBeLessThan(order.indexOf('discussion-composer'));
    await expect(page.locator('.discussion-composer .discussion-textarea')).toHaveAttribute('placeholder', 'Write a message…');

    const q = await page.evaluate(() => window.__queries.find(x => x.table === 'page_discussions' && x.is.parent_id === null));
    expect(q.eq.page_id).toBe(`forum:${T1}`);
    expect(q.order[0]).toEqual({ col: 'created_at', asc: true });
});

test('a removed post shows what happened and no conversation', async ({ page }) => {
    await openForum(page, { path: `/forum.html?post=${T1}`, threads: [thread({ status: 'removed', title: '' })], messages: [message()] });
    await expect(page.locator('.forum-post-title')).toHaveText('[removed by a moderator]');
    await expect(page.locator('#discussion-section')).toBeHidden();
    expect(await page.evaluate(() => window.__queries.some(q => q.table === 'page_discussions'))).toBe(false);

    const gone = await page.context().newPage();
    await openForum(gone, { path: `/forum.html?post=${T1}`, threads: [thread({ status: 'removed_on_discord', title: '' })] });
    await expect(gone.locator('.forum-post-title')).toHaveText('[removed on Discord]');
});

test('an address that is not a post says so', async ({ page }) => {
    await openForum(page, { path: '/forum.html?post=not-a-uuid', threads: [thread()] });
    await expect(page.locator('.forum-empty')).toHaveText('That post could not be found.');
    expect(await page.evaluate(() => window.__queries.some(q => q.table === 'forum_threads'))).toBe(false);
});

test('a moderator can hide a whole post, with a reason; nobody else sees the controls', async ({ page }) => {
    await openForum(page, { path: `/forum.html?post=${T1}`, session: SESSION, roleRow: { role: 'reviewer' }, threads: [thread()], messages: [message()] });
    const mod = page.locator('.forum-mod');
    await expect(mod.locator('button')).toHaveText(['HIDE', 'REMOVE']);
    await mod.locator('button', { hasText: 'HIDE' }).click();
    await page.locator('.forum-mod-form .editor-input').fill('spam');
    await page.locator('.forum-mod-form button[type="submit"]').click();
    await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('__rpcCalls') || '[]')
        .find(c => c.name === 'moderate_forum_thread'))).toEqual({
        name: 'moderate_forum_thread', params: { p_thread_id: T1, p_action: 'hide', p_reason: 'spam' },
    });

    const reader = await page.context().newPage();
    await openForum(reader, { path: `/forum.html?post=${T1}`, session: SESSION, roleRow: null, threads: [thread()], messages: [message()] });
    await expect(reader.locator('.forum-post-title')).toBeVisible();
    await expect(reader.locator('.forum-mod')).toHaveCount(0);
});

test('the Main Dashboard links to the Forum under Sitewide, above the contents', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    const links = await page.evaluate(() => {
        const side = document.querySelector('.local-sidebar-right');
        const kids = [...side.children];
        const forum = side.querySelector('a[href="forum.html"]');
        const sitewide = kids.find(k => k.textContent.trim() === 'Sitewide');
        const contents = kids.find(k => k.textContent.trim() === 'On this page');
        return { text: forum && forum.textContent.trim(), after: kids.indexOf(forum) > kids.indexOf(sitewide), before: kids.indexOf(forum) < kids.indexOf(contents) };
    });
    expect(links).toEqual({ text: '→ Forum', after: true, before: true });
});

test('on a phone, a long title never pushes the page sideways', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openForum(page, { threads: [thread({ title: 'A'.repeat(100), author_name: 'B'.repeat(60) })] });
    await expect(page.locator('.forum-row')).toHaveCount(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
});
