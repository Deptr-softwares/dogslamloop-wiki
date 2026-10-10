// A thread reads like a Discord channel (v1.0 Part 3, owner, 2026-10-10).
//
// The owner's words: restyle the discussion thread "to be more like an upward
// scrolling discord channel", because "people on discord like to type out
// their message individually thanks to the fact that not every single message
// has their profile and name attached above it", and add pages: "100 message
// per page, reducing loads".
//
// CAN: grouping under one name line, the box opening at the newest message,
// the pages and what each one asks the database for, a notification link or a
// quote reaching a message on an older page, and where Reply and the rest sit.
//
// CANNOT: that the count and the pages match what RLS lets each reader see.
// The count rides on the page's own request, so they come from one answer.
const { test, expect } = require('@playwright/test');

const PAGE = '/characters/Honored_one/index.html';
const SESSION = { user: { id: 'u-me', email: 'me@site.test' }, access_token: 't' };

const BASE = Date.parse('2026-10-10T10:00:00Z');
// Message i of a thread, i minutes after BASE.
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

// The database, as far as a thread asks it things: equality, ordering, a
// range, a count, a lookup by id, and the "newer than" filter pageOf sends.
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
                            const q = { eq: {}, ids: null, order: [], range: null, head: false, count: false, newer: null };
                            const run = () => {
                                let out = rows.filter(r => Object.entries(q.eq).every(([k, v]) => r[k] === v));
                                if (q.ids) out = out.filter(r => q.ids.includes(r.id));
                                if (q.newer) {
                                    const { at, id } = q.newer;
                                    out = out.filter(r => r.created_at > at || (r.created_at === at && r.id > id));
                                }
                                for (const o of [...q.order].reverse()) {
                                    out = [...out].sort((a, b) => (a[o.col] < b[o.col] ? -1 : a[o.col] > b[o.col] ? 1 : 0) * (o.asc ? 1 : -1));
                                }
                                return out;
                            };
                            const chain = {
                                select(_c, o) { if (o && o.head) q.head = true; if (o && o.count) q.count = true; return chain; },
                                eq(c, v) { q.eq[c] = v; return chain; },
                                in(c, v) { if (c === 'id') q.ids = v; return chain; },
                                order(col, o) { q.order.push({ col, asc: !!(o && o.ascending) }); return chain; },
                                range(a, b) { q.range = [a, b]; window.__ranges.push([a, b]); return chain; },
                                or(expr) {
                                    const m = /^created_at\.gt\."([^"]+)",and\(created_at\.eq\."[^"]+",id\.gt\.([^)]+)\)$/.exec(expr);
                                    if (m) q.newer = { at: m[1], id: m[2] };
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
    await page.waitForSelector('#discussion-section .discussion-scroll .discussion-list', { timeout: 30000 });
}

// --- GROUPING ---

test('messages from one person within 7 minutes share one name line; anything else starts a new one', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const yuta = { author_id: 'u-yuta', author_name: 'Yuta' };
    await openThread(page, { rows: [
        msg(0, yuta),
        msg(2, yuta),                                   // 2 min later: joins
        msg(9, yuta),                                   // 7 min after the last: joins
        msg(17, yuta),                                  // 8 min later: new line
        msg(18, { author_id: 'u-toji', author_name: 'Toji' }), // someone else
        msg(19, { ...yuta }),                           // back to Yuta: new line
        msg(20, { ...yuta, parent_id: 'm018' }),        // a reply: its own line
        msg(21, { ...yuta, status: 'removed_by_author', body: '' }), // removed: its own line
    ] });

    const grouped = await page.locator('.discussion-list > .discussion-post')
        .evaluateAll(nodes => nodes.map(n => [n.id, n.classList.contains('discussion-post-grouped')]));
    expect(grouped).toEqual([
        ['post-m000', false], ['post-m002', true], ['post-m009', true], ['post-m017', false],
        ['post-m018', false], ['post-m019', false], ['post-m020', false], ['post-m021', false],
    ]);

    // A grouped message has no name and no letter of its own: that is the
    // whole point. It keeps its time, for hovering.
    const joined = page.locator('#post-m002');
    await expect(joined.locator('.discussion-author')).toHaveCount(0);
    await expect(joined.locator('.discussion-avatar')).toHaveCount(0);
    await expect(joined.locator('.discussion-time')).toHaveCount(1);
    await expect(page.locator('#post-m000 .discussion-author')).toHaveText('Yuta');
    await expect(page.locator('#post-m000 .discussion-avatar')).toHaveText('Y');
    expect(errors).toEqual([]);
});

// Found in a screenshot on 2026-10-10: two accounts whose ids differ by one
// character got letters one degree apart on the colour wheel, so Boomcat and
// Deptr were the same blue. Measured off the browser, as a hue.
test('two people get clearly different letter colours, and one person keeps theirs', async ({ page }) => {
    await openThread(page, { rows: [
        msg(0, { author_id: 'u1', author_name: 'Boomcat' }),
        msg(10, { author_id: 'u2', author_name: 'Deptr' }),
        msg(20, { author_id: 'u1', author_name: 'Boomcat' }),
    ] });
    const hueOf = (id) => page.locator(`${id} .discussion-avatar`).evaluate(el => {
        const [r, g, b] = getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number).map(v => v / 255);
        const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
        if (!d) return 0;
        let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        return (h * 60 + 360) % 360;
    });
    const [a, b, again] = [await hueOf('#post-m000'), await hueOf('#post-m010'), await hueOf('#post-m020')];
    const apart = Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    expect(apart).toBeGreaterThan(30);
    expect(Math.abs(a - again)).toBeLessThan(1);
});

test('a grouped message takes one line, not a name line and a message line', async ({ page }) => {
    const yuta = { author_id: 'u-yuta', author_name: 'Yuta' };
    await openThread(page, { rows: [msg(0, yuta), msg(1, yuta), msg(2, yuta)] });
    // The structural claim: the second message's words start where the
    // message starts, with nothing drawn above them.
    const gap = await page.locator('#post-m001').evaluate(el => {
        const body = el.querySelector('.discussion-body');
        return body.getBoundingClientRect().top - el.getBoundingClientRect().top;
    });
    const headed = await page.locator('#post-m000').evaluate(el => {
        const body = el.querySelector('.discussion-body');
        return body.getBoundingClientRect().top - el.getBoundingClientRect().top;
    });
    expect(gap).toBeLessThan(headed);
});

// --- THE BOX ---

test('the box opens at the newest message, with the message box under it', async ({ page }) => {
    const rows = Array.from({ length: 60 }, (_, i) => msg(i));
    await openThread(page, { rows });

    const scroller = page.locator('#discussion-section > .discussion-scroll');
    await expect.poll(() => scroller.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight))
        .toBeLessThan(4);
    // It really is a scroll box: the oldest message is out of its view.
    expect(await scroller.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);

    const newest = await page.locator('#post-m059').boundingBox();
    const box = await scroller.boundingBox();
    expect(newest.y + newest.height).toBeLessThanOrEqual(box.y + box.height + 1);
    expect(newest.y).toBeGreaterThanOrEqual(box.y - 1);

    const order = await page.locator('#discussion-section').evaluate(el => [...el.children].map(c => c.className.split(' ')[0]));
    expect(order.indexOf('discussion-scroll')).toBeLessThan(order.indexOf('discussion-composer'));
});

// --- PAGES ---

test('a thread loads 100 messages a page, newest page first, and pages back and forth', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const rows = Array.from({ length: 250 }, (_, i) => msg(i));
    await openThread(page, { rows });

    // The first request is the newest 100, and only 100 are drawn.
    expect(await page.evaluate(() => window.__ranges[0])).toEqual([0, 99]);
    await expect(page.locator('.discussion-list > .discussion-post')).toHaveCount(100);
    await expect(page.locator('.discussion-list > .discussion-post').first()).toHaveAttribute('id', 'post-m150');
    await expect(page.locator('.discussion-list > .discussion-post').last()).toHaveAttribute('id', 'post-m249');
    await expect(page.locator('.discussion-pager-older .discussion-page-label')).toHaveText('Page 1 of 3');
    await expect(page.locator('.discussion-pager-newer')).toHaveCount(0);

    await page.locator('.discussion-pager-older [data-page-go]').click();
    await expect(page.locator('.discussion-list > .discussion-post').first()).toHaveAttribute('id', 'post-m050');
    await expect(page.locator('.discussion-list > .discussion-post').last()).toHaveAttribute('id', 'post-m149');
    expect(await page.evaluate(() => window.__ranges.at(-1))).toEqual([100, 199]);

    await page.locator('.discussion-pager-older [data-page-go]').click();
    await expect(page.locator('.discussion-list > .discussion-post')).toHaveCount(50);
    await expect(page.locator('.discussion-pager-older')).toHaveCount(0);
    await expect(page.locator('.discussion-pager-newer .discussion-page-label')).toHaveText('Page 3 of 3');

    await page.locator('.discussion-pager-newer button', { hasText: 'JUMP TO PRESENT' }).click();
    await expect(page.locator('.discussion-list > .discussion-post').last()).toHaveAttribute('id', 'post-m249');
    expect(errors).toEqual([]);
});

test('posting from an older page goes back to the newest one', async ({ page }) => {
    const rows = Array.from({ length: 150 }, (_, i) => msg(i));
    await openThread(page, { rows });
    await page.locator('.discussion-pager-older [data-page-go]').click();
    await expect(page.locator('.discussion-pager-newer')).toHaveCount(1);

    await page.fill('.discussion-textarea', 'back to the present');
    await page.click('.discussion-submit');
    await expect.poll(() => page.evaluate(() => window.__inserts.length)).toBe(1);
    await expect(page.locator('.discussion-pager-newer')).toHaveCount(0);
    expect(await page.evaluate(() => window.__ranges.at(-1))).toEqual([0, 99]);
});

test('a notification link to a message on an older page opens that page, on the message', async ({ page }) => {
    const rows = Array.from({ length: 250 }, (_, i) => msg(i));
    await openThread(page, { rows, path: `${PAGE}#post-m010` });

    const target = page.locator('#post-m010');
    await expect(target).toHaveClass(/discussion-post-linked/);
    await expect(page.locator('.discussion-pager-newer .discussion-page-label')).toHaveText('Page 3 of 3');
    // Only that page was drawn, not everything between.
    expect(await page.evaluate(() => window.__ranges)).toEqual([[200, 299]]);
});

test('a reply quoting a message on an older page names it, and the quote turns to that page', async ({ page }) => {
    const rows = Array.from({ length: 150 }, (_, i) => msg(i));
    rows.push(msg(150, { parent_id: 'm005', body: 'replying to an old one' }));
    await openThread(page, { rows });

    const quote = page.locator('#post-m150 .discussion-quote');
    // The quoted message is on page 2, and is named all the same.
    await expect(quote).toHaveText('↪ Yuta: message 5');
    await quote.click();
    await expect(page.locator('#post-m005')).toHaveClass(/discussion-post-linked/);
    await expect(page.locator('.discussion-pager-newer')).toHaveCount(1);
});

// --- REPLY, EDIT AND THE REST ---

test('a message\'s controls show while it is hovered, and not before', async ({ page }) => {
    await openThread(page, { rows: [msg(0), msg(1)] });
    const bar = page.locator('#post-m000 > .discussion-post-actions');
    await expect(bar).toHaveCount(1);
    expect(await bar.evaluate(el => getComputedStyle(el).opacity)).toBe('0');
    await page.locator('#post-m000 .discussion-body').hover();
    await expect.poll(() => bar.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
});

test.describe('on a touch screen', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

    test('the controls are always shown, under the words, and nothing scrolls sideways', async ({ page }) => {
        await openThread(page, { rows: [msg(0), msg(1, { body: 'x'.repeat(300) })] });
        const bar = page.locator('#post-m000 > .discussion-post-actions');
        expect(await bar.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
        expect(await bar.evaluate(el => getComputedStyle(el).position)).toBe('static');
        const body = await page.locator('#post-m000 > .discussion-body').boundingBox();
        const actions = await bar.boundingBox();
        expect(actions.y).toBeGreaterThanOrEqual(body.y + body.height - 1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
});
