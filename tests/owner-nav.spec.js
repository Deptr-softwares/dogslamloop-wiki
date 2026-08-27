// Coverage for owner.html's tool grouping (js/owner-nav.js).
//
// owner.html grew from two tools to ten in one scroll with no navigation. The
// tools are now in four groups. The failure mode this guards is specific and
// silent: .owner-group sets display:grid, which overrides the UA stylesheet's
// [hidden] rule unless .owner-group[hidden] wins on specificity - so a
// mistake there shows every group at once and the nav appears to do nothing.
//
// Also pins that every tool is reachable. A tool left outside a group, or in
// a group with no button, becomes permanently invisible rather than
// erroring - the kind of thing a rendering test would never notice.

const { test, expect } = require('@playwright/test');

const GROUPS = ['people', 'pages', 'content', 'danger'];

// Required, not incidental. owner.html's RBAC gate calls kickUser(), which
// replaces document.body.innerHTML outright - and it does so after a ~600ms
// retry, so an unauthenticated run passes its first assertions and then has
// the markup pulled out from under it mid-test.
test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
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
                            data: { session: { user: { id: 'u-admin', email: 'a@b.c' }, access_token: 't' } },
                        });
                        const origFrom = client.from.bind(client);
                        client.from = (table) => {
                            if (table === 'user_roles') {
                                return { select() { return this; }, eq: async () => ({ data: [{ role: 'owner' }], error: null }) };
                            }
                            return origFrom(table);
                        };
                        return client;
                    };
                    lib.__patched = true;
                }
            },
        });
    });
});

test('exactly one group is visible at a time', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/owner.html', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('.owner-group:visible')).toHaveCount(1);

    for (const group of GROUPS) {
        await page.click(`.owner-nav-btn[data-group="${group}"]`);
        await expect(page.locator('.owner-group:visible')).toHaveCount(1);
        await expect(page.locator(`.owner-group[data-group="${group}"]`)).toBeVisible();
        await expect(page.locator(`.owner-nav-btn[data-group="${group}"]`)).toHaveClass(/active/);
    }
    expect(errors).toEqual([]);
});

test('every tool lives in a group that has a button', async ({ page }) => {
    await page.goto('/owner.html', { waitUntil: 'domcontentloaded' });

    const report = await page.evaluate(() => {
        const tools = [...document.querySelectorAll('section[id^="tool-"]')];
        const buttons = [...document.querySelectorAll('.owner-nav-btn')].map(b => b.dataset.group);
        return {
            total: tools.length,
            orphaned: tools.filter(t => !t.closest('.owner-group')).map(t => t.id),
            unreachable: tools
                .filter(t => {
                    const g = t.closest('.owner-group');
                    return g && !buttons.includes(g.dataset.group);
                })
                .map(t => t.id),
        };
    });

    expect(report.orphaned).toEqual([]);
    expect(report.unreachable).toEqual([]);
    expect(report.total).toBeGreaterThanOrEqual(10);
});

test('each tool becomes visible when its group is selected', async ({ page }) => {
    await page.goto('/owner.html', { waitUntil: 'domcontentloaded' });

    const pairs = await page.evaluate(() =>
        [...document.querySelectorAll('section[id^="tool-"]')]
            .map(t => ({ id: t.id, group: t.closest('.owner-group').dataset.group }))
    );

    for (const { id, group } of pairs) {
        await page.click(`.owner-nav-btn[data-group="${group}"]`);
        await expect(page.locator(`#${id}`), `${id} is not visible in group ${group}`).toBeVisible();
    }
});

test('the chosen group survives a reload', async ({ page }) => {
    await page.goto('/owner.html', { waitUntil: 'domcontentloaded' });
    await page.click('.owner-nav-btn[data-group="content"]');
    await expect(page.locator('.owner-group[data-group="content"]')).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.owner-group[data-group="content"]')).toBeVisible();
});

test('a stale stored group falls back instead of hiding everything', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('dsl_owner_group', 'a-group-that-was-renamed'));
    await page.goto('/owner.html', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('.owner-group:visible')).toHaveCount(1);
});

test('the workspace is wider than the old 640px cap', async ({ page }) => {
    // Structural, not a pixel assertion: the claim is "no longer capped
    // narrow", and exact widths differ by platform font metrics.
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/owner.html', { waitUntil: 'domcontentloaded' });

    const width = await page.locator('.owner-workspace').evaluate(el => el.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(640);
});
