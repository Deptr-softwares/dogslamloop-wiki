// The Emotes page had no edit button, so nobody could contribute to it
// (v0.14 §9). Gallery is the newest page type and the least exercised.
//
// The cause was one line in js/page_router.js: `hasToc` was false for a
// gallery, and the whole right sidebar was dropped along with the contents
// list. #btn-edit-current-tab lives in that sidebar - initTabEditorButtons
// ran, found nothing, and did nothing.
//
// The reasoning for dropping the list was right: a gallery has no headings to
// index, and its own search box is how you find something in it. The mistake
// was throwing the buttons out with it - and v0.14 removed the duplicate
// mobile pair, so that sidebar is now the only place they live.

const { test, expect } = require('@playwright/test');

const GALLERY = '/others/emotes/index.html';

test('a gallery page offers an edit button', async ({ page }) => {
    await page.goto(GALLERY, { waitUntil: 'networkidle' });

    const edit = page.locator('#btn-edit-current-tab');
    await expect(edit).toBeVisible({ timeout: 15000 });
    await expect(edit).toContainText('EDIT PAGE');
});

test('the edit button goes to the editor for that page', async ({ page }) => {
    // A visible button that leads nowhere is the same bug wearing a hat.
    await page.goto(GALLERY, { waitUntil: 'networkidle' });
    await expect(page.locator('#btn-edit-current-tab')).toBeVisible({ timeout: 15000 });

    await page.locator('#btn-edit-current-tab').click();
    await page.waitForURL(/edit\.html/, { timeout: 15000 });

    expect(page.url()).toContain('edit.html');
    expect(page.url()).toContain('emotes');
});

test('history is reachable too', async ({ page }) => {
    await page.goto(GALLERY, { waitUntil: 'networkidle' });
    await expect(page.locator('#btn-history-current-tab')).toBeVisible({ timeout: 15000 });
});

test('a gallery still gets no contents list, because it has no headings', async ({ page }) => {
    await page.goto(GALLERY, { waitUntil: 'networkidle' });

    // The original decision, kept. Restoring the sidebar must not restore a
    // table of contents over a page that has nothing to index.
    await expect(page.locator('#dynamic-toc')).toHaveCount(0);
    await expect(page.locator('.local-sidebar-right')).toHaveCount(1);
});

test('the gallery itself still works', async ({ page }) => {
    // The page renders through js/gallery.js and the sidebar change must not
    // have disturbed it.
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto(GALLERY, { waitUntil: 'networkidle' });
    await expect(page.locator('input[type="search"], .gallery-search, #gallery-search').first())
        .toBeVisible({ timeout: 15000 });

    expect(errors).toEqual([]);
});

test('a phone can reach the edit button too', async ({ page }) => {
    // The drawer is the only route on a phone since the duplicate mobile pair
    // was removed. A gallery page had no sidebar at all, so the burger was
    // hidden and there was nothing to open.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(GALLERY, { waitUntil: 'networkidle' });

    const burger = page.locator('#mobile-menu-toggle');
    await expect(burger).toBeVisible();

    await burger.click();
    await expect(page.locator('.local-sidebar-right')).toHaveClass(/mobile-open/);
    await expect(page.locator('.local-sidebar-right #btn-edit-current-tab')).toBeVisible();
});

// The real navigation, with each listed page's edit_role set for the test.
// Whether a page is editable is the owner's setting (site_pages.edit_role), and
// a test reading the live value goes red the day they change it, which stops
// the nightly regeneration (v1.1: in-page tools are locked from now on).
function withEditRole(page, roles) {
    return page.route('**/data/navigation.json*', async route => {
        const response = await route.fetch();
        const nav = await response.json();
        for (const entries of Object.values(nav)) {
            for (const entry of entries) {
                const role = roles[`/${entry.url}`];
                if (role && entry.cms_config) entry.cms_config.editRole = role;
            }
        }
        await route.fulfill({ response, json: nav });
    });
}

const PAGE_PER_TYPE = [
    '/characters/Boomcat/index.html',
    '/systems/hud/index.html',
    '/others/emotes/index.html',
    '/tools/free-submit-tier-list/index.html',
];

// The general claim, so the next page type added cannot ship without a way in.
test('every generated page type offers a way to edit it', async ({ page }) => {
    await withEditRole(page, Object.fromEntries(PAGE_PER_TYPE.map(url => [url, 'open'])));
    for (const url of PAGE_PER_TYPE) {
        await page.goto(url, { waitUntil: 'networkidle' });
        await expect(page.locator('#btn-edit-current-tab'), `${url} has no edit button`)
            .toBeVisible({ timeout: 15000 });
    }
});

// Owner, 2026-10-21: the tools whose code lives on the site are "an internal
// tool of Dogslamloop", so a locked one offers neither button.
test('a locked tool page has no Edit and no History', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await withEditRole(page, { '/tools/free-submit-tier-list/index.html': 'locked' });
    await page.goto('/tools/free-submit-tier-list/index.html', { waitUntil: 'networkidle' });

    // The menu is built from the same navigation answer, after the buttons
    // were decided, so once it is up the decision has been made.
    await expect(page.locator('#global-sidebar-nav a').first()).toBeAttached({ timeout: 15000 });
    await expect(page.locator('#btn-edit-current-tab')).toBeHidden();
    await expect(page.locator('#btn-history-current-tab')).toHaveCount(0);
    expect(errors).toEqual([]);
});
