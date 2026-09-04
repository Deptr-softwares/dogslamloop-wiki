// The owner tools could not see anybody who did not already hold a role.
//
// list_personnel() is FROM user_roles JOIN auth.users - an inner join from the
// ROLE table - so a signed-in account with no role never appeared at all. One
// fact behind three of the owner's reports (devlogs/SilentRelease1.txt): no way
// to grant a perk to a regular user, no way to find somebody by email, and
// set_user_capability refusing outright.
//
// Owner's call, 2026-09-04: capabilities stand alone, the way a page expert
// already needs no role.
//
// WHAT PLAYWRIGHT CANNOT REACH: whether Postgres agrees. Every auth spec here
// mocks Supabase - the RPC guard, the LEFT JOIN and the nullable column are
// verified by the preview branch and the production probe. The SQL tests at the
// bottom keep the text honest; the rest drive the real client code.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// A roleless moderator: the state that could not exist before this change.
const ROSTER = [
    { user_id: 'u-owner', email: 'owner@site.test', role: 'owner', joined_at: '2026-01-01T00:00:00Z', bypass_cooldown: false, can_moderate: false, can_delete_media: false },
    { user_id: 'u-rev', email: 'reviewer@site.test', role: 'reviewer', joined_at: '2026-02-01T00:00:00Z', bypass_cooldown: false, can_moderate: false, can_delete_media: false },
    { user_id: 'u-mod', email: 'mod@site.test', role: null, joined_at: '2026-03-01T00:00:00Z', bypass_cooldown: false, can_moderate: true, can_delete_media: false },
];

const FOUND = [
    { user_id: 'u-new', email: 'xq7burner@mail.test', display_name: 'VesselGod', role: null, joined_at: '2026-08-01T00:00:00Z', bypass_cooldown: false, can_moderate: false, can_delete_media: false },
];

async function openOwner(page, { found = FOUND } = {}) {
    await page.addInitScript(({ roster, found }) => {
        window.__rpcCalls = [];
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
                            const chain = new Proxy({}, {
                                get(_t, prop) {
                                    if (prop === 'then') return (resolve) => resolve({ data: [], error: null });
                                    if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null });
                                    return () => chain;
                                },
                            });
                            return chain;
                        };
                        client.rpc = async (name, params) => {
                            window.__rpcCalls.push({ name, params });
                            if (name === 'list_personnel') return { data: roster, error: null };
                            if (name === 'search_users') return { data: found, error: null };
                            if (name === 'set_user_capability') return { data: 'ok', error: null };
                            return { data: [], error: null };
                        };
                        return client;
                    };
                    lib.__patched = true;
                }
            },
        });
    }, { roster: ROSTER, found });

    await page.goto('/owner.html', { waitUntil: 'networkidle' });
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('people'));
    await expect(page.locator('#personnel-roster .personnel-row').first()).toBeVisible();
}

const rowFor = (page, email) =>
    page.locator('.personnel-row').filter({ has: page.locator(`[data-email="${email}"]`) });

// --- A ROLE IS NOW OPTIONAL ---

test('a roleless capability holder appears on the roster at all', async ({ page }) => {
    await openOwner(page);
    await expect(rowFor(page, 'mod@site.test')).toBeVisible();
});

test('a roleless row says "No role" rather than rendering an empty badge', async ({ page }) => {
    await openOwner(page);
    const badge = rowFor(page, 'mod@site.test').locator('.update-badge');
    await expect(badge).toHaveText('No role');
    // The class fell out as `badge-role-` before, which styles nothing.
    await expect(badge).toHaveClass(/badge-role-none/);
});

test('a roleless dropdown does NOT default to the first role in the list', async ({ page }) => {
    // The dangerous one. The select is read by the APPLY button next to it, so
    // a roleless row falling through to its first option - Administrator -
    // means pressing APPLY promotes somebody the owner only meant to look at.
    await openOwner(page);
    const select = rowFor(page, 'mod@site.test').locator('.personnel-role-select');
    await expect(select).toHaveValue('');
    await expect(select.locator('option:checked')).toHaveText('No role');
});

test('a role holder still opens on the role they actually hold', async ({ page }) => {
    await openOwner(page);
    const select = rowFor(page, 'reviewer@site.test').locator('.personnel-role-select');
    await expect(select).toHaveValue('reviewer');
});

test('a role missing from the label table is still shown, not silently swapped', async ({ page }) => {
    // 'owner' has never been in ROLE_LABELS, so that row used to fall through
    // to Administrator exactly like a roleless one - visible only when the
    // last-owner guard did not happen to disable the select.
    await openOwner(page);
    const select = rowFor(page, 'owner@site.test').locator('.personnel-role-select');
    await expect(select).toHaveValue('owner');
});

test('revoke is offered to somebody with something to lose, and not otherwise', async ({ page }) => {
    await openOwner(page);
    const roleless = rowFor(page, 'mod@site.test').locator('.personnel-role-select option');
    await expect(roleless.filter({ hasText: 'Revoke all access' })).toHaveCount(0);

    const holder = rowFor(page, 'reviewer@site.test').locator('.personnel-role-select option');
    await expect(holder.filter({ hasText: 'Revoke all access' })).toHaveCount(1);
});

// --- BUG 2: THE INERT BOX NOW SAYS WHY ---

test('a capability that comes with the role says so in text, not only a tooltip', async ({ page }) => {
    // Owner-reported: "The button to grant 'moderate discussions' doesn't work
    // (clicking on it and nothing happen)." It was correct - moderation comes
    // with reviewer - but the only explanation was a title attribute, which is
    // invisible to somebody who has already clicked.
    await openOwner(page);
    const label = rowFor(page, 'reviewer@site.test')
        .locator('.personnel-capability')
        .filter({ hasText: 'Moderate discussions' });

    await expect(label.locator('.personnel-capability-box')).toBeDisabled();
    // The claim is that a READER can see the reason - so assert the rendered
    // text, not the title attribute that failed this person.
    await expect(label).toContainText('comes with the role');
});

test('a capability that does not come with the role stays live and unexplained', async ({ page }) => {
    // The other direction: the note must not appear where it would be a lie.
    await openOwner(page);
    const label = rowFor(page, 'mod@site.test')
        .locator('.personnel-capability')
        .filter({ hasText: 'Moderate discussions' });

    await expect(label.locator('.personnel-capability-box')).toBeEnabled();
    await expect(label).not.toContainText('comes with the role');
});

// --- FINDING SOMEBODY WHO IS NOT ON THE ROSTER ---

test('searching reaches the database with what was typed', async ({ page }) => {
    await openOwner(page);
    await page.fill('#account-search', 'VesselGod');
    await page.click('button:has-text("SEARCH")');

    await expect.poll(async () => await page.evaluate(() =>
        (window.__rpcCalls || []).filter(c => c.name === 'search_users').map(c => c.params.search_query)
    )).toEqual(['VesselGod']);
});

test('a burner account with no role is found and rendered with full controls', async ({ page }) => {
    // The owner's actual scenario: they know the display name and not the
    // address. The row has to carry the same controls as the roster, or
    // finding somebody would not let you do anything about them.
    await openOwner(page);
    await page.fill('#account-search', 'VesselGod');
    await page.click('button:has-text("SEARCH")');

    const found = page.locator('#account-search-results .personnel-row');
    await expect(found).toHaveCount(1);
    await expect(found).toContainText('VesselGod');
    await expect(found).toContainText('xq7burner@mail.test');
    await expect(found.locator('.personnel-role-select')).toHaveValue('');
    await expect(found.locator('.personnel-capability-box[data-capability="can_moderate"]')).toBeEnabled();
});

test('a one-character query never reaches the database', async ({ page }) => {
    // Matches the function's own floor. Asserting the RPC was NOT called is
    // the claim - a lookup that dumps the user table is the failure here.
    await openOwner(page);
    await page.fill('#account-search', 'V');
    await page.click('button:has-text("SEARCH")');

    await expect(page.locator('#account-search-results')).toContainText('at least two characters');
    const calls = await page.evaluate(() =>
        (window.__rpcCalls || []).filter(c => c.name === 'search_users').length);
    expect(calls).toBe(0);
});

test('Enter searches, not just the button', async ({ page }) => {
    await openOwner(page);
    await page.fill('#account-search', 'VesselGod');
    await page.press('#account-search', 'Enter');

    await expect(page.locator('#account-search-results .personnel-row')).toHaveCount(1);
});

test('no results says so instead of leaving the last search on screen', async ({ page }) => {
    await openOwner(page, { found: [] });
    await page.fill('#account-search', 'nobody');
    await page.click('button:has-text("SEARCH")');

    await expect(page.locator('#account-search-results')).toContainText('No account matches');
    await expect(page.locator('#account-search-results .personnel-row')).toHaveCount(0);
});

test('a searched-for name is escaped on its way into the row', async ({ page }) => {
    // display_name is user-controlled - the person picks it themselves in the
    // profile modal - and it reaches innerHTML. The standard here is escape at
    // every interpolation, so assert the tag SURVIVES escaped rather than
    // asserting a substring is absent.
    await openOwner(page, {
        found: [{ ...FOUND[0], display_name: '<img src=x onerror=alert(1)>' }],
    });
    await page.fill('#account-search', 'img');
    await page.click('button:has-text("SEARCH")');

    const row = page.locator('#account-search-results .personnel-row');
    await expect(row.locator('.personnel-name')).toHaveText('<img src=x onerror=alert(1)>');
    expect(await page.locator('#account-search-results img').count()).toBe(0);
});

// --- THE SQL HALF ---

const MIG = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20260904000001_roster_and_standalone_capabilities.sql'),
    'utf8');

test('role becomes nullable and user_id becomes the whole key', () => {
    expect(MIG).toMatch(/ALTER COLUMN "role" DROP NOT NULL/);
    expect(MIG).toMatch(/ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY \("user_id"\)/);
});

test('exactly one unique index on user_id is left behind', () => {
    // ON CONFLICT ("user_id") has to infer an arbiter index. The old composite
    // PK and the redundant UNIQUE are both dropped so there is one candidate
    // rather than two.
    expect(MIG).toMatch(/DROP CONSTRAINT IF EXISTS "user_roles_one_role_per_user"/);
    expect(MIG).toMatch(/DROP CONSTRAINT IF EXISTS "user_roles_pkey"/);
});

test('set_user_capability creates the row instead of refusing', () => {
    // It used to UPDATE and then RAISE 'No role assigned to %'. That message is
    // the behaviour being removed, so its absence is the claim.
    expect(MIG).not.toContain('give them a role before granting a capability');
    expect(MIG).toMatch(/INSERT INTO "public"\."user_roles"[\s\S]*?ON CONFLICT \("user_id"\) DO UPDATE/);
});

test('a row that carries nothing at all is swept away', () => {
    // No role and no capabilities is residue, and it would accumulate in the
    // roster forever.
    expect(MIG).toMatch(/DELETE FROM "public"\."user_roles" WHERE "user_id" = target_id/);
});

test('search_users is owner-guarded inside the function, not just by the grant', () => {
    const body = MIG.slice(MIG.indexOf('FUNCTION "public"."search_users"'));
    expect(body).toContain('is_owner');
    expect(body).toContain('42501');
    expect(body).toMatch(/SET "search_path" TO 'public'/);
});

test('search_users is unreachable by anon and never granted to PUBLIC', () => {
    // It returns email addresses. Creating a function grants EXECUTE to PUBLIC
    // by default, which is exactly how the 2026-08-07 escalation happened.
    expect(MIG).toMatch(/REVOKE ALL ON FUNCTION "public"\."search_users"\(text, integer\) FROM PUBLIC/);
    expect(MIG).toMatch(/REVOKE ALL ON FUNCTION "public"\."search_users"\(text, integer\) FROM "anon"/);
    expect(MIG).toMatch(/GRANT EXECUTE ON FUNCTION "public"\."search_users"\(text, integer\) TO "authenticated"/);
});

test('search_users left-joins, or it would reproduce the bug it fixes', () => {
    const body = MIG.slice(MIG.indexOf('FUNCTION "public"."search_users"'));
    expect(body).toMatch(/FROM "auth"\."users" u\s+LEFT JOIN "public"\."user_roles"/);
    // Searching the display name is the point - the owner knows the name and
    // not the burner address.
    expect(body).toContain(`raw_user_meta_data->>'display_name'`);
});

test('search_users refuses to dump the table on an empty query', () => {
    const body = MIG.slice(MIG.indexOf('FUNCTION "public"."search_users"'));
    expect(body).toMatch(/length\(needle\) < 2/);
    expect(body).toMatch(/LIMIT GREATEST/);
});
