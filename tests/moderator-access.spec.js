// Moderator access to the Overseer panel (owner's call, 2026-08-13).
//
// "It is fine to let the moderator into the overseer panel to moderate - it is
// THE staff page. But they can't see the submission queue and media queue,
// cause it is not their job. People with the moderate perk can see the button
// to navigate to the admin panel, there is no need to create a new moderator
// role."
//
// So: a capability, not a role. user_roles has UNIQUE(user_id) precisely
// because a second row broke get_my_role() for that user everywhere.
//
// The most important test in this file is the last one. js/pagebuilder.js
// carries a comment about the time these two gates drifted apart and produced
// an OVERSEER button that dead-ended at ACCESS DENIED; they are asserted here
// against the same inputs so the next drift fails a test instead of a person.
const { test, expect } = require('@playwright/test');

// Chainable and directly awaitable, matching real supabase-js: admin-core.js
// awaits .eq(...) while pagebuilder.js chains .single() onto it.
async function mockRole(page, roleRow) {
    await page.addInitScript((roleRow) => {
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
                    client.auth.getSession = async () => ({
                        data: { session: { user: { id: 'u1', email: 'mod@site.test' }, access_token: 't' } },
                    });
                    const origFrom = client.from.bind(client);
                    client.from = (table) => {
                        if (table === 'user_roles') {
                            const chain = {
                                select() { return chain; },
                                eq() { return chain; },
                                single: () => Promise.resolve({ data: roleRow, error: null }),
                                then(resolve) { return Promise.resolve({ data: roleRow ? [roleRow] : [], error: null }).then(resolve); },
                            };
                            return chain;
                        }
                        if (table === 'user_notifications') {
                            const chain = {
                                select() { return chain; }, eq() { return chain; },
                                then(resolve) { return Promise.resolve({ data: [], count: 0, error: null }).then(resolve); },
                            };
                            return chain;
                        }
                        return origFrom(table);
                    };
                    client.rpc = async (name) => {
                        window.__rpcCalls = window.__rpcCalls || [];
                        window.__rpcCalls.push(name);
                        if (name === 'list_content_reports') return { data: [], error: null };
                        return { data: null, error: null };
                    };
                    return client;
                };
            },
        });
    }, roleRow);
}

const MODERATOR = { role: 'trusted_editor', can_moderate: true };
const REVIEWER = { role: 'reviewer', can_moderate: false };
const ADMIN = { role: 'admin', can_moderate: false };
const NOBODY = { role: 'trusted_editor', can_moderate: false };

async function openAdmin(page, roleRow) {
    await mockRole(page, roleRow);
    await page.goto('/admin.html', { waitUntil: 'domcontentloaded' });
}

const denied = (page) => page.locator('.access-denied-screen');

test('a moderator gets into the Overseer', async ({ page }) => {
    await openAdmin(page, MODERATOR);
    await expect(page.locator('#report-queue-container')).toBeVisible();
    await expect(denied(page)).toHaveCount(0);
});

test('a moderator does not see the revision queue or the media queue', async ({ page }) => {
    // Not their job. This is presentation rather than security - both tables
    // have their own RLS and a moderator-only account cannot read them
    // whatever the page does - so the claim being made is "not shown a job
    // that is not theirs", not "prevented from doing it".
    await openAdmin(page, MODERATOR);
    await expect(page.locator('#report-queue-container')).toBeVisible();

    await expect(page.locator('#queue-container')).toBeHidden();
    await expect(page.locator('#media-queue-container')).toBeHidden();

    // The headings go with them, or the page reads as three queues where two
    // are permanently empty.
    await expect(page.getByRole('heading', { name: 'Pending Queue' })).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Media Queue' })).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
});

test('a moderator lands on their reports without pressing Load', async ({ page }) => {
    // For a moderator this queue is the entire page. Making them press Load
    // first is asking them to open the thing they came for.
    await openAdmin(page, MODERATOR);

    await expect.poll(async () =>
        await page.evaluate(() => (window.__rpcCalls || []).includes('list_content_reports'))
    ).toBe(true);
});

test('the panel says what it is, rather than waiting for a revision that never comes', async ({ page }) => {
    await openAdmin(page, MODERATOR);
    await expect(page.locator('#preview-status-text')).toContainText('Moderation view');
    await expect(page.locator('#preview-status-text')).not.toContainText('Select a revision');
});

test('the queues are hidden, not removed, so nothing else null-dereferences', async ({ page }) => {
    // Five files call getElementById on these containers without guarding.
    // Deleting them would turn every one of those into a crash for exactly
    // one class of user - the one nobody tests by hand.
    await openAdmin(page, MODERATOR);

    const present = await page.evaluate(() => ({
        queue: !!document.getElementById('queue-container'),
        media: !!document.getElementById('media-queue-container'),
        preview: !!document.getElementById('preview-content-area'),
    }));

    expect(present).toEqual({ queue: true, media: true, preview: true });
});

for (const [name, row] of [['reviewer', REVIEWER], ['admin', ADMIN]]) {
    test(`a ${name} still sees every queue`, async ({ page }) => {
        await openAdmin(page, row);

        await expect(page.locator('#queue-container')).toBeVisible();
        await expect(page.locator('#media-queue-container')).toBeVisible();
        await expect(page.locator('#report-queue-container')).toBeVisible();
        await expect(page.locator('body')).not.toHaveClass(/admin-moderator-only/);
    });
}

test('a role with neither review rights nor the capability is still denied', async ({ page }) => {
    await openAdmin(page, NOBODY);
    await expect(denied(page)).toBeVisible();
});

test('the OVERSEER button and the gate agree about who may enter', async ({ page }) => {
    // The drift this project has already paid for once: pagebuilder.js listed
    // roles admin.html did not accept, so those users got a working-looking
    // button that dead-ended at ACCESS DENIED.
    //
    // Driven through both real code paths against the same four inputs rather
    // than asserted separately, because separate assertions are exactly what
    // let them drift last time.
    const cases = [
        { label: 'moderator', row: MODERATOR, expected: true },
        { label: 'reviewer', row: REVIEWER, expected: true },
        { label: 'admin', row: ADMIN, expected: true },
        { label: 'no capability', row: NOBODY, expected: false },
    ];

    for (const { label, row, expected } of cases) {
        // The dock, on an ordinary page.
        await mockRole(page, row);
        await page.goto('/characters/Boomcat/index.html', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !!document.getElementById('sidebar-dynamic-dock'));
        // initAuthDock is async and fired without awaiting by the boot.
        await expect.poll(async () =>
            await page.evaluate(() => !!document.getElementById('dock-btn-edit')),
            { message: `${label}: OVERSEER button visibility` }
        ).toBe(expected);

        // ...and the gate itself.
        await page.goto('/admin.html', { waitUntil: 'domcontentloaded' });
        await expect.poll(async () =>
            await page.evaluate(() => !document.querySelector('.access-denied-screen')),
            { message: `${label}: admin.html admits them` }
        ).toBe(expected);
    }
});
