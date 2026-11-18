// The owner tools could add and delete content but never change it.
//
// From devlogs/SilentRelease1.txt: "There is no way to edit the content inside
// each existing question in the FAQ tool", "there is no way to add the
// contributor tag, social links, and icon in the collaborator/credits tool; and
// there is no way to edit existing collaborator contents", and "There is no way
// to remove a certified tier list contributor once creating them."
//
// Fixing a typo in an answer meant deleting the entry and retyping it - which
// also moved it to the bottom, because a new row gets a new sort_order.
//
// WHAT PLAYWRIGHT CANNOT REACH: whether Postgres agrees. The RLS on site_faq
// and site_collaborators already permitted UPDATE (FOR ALL, is_owner()), which
// is why those two needed no migration at all - but that is verified by probe,
// not here. These drive the client and keep the SQL text honest.
//
// The credits tool left owner tools in v1.2: the Collaborators page is edited
// in the editor, and its tests are in tests/collaborators-page.spec.js.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FAQ = [
    { id: 1, question: 'How do I read frame data?', paragraphs: ['Startup, active, recovery.', 'Then block advantage.'], sort_order: 10 },
];

const TIER_LISTS = [
    { id: 'tl-1', slug: 'mrt1', author_name: 'MrT1', email: 'mrt1@site.test', blurb: null, status: 'published', updated_at: '2026-09-01T00:00:00Z' },
    { id: 'tl-2', slug: 'old', author_name: 'Retired', email: 'gone@site.test', blurb: null, status: 'archived', updated_at: '2026-08-01T00:00:00Z' },
];

async function openOwner(page, group = 'content') {
    await page.addInitScript(({ faq, tierLists }) => {
        window.__writes = [];
        window.__rpcCalls = [];
        const rows = { site_faq: faq };

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
                            const state = { table };
                            const done = () => Promise.resolve({ data: null, error: null });
                            const chain = {
                                select() { return chain; },
                                order() { return chain; },
                                limit() { return chain; },
                                eq(col, val) { state.eq = [col, val]; return chain; },
                                maybeSingle: async () => ({ data: null, error: null }),
                                single: async () => ({ data: null, error: null }),
                                insert(payload) {
                                    window.__writes.push({ table, op: 'insert', payload });
                                    return done();
                                },
                                update(payload) {
                                    return {
                                        eq(col, val) {
                                            window.__writes.push({ table, op: 'update', payload, eq: [col, val] });
                                            return done();
                                        },
                                    };
                                },
                                delete() {
                                    return { eq(col, val) { window.__writes.push({ table, op: 'delete', eq: [col, val] }); return done(); } };
                                },
                                then(resolve) {
                                    return Promise.resolve({ data: rows[table] || [], error: null }).then(resolve);
                                },
                            };
                            return chain;
                        };
                        client.rpc = async (name, params) => {
                            window.__rpcCalls.push({ name, params });
                            if (name === 'list_tier_lists') return { data: tierLists, error: null };
                            if (name === 'list_personnel') return { data: [], error: null };
                            if (name === 'set_tier_list_status') return { data: 'ok', error: null };
                            return { data: [], error: null };
                        };
                        return client;
                    };
                    lib.__patched = true;
                }
            },
        });
    }, { faq: FAQ, tierLists: TIER_LISTS });

    await page.goto('/owner.html', { waitUntil: 'networkidle' });

    // Clicking the real nav button rather than calling showOwnerGroup(), because
    // the Tier Lists group loads its roster lazily from a click handler on that
    // button - the block editor is heavy and a panel nobody opens costs nothing.
    // Calling the switcher directly changes which panel is shown and leaves the
    // roster on "Loading...", which is a test driving something the owner never
    // touches.
    await page.click(`.owner-nav-btn[data-group="${group}"]`);
}

const writes = (page, table, op) => page.evaluate(({ table, op }) =>
    (window.__writes || []).filter(w => w.table === table && w.op === op), { table, op });

// --- FAQ ---

test('an existing FAQ answer can be opened and is prefilled', async ({ page }) => {
    await openOwner(page);
    const row = page.locator('.faq-row').first();

    await expect(row.locator('.owner-inline-editor')).toBeHidden();
    await row.locator('.faq-edit-btn').click();
    await expect(row.locator('.owner-inline-editor')).toBeVisible();

    await expect(row.locator('.faq-edit-question')).toHaveValue('How do I read frame data?');
    // Paragraphs round-trip as blank-line-separated text, which is the shape
    // they were typed in.
    await expect(row.locator('.faq-edit-answer')).toHaveValue('Startup, active, recovery.\n\nThen block advantage.');
});

test('saving an edited answer writes an UPDATE, not a delete and re-add', async ({ page }) => {
    // The old workaround moved the entry to the bottom, because a re-add gets a
    // new sort_order. An UPDATE is what keeps it where it was.
    await openOwner(page);
    const row = page.locator('.faq-row').first();
    await row.locator('.faq-edit-btn').click();
    await row.locator('.faq-edit-answer').fill('One line.\n\nTwo lines.\n\nThree.');
    await row.locator('.faq-save-btn').click();

    await expect.poll(() => writes(page, 'site_faq', 'update')).toHaveLength(1);
    const [write] = await writes(page, 'site_faq', 'update');
    expect(write.payload.paragraphs).toEqual(['One line.', 'Two lines.', 'Three.']);
    // A string, because the id round-trips through a data- attribute. PostgREST
    // coerces it for the bigint column, so this is the real value rather than a
    // bug - asserted as it actually is instead of as it reads.
    expect(write.eq).toEqual(['id', '1']);

    expect(await writes(page, 'site_faq', 'delete')).toHaveLength(0);
    expect(await writes(page, 'site_faq', 'insert')).toHaveLength(0);
});

test('an emptied answer is refused rather than written', async ({ page }) => {
    // An entry with a question and nothing under it renders as a broken FAQ.
    await openOwner(page);
    const row = page.locator('.faq-row').first();
    await row.locator('.faq-edit-btn').click();
    await row.locator('.faq-edit-answer').fill('   \n\n  ');
    await row.locator('.faq-save-btn').click();

    await expect(page.locator('#faq-results')).toContainText('cannot be empty');
    expect(await writes(page, 'site_faq', 'update')).toHaveLength(0);
});

// --- TIER LISTS ---

test('a published list offers ARCHIVE and an archived one offers RESTORE', async ({ page }) => {
    await openOwner(page, 'tierlists');
    const rows = page.locator('#tier-assign-roster .personnel-row');

    await expect(rows.nth(0).locator('.tier-status-btn')).toHaveText('ARCHIVE');
    await expect(rows.nth(1).locator('.tier-status-btn')).toHaveText('RESTORE');
});

test('archiving asks first and says nothing is deleted', async ({ page }) => {
    // It is the closest thing to removal the owner asked for, and the reason it
    // is safe is the thing the confirmation has to say.
    await openOwner(page, 'tierlists');
    await page.locator('#tier-assign-roster .personnel-row').first().locator('.tier-status-btn').click();

    const modal = page.locator('#admin-confirm-msg');
    await expect(modal).toContainText('Nothing is deleted');
    await expect(modal).toContainText('restore');
});

test('archiving sends the slug and the status, and nothing else', async ({ page }) => {
    await openOwner(page, 'tierlists');
    await page.locator('#tier-assign-roster .personnel-row').first().locator('.tier-status-btn').click();
    await page.click('#btn-admin-confirm-ok');

    await expect.poll(async () => await page.evaluate(() =>
        (window.__rpcCalls || []).filter(c => c.name === 'set_tier_list_status').map(c => c.params)
    )).toEqual([{ p_slug: 'mrt1', p_status: 'archived' }]);
});

test('cancelling the confirmation changes nothing', async ({ page }) => {
    await openOwner(page, 'tierlists');
    await page.locator('#tier-assign-roster .personnel-row').first().locator('.tier-status-btn').click();
    await page.click('#btn-admin-confirm-cancel');

    const calls = await page.evaluate(() =>
        (window.__rpcCalls || []).filter(c => c.name === 'set_tier_list_status').length);
    expect(calls).toBe(0);
});

// --- THE SQL HALF ---

const MIG = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20260904000002_tier_list_status_and_roleless_assign.sql'),
    'utf8');

test('assign_tier_list no longer claims a grant it did not make', () => {
    // The regression 20260904000001 introduced: once a roleless capability
    // holder can have a row, DO NOTHING did nothing while `granted := true`
    // reported otherwise.
    expect(MIG).not.toMatch(/ON CONFLICT \(user_id\) DO NOTHING;\s*\n\s*granted := true;/);
    expect(MIG).toMatch(/granted := FOUND;/);
});

test('the upsert cannot demote somebody who gained a role mid-flight', () => {
    // Without the guard, an unconditional DO UPDATE between the SELECT and the
    // INSERT would overwrite a real role with trusted_editor.
    expect(MIG).toMatch(/DO UPDATE\s+SET "role" = 'trusted_editor'\s+WHERE "user_roles"\."role" IS NULL/);
});

test('set_tier_list_status archives rather than deleting', () => {
    // tier_list_changes references tier_lists ON DELETE CASCADE, so a delete
    // would take every note explaining every move with it.
    expect(MIG).toContain('archived');
    expect(MIG).not.toMatch(/DELETE FROM "public"\."tier_lists"/);
    expect(MIG).toMatch(/UPDATE "public"\."tier_lists"[\s\S]*?SET "status"/);
});

test('set_tier_list_status whitelists the status and is owner-only', () => {
    const body = MIG.slice(MIG.indexOf('FUNCTION "public"."set_tier_list_status"'));
    expect(body).toContain('is_owner');
    expect(body).toContain('42501');
    expect(body).toMatch(/SET "search_path" TO 'public'/);
    // A CHECK violation reaching the owner as raw PostgREST text is not an
    // error message.
    expect(body).toMatch(/IS DISTINCT FROM 'draft'/);
    expect(body).toMatch(/IS DISTINCT FROM 'archived'/);
});

test('set_tier_list_status is revoked from PUBLIC and anon', () => {
    expect(MIG).toMatch(/REVOKE ALL ON FUNCTION "public"\."set_tier_list_status"\(text, text\) FROM PUBLIC/);
    expect(MIG).toMatch(/REVOKE ALL ON FUNCTION "public"\."set_tier_list_status"\(text, text\) FROM "anon"/);
    expect(MIG).toMatch(/GRANT EXECUTE ON FUNCTION "public"\."set_tier_list_status"\(text, text\) TO "authenticated"/);
});
