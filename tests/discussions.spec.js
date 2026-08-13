// Per-character discussion threads (v0.14 item 1).
//
// What this file can and cannot prove, stated up front because the split
// matters more here than anywhere else in the suite:
//
//   CAN - the rendering, the escaping, the reply/delete controls, the empty
//   state, who is offered a composer, and the fact that the client never
//   claims authorship it is not entitled to.
//
//   CANNOT - RLS, the rate-limit trigger, the one-level flattening, the
//   viewer ban as *enforced*, or the reply-notification trigger. Every auth
//   spec in this project mocks Supabase and never touches Postgres. Those are
//   verified by live probe after merge, and the probes are written down in the
//   PR rather than assumed.
//
// The distinction is not academic: the client-side viewer check below is a
// courtesy that stops someone typing a post they cannot send. The policy in
// the migration is the thing that actually stops them.
const { test, expect } = require('@playwright/test');

const PAGE = '/characters/Honored_one/index.html';

const post = (over = {}) => ({
    id: over.id || 'p1',
    page_id: 'honored_one',
    parent_id: null,
    author_id: 'u-other',
    author_name: 'mango_kun',
    body: 'Sukuna DP is unreactable',
    status: 'visible',
    created_at: '2026-08-13T10:00:00Z',
    removed_at: null,
    removed_by: null,
    ...over,
});

// Mocks the Supabase client before any page script runs. The query builder is
// a small hand-rolled chain rather than a Proxy because these tests care about
// WHICH filters were applied - .is('parent_id', null) versus .in('parent_id',
// ids) is the difference between two queries with different meanings.
async function mockThread(page, {
    rows = [], session = null, role = null, roleRow = null,
    insertError = null, rpcError = null, selectError = null, count = null,
} = {}) {
    await page.addInitScript(({ rows, session, role, roleRow, insertError, rpcError, selectError, count }) => {
        window.__inserts = [];
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
                        // Every RPC this file drives, so a test that seeds an
                        // rpcError gets it wherever it points. Listing them
                        // rather than failing everything keeps the auth and
                        // page_data calls the boot makes out of it.
                        if (['remove_my_discussion_post', 'moderate_discussion_post',
                             'report_discussion_post'].includes(name)) {
                            return rpcError
                                ? { data: null, error: rpcError }
                                : { data: name === 'report_discussion_post' ? 'Thanks - a moderator will take a look.' : 'ok', error: null };
                        }
                        return { data: null, error: null };
                    };

                    client.from = (table) => {
                        if (table === 'user_roles') {
                            // roleRow carries the whole row, capabilities and
                            // all, because the client reads can_moderate off
                            // it. `role` alone stays supported for the tests
                            // that only care about the soft ban.
                            const row = roleRow || (role ? { role } : null);
                            const chain = {
                                select() { return this; },
                                eq() { return this; },
                                maybeSingle: async () => ({ data: row, error: null }),
                                then: (resolve) => resolve({ data: row ? [row] : [], error: null }),
                            };
                            return chain;
                        }

                        if (table === 'page_discussions') {
                            const q = { topLevelOnly: false, parents: null, head: false };
                            const chain = {
                                select(_cols, opts) { if (opts && opts.head) q.head = true; return this; },
                                eq() { return this; },
                                is(col, val) { if (col === 'parent_id' && val === null) q.topLevelOnly = true; return this; },
                                in(col, vals) { if (col === 'parent_id') q.parents = vals; return this; },
                                order() { return this; },
                                range() { return this; },
                                insert(payload) {
                                    window.__inserts.push(payload);
                                    return Promise.resolve(insertError ? { data: null, error: insertError } : { data: payload, error: null });
                                },
                                then(resolve) {
                                    if (selectError) return resolve({ data: null, error: selectError });
                                    // The count query is head-only: no rows, a
                                    // count, and that is the whole response.
                                    if (q.head) return resolve({ data: null, count, error: null });

                                    let out;
                                    if (q.parents) out = rows.filter(r => q.parents.includes(r.parent_id));
                                    else if (q.topLevelOnly) out = rows.filter(r => r.parent_id === null);
                                    else out = rows;
                                    return resolve({ data: out, error: null });
                                },
                            };
                            return chain;
                        }

                        // Everything else the page boots (page_data, site_pages,
                        // page_alerts) answers empty rather than failing, so a
                        // thread test is not also a test of the whole page.
                        const inert = new Proxy({}, {
                            get(_t, prop) {
                                if (prop === 'then') return (resolve) => resolve({ data: [], error: null });
                                if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null });
                                return () => inert;
                            },
                        });
                        return inert;
                    };

                    return client;
                };
            },
        });
    }, { rows, session, role, roleRow, insertError, rpcError, selectError, count });
}

const SESSION = { user: { id: 'u-me', email: 'reader@site.test' }, access_token: 't' };

async function open(page) {
    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await page.waitForSelector('#discussion-section .discussion-title');
}

test('the thread sits below the tabs, not inside them', async ({ page }) => {
    // Structural, not geometric: a discussion is readers talking about the
    // page rather than a section of it, and burying it behind a tab button is
    // how the feature dies quietly.
    await mockThread(page, { rows: [] });
    await open(page);

    const layout = await page.evaluate(() => {
        const section = document.getElementById('discussion-section');
        const tabs = Array.from(document.querySelectorAll('.main-content-area > [id^="tab-"]'));
        const last = tabs[tabs.length - 1];
        return {
            exists: !!section,
            insideATab: tabs.some(t => t.contains(section)),
            afterLastTab: !!(last && (last.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING)),
            inMain: !!(section && section.closest('.main-content-area')),
            isNavButton: !!document.getElementById('nav-discussion'),
        };
    });

    expect(layout.exists).toBe(true);
    expect(layout.insideATab).toBe(false);
    expect(layout.afterLastTab).toBe(true);
    expect(layout.inMain).toBe(true);
    expect(layout.isNavButton, 'not a tab').toBe(false);
});

test('an empty thread reads as an invitation, not as a broken section', async ({ page }) => {
    await mockThread(page, { rows: [], session: SESSION, role: null });
    await open(page);

    const empty = page.locator('.discussion-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('No discussion here yet');
    // The wording has to give somebody a reason to type. "No posts" alone
    // reads as an error state.
    await expect(empty).toContainText(/matchup|combo|wrong/i);
    await expect(page.locator('.discussion-composer')).toBeVisible();
});

test('a signed-out reader sees the thread and a way in, not a composer', async ({ page }) => {
    await mockThread(page, { rows: [post()], session: null });
    await open(page);

    await expect(page.locator('.discussion-post')).toHaveCount(1);
    await expect(page.locator('.discussion-body').first()).toHaveText('Sukuna DP is unreactable');
    await expect(page.locator('.discussion-composer')).toHaveCount(0);
    await expect(page.locator('.discussion-signin')).toContainText('Sign in');
});

test('a viewer is told they cannot post rather than being handed a box that fails', async ({ page }) => {
    // The soft ban. This is the courtesy half - the policy in the migration is
    // what actually refuses the insert, and no browser test can reach it.
    await mockThread(page, { rows: [post()], session: SESSION, role: 'viewer' });
    await open(page);

    await expect(page.locator('.discussion-composer')).toHaveCount(0);
    await expect(page.locator('.discussion-signin')).toContainText('not post');
    await expect(page.locator('[data-reply-to]'), 'no reply controls either').toHaveCount(0);
});

test('replies render one level deep, under their parent', async ({ page }) => {
    await mockThread(page, {
        rows: [
            post({ id: 'top', body: 'top level' }),
            post({ id: 'r1', parent_id: 'top', body: 'first reply', author_name: 'frameperfect', created_at: '2026-08-13T10:05:00Z' }),
            post({ id: 'r2', parent_id: 'top', body: 'second reply', author_name: 'voidwalker', created_at: '2026-08-13T10:06:00Z' }),
        ],
        session: SESSION, role: null,
    });
    await open(page);

    await expect(page.locator('.discussion-post')).toHaveCount(1);
    const replies = page.locator('#post-top .discussion-replies .discussion-reply');
    await expect(replies).toHaveCount(2);
    // Oldest first inside a conversation, even though the posts themselves are
    // newest first - a thread is read downwards.
    await expect(replies.nth(0)).toContainText('first reply');
    await expect(replies.nth(1)).toContainText('second reply');
    // No nesting inside a reply: the flattening happens server-side, and the
    // renderer must not grow a second opinion about it.
    await expect(page.locator('.discussion-reply .discussion-replies')).toHaveCount(0);
});

test('posting sends only the page, parent and body - never an author', async ({ page }) => {
    // The insert deliberately claims no authorship. A BEFORE INSERT trigger
    // overwrites author_id and author_name from auth.uid(), so sending them
    // would be decoration that looks load-bearing - and code that never
    // claims authorship stays safe on the day somebody drops the trigger.
    await mockThread(page, { rows: [], session: SESSION, role: null });
    await open(page);

    await page.fill('.discussion-textarea', 'Ten Shadows domain is +12 on block');
    await page.click('.discussion-submit');

    const inserts = await page.evaluate(() => window.__inserts);
    expect(inserts).toHaveLength(1);
    expect(inserts[0][0]).toEqual({
        page_id: 'honored_one',
        parent_id: null,
        body: 'Ten Shadows domain is +12 on block',
    });
    expect(Object.keys(inserts[0][0])).not.toContain('author_id');
    expect(Object.keys(inserts[0][0])).not.toContain('author_name');
});

test('replying targets the post being replied to', async ({ page }) => {
    await mockThread(page, { rows: [post({ id: 'top' })], session: SESSION, role: null });
    await open(page);

    await page.click('[data-reply-to="top"]');
    const replyBox = page.locator('#post-top .discussion-composer');
    await expect(replyBox).toBeVisible();

    await replyBox.locator('.discussion-textarea').fill('source?');
    await replyBox.locator('.discussion-submit').click();

    const inserts = await page.evaluate(() => window.__inserts);
    expect(inserts[0][0].parent_id).toBe('top');
    expect(inserts[0][0].body).toBe('source?');
});

test('a refused post says why and keeps what was typed', async ({ page }) => {
    // Losing a paragraph to a rate limit is how someone stops using a feature.
    await mockThread(page, {
        rows: [], session: SESSION, role: null,
        insertError: { code: '53400', message: 'Slow down - you can post once every 20 seconds.' },
    });
    await open(page);

    await page.fill('.discussion-textarea', 'a considered opinion');
    await page.click('.discussion-submit');

    await expect(page.locator('.discussion-composer-status')).toContainText('Slow down');
    await expect(page.locator('.discussion-textarea')).toHaveValue('a considered opinion');
});

test('delete is offered on your own post and nobody else\'s', async ({ page }) => {
    await mockThread(page, {
        rows: [
            post({ id: 'mine', author_id: 'u-me', author_name: 'reader', body: 'my post' }),
            post({ id: 'theirs', author_id: 'u-other', body: 'their post' }),
        ],
        session: SESSION, role: null,
    });
    await open(page);

    await expect(page.locator('#post-mine [data-remove-post]')).toHaveCount(1);
    await expect(page.locator('#post-theirs [data-remove-post]')).toHaveCount(0);
});

test('deleting goes through the RPC, which is the only path that cannot rewrite', async ({ page }) => {
    // There is no UPDATE policy for authors on purpose: a policy can say which
    // rows may change, not which columns, so granting one would grant the edit
    // the owner ruled out. Delete-only exists because the RPC is the only
    // write path an author has.
    await mockThread(page, {
        rows: [post({ id: 'mine', author_id: 'u-me', body: 'regrettable take' })],
        session: SESSION, role: null,
    });
    await open(page);

    page.on('dialog', d => d.accept());
    await page.evaluate(() => { window.customConfirm = async () => true; });

    await page.click('#post-mine [data-remove-post]');

    const calls = await page.evaluate(() => window.__rpcCalls);
    expect(calls).toEqual([{ name: 'remove_my_discussion_post', params: { p_post_id: 'mine' } }]);
});

test('a removed post keeps its place so replies underneath still make sense', async ({ page }) => {
    await mockThread(page, {
        rows: [
            post({ id: 'gone', status: 'removed_by_author', body: '', author_name: 'mango_kun' }),
            post({ id: 'r1', parent_id: 'gone', body: 'still here', author_name: 'frameperfect' }),
        ],
        session: SESSION, role: null,
    });
    await open(page);

    await expect(page.locator('#post-gone')).toBeVisible();
    await expect(page.locator('#post-gone > .discussion-body')).toContainText('[removed by the author]');
    // The name goes with the words. A removal that leaves the byline attached
    // to a placeholder still says who said the thing.
    await expect(page.locator('#post-gone .discussion-author').first()).toHaveText('—');
    await expect(page.locator('#post-r1')).toContainText('still here');
    await expect(page.locator('#post-gone [data-remove-post]'), 'nothing left to delete').toHaveCount(0);
});

test('post text is never parsed as markup', async ({ page }) => {
    // The most attacker-reachable string on the site: unreviewed, public the
    // instant it is sent, written by anyone with an account.
    const hostile = '<img src=x onerror="window.__pwned=1"><b>bold</b>';
    await mockThread(page, {
        rows: [post({ id: 'x', body: hostile, author_name: '<script>window.__pwned2=1</script>evil' })],
        session: SESSION, role: null,
    });
    await open(page);

    const result = await page.evaluate(() => ({
        pwned: !!window.__pwned,
        pwned2: !!window.__pwned2,
        imgs: document.querySelectorAll('#discussion-section img').length,
        bolds: document.querySelectorAll('#discussion-section b').length,
        scripts: document.querySelectorAll('#discussion-section script').length,
        bodyText: document.querySelector('#post-x > .discussion-body').textContent,
    }));

    expect(result.pwned).toBe(false);
    expect(result.pwned2).toBe(false);
    expect(result.imgs).toBe(0);
    expect(result.bolds).toBe(0);
    expect(result.scripts).toBe(0);
    expect(result.bodyText, 'shown as the literal text it is').toBe(hostile);
});

test('line breaks survive without the body becoming an innerHTML sink', async ({ page }) => {
    await mockThread(page, {
        rows: [post({ id: 'multi', body: 'line one\nline two\n<not a tag>' })],
        session: SESSION, role: null,
    });
    await open(page);

    const shape = await page.evaluate(() => {
        const body = document.querySelector('#post-multi > .discussion-body');
        return {
            brs: body.querySelectorAll('br').length,
            text: body.textContent,
            childTags: Array.from(body.childNodes).map(n => n.nodeName),
        };
    });

    expect(shape.brs).toBe(2);
    expect(shape.text).toBe('line oneline two<not a tag>');
    // Text nodes and <br> only - nothing else was ever parsed out of the body.
    expect(new Set(shape.childTags)).toEqual(new Set(['#text', 'BR']));
});

test('a missing table degrades to a message instead of a broken section', async ({ page }) => {
    // The normal state between pushing a branch and merging it: migrations
    // apply on merge, so the table genuinely does not exist yet.
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));

    await page.addInitScript(() => {
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
                    client.auth.getSession = async () => ({ data: { session: null } });
                    client.from = (table) => {
                        const chain = new Proxy({}, {
                            get(_t, prop) {
                                if (prop === 'then') {
                                    return (resolve) => resolve(table === 'page_discussions'
                                        ? { data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }
                                        : { data: [], error: null });
                                }
                                if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null });
                                return () => chain;
                            },
                        });
                        return chain;
                    };
                    return client;
                };
            },
        });
    });

    await open(page);

    await expect(page.locator('.discussion-error')).toContainText('not available');
    await expect(page.locator('.discussion-post')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
});

// --- MODERATION (v0.14 item 2) -------------------------------------------
//
// Same split as above, and it matters more here. Everything below proves which
// controls a moderator is offered and what they send. NONE of it proves that a
// non-moderator is refused - can_moderate() and the RPC's own caller check do
// that, and neither is reachable from a browser.

test('an ordinary contributor is offered no moderation controls', async ({ page }) => {
    await mockThread(page, { rows: [post()], session: SESSION, role: null });
    await open(page);

    await expect(page.locator('[data-moderate]')).toHaveCount(0);
    await expect(page.locator('[data-reply-to]'), 'but can still take part').toHaveCount(1);
});

test('the capability grants moderation without granting a role', async ({ page }) => {
    // The point of can_moderate: moderating threads should not require handing
    // somebody the whole revision queue.
    await mockThread(page, {
        rows: [post({ id: 'p1' })],
        session: SESSION,
        role: 'trusted_editor',
        roleRow: { role: 'trusted_editor', can_moderate: true },
    });
    await open(page);

    await expect(page.locator('#post-p1 [data-mod-action="hide"]')).toHaveCount(1);
    await expect(page.locator('#post-p1 [data-mod-action="remove"]')).toHaveCount(1);
});

test('moderating requires a reason, which is what makes the log an audit', async ({ page }) => {
    await mockThread(page, {
        rows: [post({ id: 'p1' })],
        session: SESSION, role: 'reviewer',
        roleRow: { role: 'reviewer', can_moderate: false },
    });
    await open(page);

    await page.click('#post-p1 [data-mod-action="remove"]');
    await expect(page.locator('.discussion-mod-form')).toBeVisible();

    // Submitting empty must not reach the database at all.
    await page.click('.discussion-mod-confirm');
    await expect(page.locator('.discussion-mod-form .discussion-composer-status')).toContainText('reason is required');
    expect(await page.evaluate(() => window.__rpcCalls.length)).toBe(0);

    await page.fill('.discussion-mod-reason', 'Targeted harassment');
    await page.click('.discussion-mod-confirm');

    const calls = await page.evaluate(() => window.__rpcCalls);
    expect(calls).toEqual([{
        name: 'moderate_discussion_post',
        params: { p_post_id: 'p1', p_action: 'remove', p_reason: 'Targeted harassment' },
    }]);
});

test('restore needs no reason - putting something back requires no justification', async ({ page }) => {
    await mockThread(page, {
        rows: [post({ id: 'p1', status: 'removed_by_staff', body: '' })],
        session: SESSION, role: 'admin',
        roleRow: { role: 'admin', can_moderate: false },
    });
    await open(page);

    await page.click('#post-p1 [data-mod-action="restore"]');
    await expect(page.locator('.discussion-mod-reason'), 'no reason field at all').toHaveCount(0);
    await page.click('.discussion-mod-confirm');

    const calls = await page.evaluate(() => window.__rpcCalls);
    expect(calls[0].params).toEqual({ p_post_id: 'p1', p_action: 'restore', p_reason: null });
});

test('a hidden post shows a moderator its text under an unmistakable marker', async ({ page }) => {
    // Readers never receive this row - the SELECT policy filters it out. A
    // moderator does, and has to be able to tell at a glance that it is
    // already down, or they moderate it twice.
    await mockThread(page, {
        rows: [post({ id: 'p1', status: 'hidden', body: 'borderline take' })],
        session: SESSION, role: 'reviewer',
        roleRow: { role: 'reviewer', can_moderate: false },
    });
    await open(page);

    await expect(page.locator('#post-p1 .discussion-hidden-badge')).toContainText('HIDDEN');
    await expect(page.locator('#post-p1 > .discussion-body')).toContainText('borderline take');
    await expect(page.locator('#post-p1 [data-mod-action="restore"]')).toHaveCount(1);
    await expect(page.locator('#post-p1 [data-mod-action="hide"]'), 'already hidden').toHaveCount(0);
});

test('staff cannot restore what an author chose to withdraw', async ({ page }) => {
    // Deliberate: putting somebody's words back after they retracted them is
    // not moderation.
    await mockThread(page, {
        rows: [post({ id: 'p1', status: 'removed_by_author', body: '' })],
        session: SESSION, role: 'admin',
        roleRow: { role: 'admin', can_moderate: false },
    });
    await open(page);

    await expect(page.locator('#post-p1 [data-moderate]')).toHaveCount(0);
});

// --- THE JUMP BUTTON ------------------------------------------------------

test('the jump button sits on the state row and reaches the discussion', async ({ page }) => {
    await mockThread(page, { rows: [post()], session: null, count: 4 });
    await open(page);

    const layout = await page.evaluate(() => {
        const btn = document.getElementById('btn-jump-discussion');
        const bar = document.getElementById('character-mode-bar');
        return {
            exists: !!btn,
            sharesRowWithModeBar: !!(btn && bar && btn.parentElement === bar.parentElement),
            insideModeBar: !!(bar && btn && bar.contains(btn)),
        };
    });

    expect(layout.exists).toBe(true);
    expect(layout.sharesRowWithModeBar).toBe(true);
    // The bar hides itself for a character with fewer than two states, which
    // is 20 of the 22. A button inside it would exist on two pages.
    expect(layout.insideModeBar).toBe(false);

    await page.click('#btn-jump-discussion');
    await expect(page.locator('#discussion-section')).toBeInViewport();
});

test('the jump button shows a count, and nothing at all when there is none', async ({ page }) => {
    await mockThread(page, { rows: [post()], session: null, count: 7 });
    await open(page);
    await expect(page.locator('#jump-discussion-count')).toHaveText('7');

    await page.goto('about:blank');
    await mockThread(page, { rows: [], session: null, count: 0 });
    await open(page);
    // An explicit "0" reads as a dead feature. Silence does not.
    await expect(page.locator('#jump-discussion-count')).toHaveText('');
});

test('the jump button still scrolls when the thread fails to load', async ({ page }) => {
    // A control that does nothing because a query failed is worse than no
    // control, so it is wired before anything is fetched.
    await mockThread(page, { rows: [], session: null, selectError: { code: 'PGRST205', message: 'nope' } });
    await page.goto(PAGE, { waitUntil: 'networkidle' });

    await page.click('#btn-jump-discussion');
    await expect(page.locator('#discussion-section')).toBeInViewport();
});

// --- REPORTING (v0.14 item 6) ---------------------------------------------

test('reporting is offered on other people\'s visible posts only', async ({ page }) => {
    await mockThread(page, {
        rows: [
            post({ id: 'theirs', author_id: 'u-other' }),
            post({ id: 'mine', author_id: 'u-me' }),
            post({ id: 'gone', author_id: 'u-other', status: 'removed_by_author', body: '' }),
        ],
        session: SESSION, role: null,
    });
    await open(page);

    await expect(page.locator('#post-theirs [data-report-post]')).toHaveCount(1);
    // Reporting your own post is a support ticket, not a report - and the RPC
    // refuses it, so offering the button would be offering a failure.
    await expect(page.locator('#post-mine [data-report-post]')).toHaveCount(0);
    await expect(page.locator('#post-gone [data-report-post]'), 'already down').toHaveCount(0);
});

test('a moderator gets moderation controls instead of a report button', async ({ page }) => {
    // Reporting something to yourself is a queue entry nobody needs.
    await mockThread(page, {
        rows: [post({ id: 'p1', author_id: 'u-other' })],
        session: SESSION, role: 'reviewer',
        roleRow: { role: 'reviewer', can_moderate: false },
    });
    await open(page);

    await expect(page.locator('#post-p1 [data-report-post]')).toHaveCount(0);
    await expect(page.locator('#post-p1 [data-mod-action="remove"]')).toHaveCount(1);
});

test('a signed-out reader cannot report', async ({ page }) => {
    await mockThread(page, { rows: [post()], session: null });
    await open(page);
    await expect(page.locator('[data-report-post]')).toHaveCount(0);
});

test('a viewer cannot report either - the soft ban covers it', async ({ page }) => {
    // A report costs a moderator attention, which is exactly the resource a
    // banned account would spend maliciously.
    await mockThread(page, { rows: [post()], session: SESSION, role: 'viewer' });
    await open(page);
    await expect(page.locator('[data-report-post]')).toHaveCount(0);
});

test('the report form offers conduct categories and no "this is wrong"', async ({ page }) => {
    // Deliberate and domain-specific: on a frame-data wiki "this is wrong" is
    // the most common complaint and the least actionable by moderation. A
    // thread is where being wrong gets argued with. Offering the category
    // would fill the queue with disagreements and train moderators to skim.
    await mockThread(page, { rows: [post({ id: 'p1' })], session: SESSION, role: null });
    await open(page);

    await page.click('#post-p1 [data-report-post]');
    const options = await page.locator('.discussion-report-reason option')
        .evaluateAll(opts => opts.map(o => o.value));

    expect(options).toEqual(['spam', 'harassment', 'off_topic', 'other']);
    expect(options).not.toContain('incorrect');
    expect(options).not.toContain('misinformation');
});

test('a report sends the reason and note, then confirms', async ({ page }) => {
    await mockThread(page, { rows: [post({ id: 'p1' })], session: SESSION, role: null });
    await open(page);

    await page.click('#post-p1 [data-report-post]');
    await page.selectOption('.discussion-report-reason', 'harassment');
    await page.fill('.discussion-report-note', 'targeting a specific person');
    await page.click('.discussion-report-confirm');

    const calls = await page.evaluate(() => window.__rpcCalls);
    expect(calls).toEqual([{
        name: 'report_discussion_post',
        params: { p_post_id: 'p1', p_reason: 'harassment', p_note: 'targeting a specific person' },
    }]);

    // The form is replaced, so nobody is left wondering whether it sent.
    await expect(page.locator('.discussion-report-sent')).toBeVisible();
    await expect(page.locator('.discussion-report-form')).toHaveCount(0);
});

test('an optional note is sent as null rather than an empty string', async ({ page }) => {
    await mockThread(page, { rows: [post({ id: 'p1' })], session: SESSION, role: null });
    await open(page);

    await page.click('#post-p1 [data-report-post]');
    await page.click('.discussion-report-confirm');

    const calls = await page.evaluate(() => window.__rpcCalls);
    expect(calls[0].params).toEqual({ p_post_id: 'p1', p_reason: 'spam', p_note: null });
});

test('a refused report says so and leaves the form open', async ({ page }) => {
    await mockThread(page, {
        rows: [post({ id: 'p1' })], session: SESSION, role: null,
        rpcError: { code: '53400', message: 'You have filed several reports just now - give the moderators a moment.' },
    });
    await open(page);

    await page.click('#post-p1 [data-report-post]');
    await page.click('.discussion-report-confirm');

    await expect(page.locator('.discussion-report-form .discussion-composer-status')).toContainText('several reports');
    await expect(page.locator('.discussion-report-form'), 'still there to retry').toHaveCount(1);
});
