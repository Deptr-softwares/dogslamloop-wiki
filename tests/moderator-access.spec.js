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
async function mockRole(page, roleRow, expertPages = []) {
    await page.addInitScript(({ roleRow, expertPages }) => {
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
                        // The third way into the Overseer. Both gates ask this
                        // and neither may assume an array comes back - a
                        // pre-migration database answers with an error.
                        if (name === 'get_user_expert_pages') return { data: expertPages, error: null };
                        return { data: null, error: null };
                    };
                    return client;
                };
            },
        });
    }, { roleRow, expertPages });
}

const MODERATOR = { role: 'trusted_editor', can_moderate: true };
const REVIEWER = { role: 'reviewer', can_moderate: false };
const ADMIN = { role: 'admin', can_moderate: false };
const NOBODY = { role: 'trusted_editor', can_moderate: false };

// A page expert holds no role at all - the badge comes from a page_experts
// row, not from user_roles - so the role row is what a signed-in nobody has.
const EXPERT_PAGES = [{ page_id: 'Disaster-Plants', page_name: 'Disaster Plants' }];
const EXPERT = null;

async function openAdmin(page, roleRow, expertPages = []) {
    await mockRole(page, roleRow, expertPages);
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

// --- THE PAGE EXPERT (owner-reported, 2026-09-04) ---
//
// "I made a person a Disaster Plants expert. She couldn't see the overseer
// button to go into the queue. The expert tag still appear though."
//
// v0.17 gave experts review rights in SQL - the queue policies read
// can_review_page(), which is is_staff() OR an expert row. Neither gate here
// nor in pagebuilder.js knew the word, so the badge rendered and the door was
// shut. Exactly the drift the last test in this file exists to catch, in the
// one direction it was not yet asked about.

test('a page expert gets into the Overseer', async ({ page }) => {
    await openAdmin(page, EXPERT, EXPERT_PAGES);
    await expect(denied(page)).toHaveCount(0);
});

test('a page expert sees the revision queue, and neither of the other two', async ({ page }) => {
    // The queue IS their job - it is the reason v0.17 gave them the rights.
    // The media queue and the report queue are not.
    await openAdmin(page, EXPERT, EXPERT_PAGES);

    await expect(page.locator('#queue-container')).toBeVisible();
    await expect(page.locator('#media-queue-container')).toBeHidden();
    await expect(page.locator('#report-queue-container')).toBeHidden();

    await expect(page.getByRole('heading', { name: 'Pending Queue' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Media Queue' })).toBeHidden();
});

test('a page expert keeps the preview pane, unlike a moderator', async ({ page }) => {
    // The moderator's copy says reports are handled on the left, because they
    // will never be shown a revision. An expert will be, so overwriting it
    // would be telling them the page does something it does not.
    await openAdmin(page, EXPERT, EXPERT_PAGES);
    await expect(page.locator('#preview-status-text')).not.toContainText('Moderation view');
});

test('a page expert actually loads their queue rather than only being let in', async ({ page }) => {
    // The gate admitting them and the queue loading are separate lines, and
    // the second one used to read `if (!moderatorOnly)`. An expert is not a
    // moderator, so it happened to pass - assert it rather than trust it.
    await openAdmin(page, EXPERT, EXPERT_PAGES);
    await expect.poll(async () =>
        await page.evaluate(() => window.currentUserSeesRevisions === true)
    ).toBe(true);
});

test('an expert who also moderates gets both queues, not one', async ({ page }) => {
    // The case a pair of mutually-exclusive "only" flags could not express,
    // and the reason the scope function takes three booleans instead of a
    // label. Nothing about holding the moderation capability should cost
    // somebody the revision queue their expert row earned.
    await openAdmin(page, { role: 'trusted_editor', can_moderate: true }, EXPERT_PAGES);

    await expect(page.locator('#queue-container')).toBeVisible();
    await expect(page.locator('#report-queue-container')).toBeVisible();
    await expect(page.locator('#media-queue-container')).toBeHidden();
});

test('a signed-in nobody with no expert pages is still denied', async ({ page }) => {
    // The other half of the claim above: the new door opens for an expert row
    // and not merely because the RPC was asked. An empty array is the answer
    // every ordinary reader gets.
    await openAdmin(page, EXPERT, []);
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
        // Added 2026-09-04, after the drift happened a second time in the
        // direction this test did not cover.
        { label: 'page expert', row: EXPERT, pages: EXPERT_PAGES, expected: true },
        { label: 'expert of nothing', row: EXPERT, pages: [], expected: false },
    ];

    for (const { label, row, pages = [], expected } of cases) {
        // The dock, on an ordinary page.
        await mockRole(page, row, pages);
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
