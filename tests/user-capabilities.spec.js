// Per-user capabilities (v0.13 item 9).
//
// The constraint this design exists to respect: user_roles has
// UNIQUE(user_id), added deliberately in 20260801000000 because holding two
// roles broke get_my_role() with "more than one row returned by a subquery" -
// which broke that user's access to everything, not only the thing the second
// role was for.
//
// So an extra power is a COLUMN, never a second row. These tests pin the
// client half of that: the toggle writes through an RPC, and it never
// pretends to have saved something the database refused.
//
// The server half - the rate-limit trigger honouring the flag, and the RPC
// rejecting a non-admin - is unreachable from Playwright. Every auth spec
// here mocks Supabase and never touches Postgres, so that half is verified by
// live probe after merge.
const { test, expect } = require('@playwright/test');

const ROSTER = [
    { user_id: 'u-admin', email: 'owner@site.test', role: 'admin', joined_at: '2026-01-01T00:00:00Z', bypass_cooldown: false },
    { user_id: 'u-ed', email: 'editor@site.test', role: 'trusted_editor', joined_at: '2026-02-01T00:00:00Z', bypass_cooldown: true },
];

async function openOwner(page, { rpcError = null } = {}) {
    await page.addInitScript(({ roster, rpcError }) => {
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
                            data: { session: { user: { id: 'u-admin', email: 'owner@site.test' }, access_token: 't' } },
                        });
                        client.from = (table) => {
                            if (table === 'user_roles') {
                                return { select() { return this; }, eq: async () => ({ data: [{ role: 'admin' }], error: null }) };
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
                            if (name === 'set_user_capability') {
                                return rpcError
                                    ? { data: null, error: rpcError }
                                    : { data: `${params.capability} updated for ${params.target_email}.`, error: null };
                            }
                            return { data: [], error: null };
                        };
                        return client;
                    };
                    lib.__patched = true;
                }
            },
        });
    }, { roster: ROSTER, rpcError });

    await page.goto('/owner.html', { waitUntil: 'networkidle' });
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('people'));
    await expect(page.locator('.personnel-row').first()).toBeVisible();
}

const boxFor = (page, email) => page.locator(`.personnel-capability-box[data-email="${email}"]`);

test('each person gets a capability toggle reflecting the stored flag', async ({ page }) => {
    await openOwner(page);

    await expect(page.locator('.personnel-capability-box')).toHaveCount(2);
    await expect(boxFor(page, 'owner@site.test')).not.toBeChecked();
    await expect(boxFor(page, 'editor@site.test')).toBeChecked();
});

test('a capability is granted through the RPC, not a direct table write', async ({ page }) => {
    // user_roles has no UPDATE policy for anyone but the row's owner, so a
    // direct write would fail - and giving clients one would let any user set
    // their own flags.
    await openOwner(page);

    await boxFor(page, 'owner@site.test').check();

    const call = await page.evaluate(() => window.__rpcCalls.find(c => c.name === 'set_user_capability'));
    expect(call.params).toEqual({
        target_email: 'owner@site.test',
        capability: 'bypass_cooldown',
        enabled: true,
    });
});

test('turning a capability off sends enabled:false rather than removing anything', async ({ page }) => {
    await openOwner(page);

    await boxFor(page, 'editor@site.test').uncheck();

    const call = await page.evaluate(() => window.__rpcCalls.filter(c => c.name === 'set_user_capability').pop());
    expect(call.params.enabled).toBe(false);
    expect(call.params.target_email).toBe('editor@site.test');
});

test('a refused change puts the checkbox back instead of lying', async ({ page }) => {
    // Same rule the staff perk switch follows: the control must never show a
    // state the database does not hold.
    await openOwner(page, { rpcError: { message: 'Permission denied: only an administrator may change capabilities.' } });

    // click, not check: check() asserts the new state stuck, and the whole
    // point here is that it must not.
    await boxFor(page, 'owner@site.test').click();

    await expect(boxFor(page, 'owner@site.test')).not.toBeChecked();
    await expect(page.locator('#role-results')).toContainText('Permission denied');
});

test('a missing migration says so rather than showing a raw error', async ({ page }) => {
    // The normal state between pushing branch code and merging.
    await openOwner(page, { rpcError: { code: 'PGRST202', message: 'Could not find the function' } });

    await boxFor(page, 'owner@site.test').click();

    await expect(page.locator('#role-results')).toContainText("hasn't been deployed");
    await expect(boxFor(page, 'owner@site.test')).not.toBeChecked();
});

test('the capability sits with the role, not as an alternative to it', async ({ page }) => {
    // Structural, and the point of the whole design: a role select and a
    // capability checkbox in the same row, so nobody reads the capability as
    // a second role. UNIQUE(user_id) is what makes that distinction load
    // bearing rather than cosmetic.
    await openOwner(page);

    const row = page.locator('.personnel-row').filter({ hasText: 'editor@site.test' });
    await expect(row.locator('.personnel-role-select')).toHaveCount(1);
    await expect(row.locator('.personnel-capability-box')).toHaveCount(1);
});
