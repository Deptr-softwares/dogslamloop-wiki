// v0.17 F11 part 3: other people's profiles.
//
// Clicking a name in a discussion opens that person, and their flair is drawn
// beside their name. Both go through get_public_profiles(uuid[]) - one request
// per thread rather than one per post.
//
// Split, as everywhere else here: RLS and grants are invisible to Playwright, so
// the migration half is static and the preview branch and production probes are
// what verify the SQL. The live half drives the real thread.
//
// The assertions that matter most are the ones about what must NOT appear: a
// private bio must not be in the DOM at all (not merely hidden), and a flair
// containing markup must arrive as text. Both are paired with a positive
// assertion, because an absence assertion that stops being about anything is
// this project's most repeated test failure.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const MIG = path.join(__dirname, '..', 'supabase', 'migrations', '20260903000000_public_profiles_batch.sql');
const SQL = fs.readFileSync(MIG, 'utf8');
const CODE = SQL.replace(/--[^\n]*/g, ' ');

const PAGE = '/characters/Honored_one/index.html';

const post = (over = {}) => ({
    id: 'p1', page_id: 'honored_one', parent_id: null,
    author_id: 'u-other', author_name: 'mango_kun',
    body: 'Sukuna DP is unreactable', status: 'visible',
    created_at: '2026-08-13T10:00:00Z', removed_at: null, removed_by: null,
    ...over,
});

async function mockThread(page, { rows = [], profiles = [], rpcFails = false,
                                  pageExperts = [], expertPages = [] } = {}) {
    await page.addInitScript(({ rows, profiles, rpcFails, pageExperts, expertPages }) => {
        window.__profileCalls = [];
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
                    client.auth.onAuthStateChange = () => ({ data: { subscription: { unsubscribe() {} } } });

                    client.rpc = async (name, params) => {
                        if (name === 'get_public_profiles') {
                            window.__profileCalls.push(params.target_user_ids);
                            if (rpcFails) return { data: null, error: { message: 'nope' } };
                            return {
                                data: profiles.filter(p => params.target_user_ids.includes(p.user_id)),
                                error: null,
                            };
                        }
                        if (name === 'get_page_experts') {
                            window.__expertCalls = (window.__expertCalls || []);
                            window.__expertCalls.push(params.target_page_id);
                            return rpcFails ? { data: null, error: { message: 'nope' } }
                                            : { data: pageExperts, error: null };
                        }
                        if (name === 'get_user_expert_pages') {
                            return rpcFails ? { data: null, error: { message: 'nope' } }
                                            : { data: expertPages, error: null };
                        }
                        return { data: null, error: null };
                    };

                    client.from = (table) => {
                        if (table === 'page_discussions') {
                            const q = { topLevelOnly: false, parents: null, head: false };
                            const chain = {
                                select(_c, o) { if (o && o.head) q.head = true; return this; },
                                eq() { return this; },
                                is(c, v) { if (c === 'parent_id' && v === null) q.topLevelOnly = true; return this; },
                                in(c, v) { if (c === 'parent_id') q.parents = v; return this; },
                                order() { return this; }, range() { return this; },
                                then(resolve) {
                                    if (q.head) return resolve({ data: null, count: rows.length, error: null });
                                    let out;
                                    if (q.parents) out = rows.filter(r => q.parents.includes(r.parent_id));
                                    else if (q.topLevelOnly) out = rows.filter(r => r.parent_id === null);
                                    else out = rows;
                                    return resolve({ data: out, error: null });
                                },
                            };
                            return chain;
                        }
                        const inert = new Proxy({}, {
                            get(_t, prop) {
                                if (prop === 'then') return (r) => r({ data: [], error: null });
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
    }, { rows, profiles, rpcFails, pageExperts, expertPages });
}

async function open(page) {
    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await page.waitForSelector('#discussion-section .discussion-title');
}

// --- THE MIGRATION ---

test('the batch reader applies privacy exactly like the single one', async () => {
    // Two readers of the same data that disagreed about is_private would make
    // the setting mean one thing in the modal and another in the thread.
    expect(CODE).toMatch(/CASE WHEN COALESCE\(up\."is_private", false\) THEN NULL ELSE up\."bio" END/);
    const bare = CODE.match(/up\."bio"/g) || [];
    expect(bare.length, 'bio appears once, inside the CASE').toBe(1);
});

test('the batch reader cannot leak an email either', async () => {
    expect(CODE).not.toMatch(/au\."email"|"email"::text|->>'email'/);
    expect(CODE, 'and falls back to a placeholder, not the email prefix').toMatch(/'Anonymous'/);
});

test('the batch reader is bounded', async () => {
    // Unguessable ids make this a poor enumeration route, but an unbounded
    // array is still an unbounded scan from an anonymous caller.
    expect(CODE).toMatch(/target_user_ids"\[1:\d+\]/);
});

test('the batch reader is callable by a logged-out reader', async () => {
    expect(CODE).toMatch(/REVOKE ALL ON FUNCTION "public"\."get_public_profiles"\(uuid\[\]\) FROM PUBLIC/);
    expect(CODE).toMatch(/GRANT EXECUTE ON FUNCTION "public"\."get_public_profiles"\(uuid\[\]\) TO "anon"/);
    expect(CODE).toMatch(/SET "search_path" TO 'public'/);
    expect(CODE, 'a soft ban is still not published').toMatch(/IS DISTINCT FROM 'viewer'/);
});

test('the shipped single-row function was not edited', async () => {
    // A migration is immutable once pushed - a preview branch records it by
    // version and will not run that version again, which is how v0.14 shipped
    // one that nothing had ever executed.
    const prev = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations',
        '20260827000005_user_profiles.sql'), 'utf8');
    expect(prev).toContain('CREATE OR REPLACE FUNCTION "public"."get_public_profile"("target_user_id" uuid)');
    expect(prev, 'the plural one belongs in its own migration')
        .not.toContain('get_public_profiles');
});

// --- CLICKING A NAME ---

test('clicking an author opens their profile', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await mockThread(page, {
        rows: [post()],
        profiles: [{ user_id: 'u-other', display_name: 'mango_kun', bio: 'Sukuna main since launch.',
                     flair: 'Pro Player', is_private: false, standing: 'reviewer',
                     joined_at: '2026-01-05T00:00:00Z' }],
    });
    await open(page);

    await page.locator('.discussion-author-link').first().click();
    const modal = page.locator('#public-profile-overlay');
    await expect(modal).not.toHaveClass(/hidden/);

    await expect(page.locator('#pubprofile-name')).toHaveText('mango_kun');
    await expect(page.locator('#pubprofile-standing')).toHaveText('Reviewer');
    await expect(page.locator('#pubprofile-bio')).toHaveText('Sukuna main since launch.');
    await expect(page.locator('#pubprofile-flair')).toHaveText('Pro Player');
    await expect(page.locator('#pubprofile-joined')).toContainText('2026');
    expect(errors).toEqual([]);
});

test('the author name is a real button, not a span with a handler', async ({ page }) => {
    // Keyboard reachable and announced as a control. A div with onclick is
    // neither, and this is the only way into somebody's profile.
    await mockThread(page, { rows: [post()], profiles: [] });
    await open(page);
    const tag = await page.locator('.discussion-author-link').first().evaluate(el => el.tagName);
    expect(tag).toBe('BUTTON');
});

test('a removed post does not offer its author', async ({ page }) => {
    // The name is deliberately not shown on a removed post, so there is nothing
    // to click through to.
    await mockThread(page, { rows: [post({ status: 'removed_by_staff' })], profiles: [] });
    await open(page);
    await expect(page.locator('.discussion-author')).toHaveText('—');
    await expect(page.locator('.discussion-author-link')).toHaveCount(0);
});

test('a post whose author was deleted is not clickable', async ({ page }) => {
    // page_discussions.author_id is ON DELETE SET NULL, so this is the real
    // state of every post by a deleted account - not a hypothetical.
    await mockThread(page, { rows: [post({ author_id: null })], profiles: [] });
    await open(page);
    await expect(page.locator('.discussion-author')).toHaveText('mango_kun');
    await expect(page.locator('.discussion-author-link')).toHaveCount(0);
});

test('a profile that no longer exists says so', async ({ page }) => {
    await mockThread(page, { rows: [post()], profiles: [] });   // RPC returns no row
    await open(page);
    await page.locator('.discussion-author-link').first().click();
    await expect(page.locator('#pubprofile-name')).toHaveText('Unknown');
    await expect(page.locator('#pubprofile-bio')).toContainText('no longer exists');
});

// --- PRIVACY, AT THE ONLY PLACE A READER MEETS IT ---

test('a private description is not in the page at all', async ({ page }) => {
    // The bio is nulled by the function, so there is nothing to hide. Asserting
    // the message alone would also pass if the bio were fetched and merely
    // styled away, which is the failure this is here to prevent.
    await mockThread(page, {
        rows: [post()],
        profiles: [{ user_id: 'u-other', display_name: 'mango_kun', bio: null,
                     flair: null, is_private: true, standing: null, joined_at: null }],
    });
    await open(page);
    await page.locator('.discussion-author-link').first().click();

    await expect(page.locator('#pubprofile-bio')).toContainText('private');
    const html = await page.locator('#public-profile-overlay').innerHTML();
    expect(html).not.toContain('Sukuna main since launch');
});

test('a soft-banned author reads as an ordinary member', async ({ page }) => {
    // get_public_profiles returns NULL for a viewer's standing, so the client
    // must land on the member badge rather than inventing one.
    await mockThread(page, {
        rows: [post()],
        profiles: [{ user_id: 'u-other', display_name: 'mango_kun', bio: null, flair: null,
                     is_private: false, standing: null, joined_at: null }],
    });
    await open(page);
    await page.locator('.discussion-author-link').first().click();
    await expect(page.locator('#pubprofile-standing')).toHaveText('Member');
});

// --- THE FLAIR ---

test('a flair is drawn beside the name in the thread', async ({ page }) => {
    await mockThread(page, {
        rows: [post()],
        profiles: [{ user_id: 'u-other', display_name: 'mango_kun', bio: null,
                     flair: 'Guide Writer', is_private: false, standing: null, joined_at: null }],
    });
    await open(page);
    const flair = page.locator('.discussion-flair');
    await expect(flair).toHaveText('Guide Writer');
    // Inside the author button, so it moves with the name.
    expect(await flair.evaluate(el => !!el.closest('.discussion-author-link'))).toBe(true);
});

test('a flair containing markup arrives as text', async ({ page }) => {
    // Contributor-written, rendered on every thread on the site, and reachable
    // by anyone with an account.
    await mockThread(page, {
        rows: [post()],
        profiles: [{ user_id: 'u-other', display_name: 'mango_kun', bio: null,
                     flair: '<img src=x onerror=alert(1)>', is_private: false,
                     standing: null, joined_at: null }],
    });
    await open(page);

    const flair = page.locator('.discussion-flair');
    // The positive assertion: the tag survives as visible text.
    await expect(flair).toHaveText('<img src=x onerror=alert(1)>');
    expect(await page.locator('.discussion-post-head img').count(), 'and no element was created').toBe(0);
});

test('the whole thread costs one profile request, not one per post', async ({ page }) => {
    // The reason the batch function exists. Four posts by three people is one
    // call carrying three de-duplicated ids.
    await mockThread(page, {
        rows: [
            post({ id: 'p1', author_id: 'a' }),
            post({ id: 'p2', author_id: 'b' }),
            post({ id: 'p3', author_id: 'a' }),
            post({ id: 'p4', author_id: 'c' }),
        ],
        profiles: [],
    });
    await open(page);
    await expect.poll(async () => await page.evaluate(() => window.__profileCalls.length)).toBe(1);
    const ids = await page.evaluate(() => window.__profileCalls[0]);
    expect([...ids].sort()).toEqual(['a', 'b', 'c']);
});

test('a failed profile request costs the thread nothing', async ({ page }) => {
    // Before the release this RPC does not exist in production. A thread that
    // threw here would be a blank section instead of a missing chip.
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await mockThread(page, { rows: [post()], profiles: [], rpcFails: true });
    await open(page);

    await expect(page.locator('.discussion-body')).toContainText('unreactable');
    await expect(page.locator('.discussion-flair')).toHaveCount(0);

    await page.locator('.discussion-author-link').first().click();
    await expect(page.locator('#public-profile-overlay')).not.toHaveClass(/hidden/);
    // The modal must REACH a state, not sit on its placeholder.
    //
    // Asserting only that the overlay is visible was too weak, and mutation
    // testing proved it: the overlay is shown before the request is made, so it
    // stays visible even when the fetch throws and the modal is stuck on
    // "Loading..." forever. This is the assertion that fails when the error
    // handling is removed.
    await expect(page.locator('#pubprofile-name')).toHaveText('Unknown');
    await expect(page.locator('#pubprofile-name')).not.toHaveText('Loading...');
    expect(errors).toEqual([]);
});

// --- THE EXPERT BADGE (owner's placement, 2026-09-03: on the person, not the
// page - in their profile, and beside their name in a thread they cover) ---

test('an expert of this page is marked in the thread', async ({ page }) => {
    await mockThread(page, {
        rows: [post()],
        profiles: [{ user_id: 'u-other', display_name: 'mango_kun', bio: null,
                     flair: 'Pro Player', is_private: false, standing: null, joined_at: null }],
        pageExperts: [{ user_id: 'u-other', display_name: 'mango_kun', flair: 'Pro Player' }],
    });
    await open(page);

    const chip = page.locator('.discussion-expert');
    await expect(chip).toHaveText('EXPERT');
    // Inside the author button, so it travels with the name.
    expect(await chip.evaluate(el => !!el.closest('.discussion-author-link'))).toBe(true);
    // Before the flair: the site vouching for them, then what they said about
    // themselves. Two labels that must not read as one.
    const order = await page.locator('.discussion-author-link').first().evaluate(el =>
        [...el.querySelectorAll('span')].map(s => s.className));
    expect(order[0]).toContain('discussion-expert');
    expect(order[1]).toContain('discussion-flair');
});

test('a non-expert author gets no chip', async ({ page }) => {
    await mockThread(page, {
        rows: [post({ author_id: 'u-other' })],
        profiles: [],
        pageExperts: [{ user_id: 'somebody-else', display_name: 'x', flair: null }],
    });
    await open(page);
    await expect(page.locator('.discussion-expert')).toHaveCount(0);
});

test('the chip is asked for against THIS page, not all pages', async ({ page }) => {
    // An expert of Crow Charmer is an ordinary poster on Sukuna. The scoping is
    // the whole feature, and it lives in which page_id is sent.
    await mockThread(page, { rows: [post()], profiles: [], pageExperts: [] });
    await open(page);
    await expect.poll(async () => await page.evaluate(() => (window.__expertCalls || []).length)).toBe(1);
    const asked = await page.evaluate(() => window.__expertCalls[0]);
    expect(asked).toBe('honored_one');
});

test('a failed expert lookup costs the thread nothing', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await mockThread(page, { rows: [post()], profiles: [], rpcFails: true });
    await open(page);
    await expect(page.locator('.discussion-body')).toContainText('unreactable');
    await expect(page.locator('.discussion-expert')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('a profile lists the pages that person covers, by name', async ({ page }) => {
    await mockThread(page, {
        rows: [post()],
        profiles: [{ user_id: 'u-other', display_name: 'mango_kun', bio: null, flair: null,
                     is_private: false, standing: null, joined_at: null }],
        expertPages: [{ page_id: 'crow_charmer', page_name: 'Crow Charmer' },
                      { page_id: 'boomcat', page_name: 'Boomcat' }],
    });
    await open(page);
    await page.locator('.discussion-author-link').first().click();

    const block = page.locator('#pubprofile-expertise');
    await expect(block).not.toHaveClass(/hidden/);
    // Names, not ids: "crow_charmer" is not what the page is called anywhere a
    // reader has seen it.
    await expect(page.locator('#pubprofile-expertise-pages')).toHaveText('Crow Charmer · Boomcat');
    await expect(block).not.toContainText('crow_charmer');
});

test('somebody who is an expert of nothing shows no expertise line', async ({ page }) => {
    await mockThread(page, {
        rows: [post()],
        profiles: [{ user_id: 'u-other', display_name: 'mango_kun', bio: null, flair: null,
                     is_private: false, standing: null, joined_at: null }],
        expertPages: [],
    });
    await open(page);
    await page.locator('.discussion-author-link').first().click();
    await expect(page.locator('#pubprofile-name')).toHaveText('mango_kun');
    await expect(page.locator('#pubprofile-expertise')).toHaveClass(/hidden/);
});
