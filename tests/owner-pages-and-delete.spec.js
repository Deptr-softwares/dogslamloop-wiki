// Two owner reports.
//
// "In Pages tool, the pages are placed on a column. They mirror the data
// structure well, but they aren't seperated well and create a long column, so
// scrolling through them take quite a time." Fifty-two rows ordered by category
// with nothing marking where one category ended.
//
// And deletion, asked for after archiving shipped: "The Archive is a good idea,
// but I do still want deletion, so make it a seperate feature." Archiving stays
// the reversible default; deleting is a second, deliberately harder action that
// is only offered on an already-archived row.
//
// WHAT PLAYWRIGHT CANNOT REACH: whether Postgres agrees. delete_tier_list's
// archive-first rule is enforced in the function as well as in the UI, and only
// a probe can show that - a button that is not on screen has never been a
// permission check. The SQL tests here keep the text honest.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const PAGES = [
    { page_id: 'vessel', name: 'Vessel', url: 'characters/Vessel/index.html', category: 'Characters', page_type: 'character', status: 'live', sort_order: 10 },
    { page_id: 'boomcat', name: 'Boomcat', url: 'characters/Boomcat/index.html', category: 'Characters', page_type: 'character', status: 'live', sort_order: 20 },
    { page_id: 'star_rage', name: 'Star Rage', url: 'characters/Star_rage/index.html', category: 'Characters', page_type: 'character', status: 'archived', sort_order: 30 },
    { page_id: 'framedata', name: 'Frame Data', url: 'systems/framedata/index.html', category: 'Systems', page_type: 'system', status: 'live', sort_order: 10 },
    { page_id: 'hud', name: 'HUD', url: 'systems/hud/index.html', category: 'Systems', page_type: 'system', status: 'live', sort_order: 20 },
    { page_id: 'emotes', name: 'Emotes', url: 'others/emotes/index.html', category: 'Others', page_type: 'system', status: 'live', sort_order: 10 },
];

const TIER_LISTS = [
    { id: 'tl-1', slug: 'mrt1', author_name: 'MrT1', email: 'mrt1@site.test', blurb: null, status: 'published', updated_at: '2026-09-01T00:00:00Z' },
    { id: 'tl-2', slug: 'old', author_name: 'Retired', email: 'gone@site.test', blurb: null, status: 'archived', updated_at: '2026-08-01T00:00:00Z' },
];

async function openOwner(page, group) {
    await page.addInitScript(({ pages, tierLists }) => {
        window.__rpcCalls = [];
        const rows = { site_pages: pages };

        Object.defineProperty(window, 'supabase', {
            configurable: true,
            get() { return window.__lib; },
            set(lib) {
                window.__lib = lib;
                if (lib && lib.createClient && !lib.__patched) {
                    const orig = lib.createClient.bind(lib);
                    lib.createClient = (...args) => {
                        const client = orig(...args);
                        client.auth.getSession = async () => ({
                            data: { session: { user: { id: 'u-owner', email: 'owner@site.test' }, access_token: 't' } },
                        });
                        client.from = (table) => {
                            if (table === 'user_roles') {
                                return { select() { return this; }, eq: async () => ({ data: [{ role: 'owner' }], error: null }) };
                            }
                            const chain = {
                                select() { return chain; },
                                order() { return chain; },
                                limit() { return chain; },
                                eq() { return chain; },
                                maybeSingle: async () => ({ data: null, error: null }),
                                single: async () => ({ data: null, error: null }),
                                insert: async () => ({ data: null, error: null }),
                                update() { return { eq: async () => ({ data: null, error: null }) }; },
                                delete() { return { eq: async () => ({ data: null, error: null }) }; },
                                then(resolve) {
                                    return Promise.resolve({ data: rows[table] || [], error: null }).then(resolve);
                                },
                            };
                            return chain;
                        };
                        client.rpc = async (name, params) => {
                            window.__rpcCalls.push({ name, params });
                            if (name === 'list_tier_lists') return { data: tierLists, error: null };
                            // A LIST by default, not a string. Every list_* RPC
                            // this page fires at boot maps over what comes back,
                            // and a default of 'ok' made three unrelated tools
                            // throw - which showed up as pageerrors in the click
                            // test below and looked like the click's fault.
                            if (name.startsWith('list_') || name.startsWith('get_')) return { data: [], error: null };
                            return { data: 'ok', error: null };
                        };
                        return client;
                    };
                    lib.__patched = true;
                }
            },
        });
    }, { pages: PAGES, tierLists: TIER_LISTS });

    await page.goto('/owner.html', { waitUntil: 'networkidle' });
    await page.click(`.owner-nav-btn[data-group="${group}"]`);
}

// --- THE PAGE REGISTRY, GROUPED ---

test('pages are grouped by category rather than listed flat', async ({ page }) => {
    await openOwner(page, 'pages');
    const groups = page.locator('#pages-list .page-group');

    await expect(groups).toHaveCount(3);
    await expect(groups.locator('.page-group-name')).toHaveText(['Characters', 'Systems', 'Others']);
});

test('the tool opens short - every group collapsed, with a count', async ({ page }) => {
    // The complaint was scrolling. Collapsed, the whole registry is three lines.
    await openOwner(page, 'pages');

    const open = await page.locator('#pages-list .page-group[open]').count();
    expect(open, 'nothing should be expanded on open').toBe(0);

    await expect(page.locator('.page-group[data-category="Characters"] .page-group-count')).toHaveText('3');
    await expect(page.locator('.page-group[data-category="Systems"] .page-group-count')).toHaveText('2');
});

test('a collapsed group really hides its rows from the reader', async ({ page }) => {
    // <details> without [open] does not render its children, but assert what the
    // reader sees rather than trusting the element - that is the whole claim.
    await openOwner(page, 'pages');
    await expect(page.locator('.page-group[data-category="Characters"] .page-row').first()).toBeHidden();
});

test('opening a group shows its pages and no others', async ({ page }) => {
    await openOwner(page, 'pages');
    await page.locator('.page-group[data-category="Systems"] .page-group-summary').click();

    await expect(page.locator('.page-group[data-category="Systems"] .page-row').first()).toBeVisible();
    await expect(page.locator('.page-group[data-category="Characters"] .page-row').first()).toBeHidden();
});

test('filtering finds a page and opens the group holding it', async ({ page }) => {
    // A filter that leaves everything collapsed has told you a page exists and
    // hidden it in the same breath.
    await openOwner(page, 'pages');
    await page.fill('#pages-filter', 'boomcat');

    const characters = page.locator('.page-group[data-category="Characters"]');
    await expect(characters).toHaveAttribute('open', '');
    await expect(characters.locator('.page-row', { hasText: 'Boomcat' })).toBeVisible();
    await expect(characters.locator('.page-row', { hasText: 'Vessel' })).toBeHidden();
});

test('groups with no match disappear rather than becoming empty headers', async ({ page }) => {
    await openOwner(page, 'pages');
    await page.fill('#pages-filter', 'boomcat');

    await expect(page.locator('.page-group[data-category="Systems"]')).toBeHidden();
    await expect(page.locator('.page-group[data-category="Others"]')).toBeHidden();
});

test('the filter searches the path and the category, not only the name', async ({ page }) => {
    await openOwner(page, 'pages');

    await page.fill('#pages-filter', 'others/');
    await expect(page.locator('.page-group[data-category="Others"] .page-row')).toBeVisible();
    await expect(page.locator('.page-group[data-category="Characters"]')).toBeHidden();

    await page.fill('#pages-filter', 'systems');
    await expect(page.locator('.page-group[data-category="Systems"]')).toBeVisible();
});

test('clearing the filter returns the tool to its short shape', async ({ page }) => {
    await openOwner(page, 'pages');
    await page.fill('#pages-filter', 'boomcat');
    await expect(page.locator('.page-group[data-category="Characters"]')).toHaveAttribute('open', '');

    await page.fill('#pages-filter', '');
    expect(await page.locator('#pages-list .page-group[open]').count()).toBe(0);
    await expect(page.locator('.page-group[data-category="Systems"]')).toBeVisible();
});

test('the controls still work inside a group', async ({ page }) => {
    // Grouping is presentation. A row that renders and cannot be acted on would
    // be a worse tool than the long column it replaced, and toBeVisible() is
    // not "the user can click it" - so click it.
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await openOwner(page, 'pages');
    await page.locator('.page-group[data-category="Systems"] .page-group-summary').click();
    await page.locator('.page-group[data-category="Systems"] .page-archive-btn').first().click();

    // setPageStatus confirms first - reaching the dialog proves the click landed
    // on the button rather than on the summary or a covering element.
    await expect(page.locator('#admin-confirm-msg')).toBeVisible();
    expect(errors).toEqual([]);
});

// --- DELETING A TIER LIST ---

test('DELETE is offered only on an archived list', async ({ page }) => {
    // Archive first, so removing a live list is two deliberate steps rather
    // than one misclick next to RESTORE.
    await openOwner(page, 'tierlists');
    const rows = page.locator('#tier-assign-roster .personnel-row');

    await expect(rows.nth(0).locator('.tier-delete-btn')).toHaveCount(0);
    await expect(rows.nth(0).locator('.tier-status-btn')).toHaveText('ARCHIVE');

    await expect(rows.nth(1).locator('.tier-delete-btn')).toHaveText('DELETE');
    await expect(rows.nth(1).locator('.tier-status-btn')).toHaveText('RESTORE');
});

test('the confirmation names the cost instead of asking "are you sure"', async ({ page }) => {
    // The change history cascades, and that is the part somebody would not
    // think of on their own.
    await openOwner(page, 'tierlists');
    await page.locator('#tier-assign-roster .personnel-row').nth(1).locator('.tier-delete-btn').click();

    const msg = page.locator('#admin-confirm-msg');
    await expect(msg).toContainText('change note');
    await expect(msg).toContainText('cannot be undone');
});

test('confirming sends the slug to delete_tier_list', async ({ page }) => {
    await openOwner(page, 'tierlists');
    await page.locator('#tier-assign-roster .personnel-row').nth(1).locator('.tier-delete-btn').click();
    await page.click('#btn-admin-confirm-ok');

    await expect.poll(async () => await page.evaluate(() =>
        (window.__rpcCalls || []).filter(c => c.name === 'delete_tier_list').map(c => c.params)
    )).toEqual([{ p_slug: 'old' }]);
});

test('cancelling deletes nothing', async ({ page }) => {
    await openOwner(page, 'tierlists');
    await page.locator('#tier-assign-roster .personnel-row').nth(1).locator('.tier-delete-btn').click();
    await page.click('#btn-admin-confirm-cancel');

    const calls = await page.evaluate(() =>
        (window.__rpcCalls || []).filter(c => c.name === 'delete_tier_list').length);
    expect(calls).toBe(0);
});

// --- THE SQL HALF ---

const MIG = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20260904000003_delete_tier_list.sql'), 'utf8');

test('archive-first is enforced in the function, not only in the UI', () => {
    // The REST endpoint is reachable directly by anybody holding a token.
    expect(MIG).toMatch(/IS DISTINCT FROM 'archived'/);
    expect(MIG).toMatch(/USING ERRCODE = '22023'/);
});

test('it counts the change notes before destroying them', () => {
    // After the delete there is nothing left to count, so the order is the
    // whole point - and the owner is told what it cost.
    const countAt = MIG.search(/SELECT count\(\*\) INTO lost_changes/);
    const deleteAt = MIG.search(/DELETE FROM "public"\."tier_lists"/);
    expect(countAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(countAt);
});

test('delete_tier_list is owner-only and unreachable by anon', () => {
    expect(MIG).toContain('is_owner');
    expect(MIG).toContain('42501');
    expect(MIG).toMatch(/SET "search_path" TO 'public'/);
    expect(MIG).toMatch(/REVOKE ALL ON FUNCTION "public"\."delete_tier_list"\(text\) FROM PUBLIC/);
    expect(MIG).toMatch(/REVOKE ALL ON FUNCTION "public"\."delete_tier_list"\(text\) FROM "anon"/);
    expect(MIG).toMatch(/GRANT EXECUTE ON FUNCTION "public"\."delete_tier_list"\(text\) TO "authenticated"/);
});

test('deleting does not quietly demote the author', () => {
    // Same rule as set_tier_list_status: roles are managed in the roster, and a
    // demotion as a side effect of deleting a page is a surprise.
    expect(MIG).not.toMatch(/UPDATE[\s\S]{0,80}user_roles/);
    expect(MIG).not.toMatch(/DELETE FROM "public"\."user_roles"/);
});
