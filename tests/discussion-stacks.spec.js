// Threads after v1.0 (owner, 2026-10-12): Part 3's Discord-style channel was
// taken back to the old cards (newest first, replies under their post, a
// reply box under the post), keeping three things from it, in the owner's
// choice: letter avatars, pages of 100, and the time beside a message on
// hover. What replaced the channel is the reason it was built: people on
// Discord send one thought as several short messages, so posts one person
// sends within 7 minutes stack under one name line.
//
// CAN: which posts stack and which do not, that each stacked post keeps its
// own buttons, reply and edit, the hover time, the letters' colours, the
// pages and what each asks the database for, and a notification link landing
// on a later page.
//
// CANNOT: that the count matches what RLS lets each reader see. It rides on
// the page's own request, so the two come from one answer.
const { test, expect } = require('@playwright/test');

const PAGE = '/characters/Honored_one/index.html';
const SESSION = { user: { id: 'u-me', email: 'me@site.test' }, access_token: 't' };

const BASE = Date.parse('2026-10-10T10:00:00Z');
// Post i of a thread, i minutes after BASE. Authors alternate by default, so
// a run of these never stacks unless a test says so.
const msg = (i, over = {}) => ({
    id: `m${String(i).padStart(3, '0')}`,
    page_id: 'honored_one', parent_id: null, reply_to: null,
    author_id: `u-${i % 2 ? 'odd' : 'even'}`, author_name: i % 2 ? 'Yuta' : 'Toji',
    body: `message ${i}`, images: [], source: 'site',
    discord_author_id: null, discord_author_handle: null, edited_at: null,
    status: 'visible', created_at: new Date(BASE + i * 60000).toISOString(),
    removed_at: null, removed_by: null,
    ...over,
});

// The database, as far as a thread asks it things: equality, IS NULL, IN,
// ordering, a range, a count, a lookup by id, and pageOf's "before this one"
// filter in either direction.
async function openThread(page, { rows = [], session = SESSION, path = PAGE, viewport } = {}) {
    if (viewport) await page.setViewportSize(viewport);
    await page.addInitScript(({ rows, session }) => {
        window.__ranges = [];
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
                    client.rpc = async (name) => (name === 'get_public_profiles' || name === 'get_page_experts'
                        ? { data: [], error: null } : { data: 'ok', error: null });
                    client.from = (table) => {
                        if (table === 'page_discussions') {
                            const q = { eq: {}, isNull: [], inCol: null, inVals: null, order: [], range: null, head: false, count: false, before: null };
                            const run = () => {
                                let out = rows.filter(r => Object.entries(q.eq).every(([k, v]) => r[k] === v));
                                out = out.filter(r => q.isNull.every(c => r[c] === null));
                                if (q.inCol) out = out.filter(r => q.inVals.includes(r[q.inCol]));
                                if (q.before) {
                                    const { op, at, id } = q.before;
                                    out = op === 'gt'
                                        ? out.filter(r => r.created_at > at || (r.created_at === at && r.id > id))
                                        : out.filter(r => r.created_at < at || (r.created_at === at && r.id < id));
                                }
                                for (const o of [...q.order].reverse()) {
                                    out = [...out].sort((a, b) => (a[o.col] < b[o.col] ? -1 : a[o.col] > b[o.col] ? 1 : 0) * (o.asc ? 1 : -1));
                                }
                                return out;
                            };
                            const chain = {
                                select(_c, o) { if (o && o.head) q.head = true; if (o && o.count) q.count = true; return chain; },
                                eq(c, v) { q.eq[c] = v; return chain; },
                                is(c, v) { if (v === null) q.isNull.push(c); return chain; },
                                in(c, v) { q.inCol = c; q.inVals = v; return chain; },
                                order(col, o) { q.order.push({ col, asc: !!(o && o.ascending) }); return chain; },
                                range(a, b) { q.range = [a, b]; window.__ranges.push([a, b]); return chain; },
                                or(expr) {
                                    const m = /^created_at\.(gt|lt)\."([^"]+)",and\(created_at\.eq\."[^"]+",id\.(?:gt|lt)\.([^)]+)\)$/.exec(expr);
                                    if (m) q.before = { op: m[1], at: m[2], id: m[3] };
                                    return chain;
                                },
                                maybeSingle: async () => ({ data: run()[0] || null, error: null }),
                                insert(list) { window.__inserts.push(...list); return Promise.resolve({ error: null }); },
                                then(resolve) {
                                    const all = run();
                                    if (q.head) return resolve({ data: null, count: all.length, error: null });
                                    const out = q.range ? all.slice(q.range[0], q.range[1] + 1) : all;
                                    return resolve({ data: out.map(r => ({ ...r })), count: q.count ? all.length : null, error: null });
                                },
                            };
                            return chain;
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
    }, { rows, session });
    await page.goto(path, { waitUntil: 'networkidle' });
    await page.waitForSelector('#discussion-section .discussion-list', { timeout: 30000 });
}

const cards = page => page.locator('.discussion-list > .discussion-post')
    .evaluateAll(nodes => nodes.map(n => [n.id, [...n.querySelectorAll(':scope > .discussion-post-item')].map(i => i.id)]));

// --- STACKS ---

test('posts one person sends within 7 minutes stack under one name; anything else is its own card', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const yuta = { author_id: 'u-yuta', author_name: 'Yuta' };
    await openThread(page, { rows: [
        msg(0, yuta),
        msg(2, yuta),                                               // 2 min later: stacks
        msg(9, yuta),                                               // 7 min after the last: stacks
        msg(17, yuta),                                              // 8 min later: new card
        msg(18, { author_id: 'u-toji', author_name: 'Toji' }),      // someone else
        msg(19, yuta),                                              // back to Yuta: new card
        msg(20, { ...yuta, status: 'removed_by_author', body: '' }), // removed: its own card
    ] });

    // Cards newest first, as the thread always read; inside a stack, oldest
    // first, as it was said.
    expect(await cards(page)).toEqual([
        ['post-m020', []], ['post-m019', []], ['post-m018', []], ['post-m017', []],
        ['post-m000', ['post-m002', 'post-m009']],
    ]);

    // One name and one letter for the whole stack: that is the point.
    const stack = page.locator('#post-m000');
    await expect(stack.locator('.discussion-author')).toHaveCount(1);
    await expect(stack.locator('.discussion-author')).toHaveText('Yuta');
    await expect(stack.locator('.discussion-avatar')).toHaveCount(1);
    await expect(stack.locator('.discussion-body')).toHaveText(['message 0', 'message 2', 'message 9']);
    expect(errors).toEqual([]);
});

test('a Discord person stacks by their Discord account, not by the name they show', async ({ page }) => {
    const discord = (i, id) => msg(i, { source: 'discord', author_id: null, author_name: 'Kai', discord_author_id: id, discord_author_handle: 'kai' });
    await openThread(page, { rows: [discord(0, 'd-1'), discord(1, 'd-1'), discord(2, 'd-2')] });
    // Two people both called Kai: the second one is not under the first's name.
    expect(await cards(page)).toEqual([['post-m002', []], ['post-m000', ['post-m001']]]);
});

test('each post in a stack keeps its own buttons, and a reply to one goes under the stack quoting it', async ({ page }) => {
    const me = { author_id: 'u-me', author_name: 'Me' };
    await openThread(page, { rows: [
        msg(0, me), msg(1, me), msg(2, me),
        msg(3, { id: 'r1', parent_id: 'm001', author_id: 'u-toji', author_name: 'Toji', body: 'answering the middle one' }),
    ] });

    for (const id of ['m000', 'm001', 'm002']) {
        await expect(page.locator(`#post-${id} [data-reply-to="${id}"]`).first()).toBeVisible();
        await expect(page.locator(`#post-${id} [data-edit-post="${id}"]`).first()).toBeVisible();
    }

    // The reply to the middle post sits at the end of the stack and says which.
    const reply = page.locator('#post-m000 > .discussion-replies #post-r1');
    await expect(reply.locator('.discussion-quote')).toContainText('message 1');

    // Replying to the last post opens the box under the stack, named by its words.
    await page.locator('#post-m002 [data-reply-to="m002"]').click();
    const box = page.locator('#post-m000 > .discussion-replies > .discussion-composer');
    await expect(box).toBeVisible();
    await expect(box.locator('.discussion-composer-heading')).toHaveText('Replying to "message 2"');
    await box.locator('.discussion-textarea').fill('a reply to the last one');
    await box.locator('.discussion-submit').click();
    await expect.poll(() => page.evaluate(() => window.__inserts.map(r => r.parent_id))).toEqual(['m002']);
});

test('editing a post in a stack opens under its own line and hides only its words', async ({ page }) => {
    const me = { author_id: 'u-me', author_name: 'Me' };
    await openThread(page, { rows: [msg(0, me), msg(1, me)] });
    await page.locator('#post-m001 [data-edit-post="m001"]').click();

    await expect(page.locator('#post-m001 .discussion-edit-text')).toHaveValue('message 1');
    await expect(page.locator('#post-m001 .discussion-item-row > .discussion-body')).toBeHidden();
    await expect(page.locator('#post-m000 > .discussion-item-row > .discussion-body')).toBeVisible();

    await page.locator('#post-m001 [data-cancel-edit]').click();
    await expect(page.locator('#post-m001 .discussion-edit-form')).toHaveCount(0);
    await expect(page.locator('#post-m001 .discussion-item-row > .discussion-body')).toBeVisible();
});

test('a stacked post shows its time beside it, in the left column, on hover only', async ({ page }) => {
    const yuta = { author_id: 'u-yuta', author_name: 'Yuta' };
    await openThread(page, { rows: [msg(0, yuta), msg(1, yuta)] });

    const item = page.locator('#post-m001');
    const time = item.locator(':scope > .discussion-item-time');
    await expect(time).toHaveCount(1);
    expect(await time.evaluate(n => getComputedStyle(n).visibility)).toBe('hidden');

    await item.hover();
    await expect.poll(() => time.evaluate(n => getComputedStyle(n).visibility)).toBe('visible');

    // Left of the words, in the column the letter sits in.
    const sides = await item.evaluate(n => {
        const t = n.querySelector('.discussion-item-time').getBoundingClientRect();
        const body = n.querySelector('.discussion-body').getBoundingClientRect();
        return { timeRight: t.right, bodyLeft: body.left };
    });
    expect(sides.timeRight).toBeLessThanOrEqual(sides.bodyLeft + 1);
});

test('on a phone, a stacked post\'s buttons go under its words', async ({ page }) => {
    const me = { author_id: 'u-me', author_name: 'Me' };
    await openThread(page, { rows: [msg(0, me), msg(1, me)], viewport: { width: 400, height: 900 } });
    const geo = await page.locator('#post-m001').evaluate(n => ({
        body: n.querySelector('.discussion-body').getBoundingClientRect().bottom,
        actions: n.querySelector('.discussion-post-actions').getBoundingClientRect().top,
    }));
    expect(geo.actions).toBeGreaterThanOrEqual(geo.body);
});

// A post that is one long link, the way the relay brings in a GIF someone sent
// on Discord (four on 2026-10-25). On a phone a stacked post's row is a column
// sized to its words, and `break-word` does not let an unbroken link shrink
// that size, so the post grew to 626px and the whole page scrolled sideways.
// That also failed every regeneration run from 10-26.
test('on a phone, a post that is one long link wraps instead of widening the page', async ({ page }) => {
    const link = 'https://cdn.discordapp.com/attachments/1021063411058098257/1465386879577882666/36002CAF-9206-42B9-85BF-915750E47F32.gif';
    const yuta = { author_id: 'u-yuta', author_name: 'Yuta', body: link };
    await openThread(page, { rows: [
        msg(0, { author_id: 'u-toji', author_name: 'Toji', body: link }),   // a post of its own
        msg(10, yuta), msg(11, yuta),                                       // a stack
        msg(12, { body: link, parent_id: 'm000' }),                         // a reply
    ], viewport: { width: 400, height: 900 } });

    const geo = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        return {
            width,
            scrollsSideways: document.documentElement.scrollWidth > width,
            bodies: ['m000', 'm010', 'm011', 'm012'].map(id => {
                const body = document.querySelector(`#post-${id} .discussion-body`);
                return { id, right: Math.round(body.getBoundingClientRect().right), text: body.textContent };
            }),
        };
    });
    for (const body of geo.bodies) {
        expect(body.text, `${body.id} still shows the whole link`).toContain(link);
        expect(body.right, `${body.id} fits the screen`).toBeLessThanOrEqual(geo.width);
    }
    expect(geo.scrollsSideways).toBe(false);
});

// --- LETTERS ---

test('every card and reply has its person\'s letter, one colour per person, two people two colours', async ({ page }) => {
    await openThread(page, { rows: [
        msg(0, { author_id: 'u1', author_name: 'alpha' }),
        msg(1, { author_id: 'u2', author_name: 'beta' }),
        msg(2, { id: 'r1', parent_id: 'm000', author_id: 'u2', author_name: 'beta', body: 'reply' }),
    ] });
    const hue = async sel => page.locator(sel).first().evaluate(n => {
        const [r, g, b] = getComputedStyle(n).backgroundColor.match(/\d+/g).map(Number).map(v => v / 255);
        const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
        if (!d) return 0;
        const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        return Math.round(((h * 60) + 360) % 360);
    });
    await expect(page.locator('#post-m000 > .discussion-avatar')).toHaveText('A');
    await expect(page.locator('#post-r1 .discussion-avatar')).toHaveText('B');

    const alpha = await hue('#post-m000 > .discussion-avatar');
    const beta = await hue('#post-m001 > .discussion-avatar');
    const betaReply = await hue('#post-r1 .discussion-avatar');
    expect(betaReply).toBe(beta);
    const gap = Math.min(Math.abs(alpha - beta), 360 - Math.abs(alpha - beta));
    expect(gap).toBeGreaterThanOrEqual(20);
});

// --- PAGES ---

const many = n => Array.from({ length: n }, (_, i) => msg(i));

test('a thread shows 100 posts a page, newest first, with its page number above and below', async ({ page }) => {
    await openThread(page, { rows: many(230) });

    expect(await page.evaluate(() => window.__ranges[0])).toEqual([0, 99]);
    await expect(page.locator('.discussion-list > .discussion-post')).toHaveCount(100);
    await expect(page.locator('.discussion-list > .discussion-post').first()).toHaveAttribute('id', 'post-m229');
    await expect(page.locator('.discussion-page-label')).toHaveText(['Page 1 of 3', 'Page 1 of 3']);

    await page.locator('.discussion-pager-bottom [data-page-go]', { hasText: 'OLDER POSTS' }).click();
    await expect(page.locator('.discussion-page-label').first()).toHaveText('Page 2 of 3');
    expect(await page.evaluate(() => window.__ranges.at(-1))).toEqual([100, 199]);
    await expect(page.locator('.discussion-list > .discussion-post').first()).toHaveAttribute('id', 'post-m129');

    await page.locator('.discussion-pager-top [data-page-go]', { hasText: 'NEWER POSTS' }).click();
    await expect(page.locator('.discussion-page-label').first()).toHaveText('Page 1 of 3');
});

test('a thread of one page has no page bar', async ({ page }) => {
    await openThread(page, { rows: many(12) });
    await expect(page.locator('.discussion-list > .discussion-post')).toHaveCount(12);
    await expect(page.locator('.discussion-pager')).toHaveCount(0);
});

test('a notification link to a post or reply on a later page opens that page and marks it', async ({ page }) => {
    const rows = [...many(230), msg(231, { id: 'r-old', parent_id: 'm010', body: 'late reply to an old post' })];
    await openThread(page, { rows, path: `${PAGE}#post-r-old` });

    // m010 has 219 newer posts: the third page.
    expect(await page.evaluate(() => window.__ranges[0])).toEqual([200, 299]);
    await expect(page.locator('.discussion-page-label').first()).toHaveText('Page 3 of 3');
    await expect(page.locator('#post-r-old')).toHaveClass(/discussion-post-linked/);
});

test('a reply stays on the page it was written on', async ({ page }) => {
    await openThread(page, { rows: many(230) });
    await page.locator('.discussion-pager-bottom [data-page-go]', { hasText: 'OLDER POSTS' }).click();
    await expect(page.locator('.discussion-page-label').first()).toHaveText('Page 2 of 3');

    await page.locator('#post-m100 [data-reply-to="m100"]').click();
    const box = page.locator('#post-m100 .discussion-composer');
    await box.locator('.discussion-textarea').fill('a reply');
    await box.locator('.discussion-submit').click();
    await expect.poll(() => page.evaluate(() => window.__inserts.length)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__ranges.at(-1))).toEqual([100, 199]);
    await expect(page.locator('.discussion-page-label').first()).toHaveText('Page 2 of 3');
});

test('a new post turns back to the first page, where it lands', async ({ page }) => {
    await openThread(page, { rows: many(230) });
    await page.locator('.discussion-pager-bottom [data-page-go]', { hasText: 'OLDER POSTS' }).click();
    await expect(page.locator('.discussion-page-label').first()).toHaveText('Page 2 of 3');

    const box = page.locator('#discussion-section > .discussion-composer');
    await box.locator('.discussion-textarea').fill('a new post');
    await box.locator('.discussion-submit').click();
    await expect.poll(() => page.evaluate(() => window.__inserts.map(r => r.parent_id))).toEqual([null]);
    await expect.poll(() => page.evaluate(() => window.__ranges.at(-1))).toEqual([0, 99]);
    await expect(page.locator('.discussion-page-label').first()).toHaveText('Page 1 of 3');
});
