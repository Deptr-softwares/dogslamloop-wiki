// v0.17 fix: creating a character page asked for a category, and any answer
// broke the site.
//
// Owner, 2026-09-03: "Adding a character page require me to pick a category,
// but if I do, it will break the formatting."
//
// WHY IT BROKE, in both directions at once. navigation.json is keyed by
// category, and 'Characters' is load-bearing in three separate places:
//
//   * buildCharacterRoster reads navData["Characters"] literally, so a
//     character filed elsewhere never appears in the roster;
//   * buildSystemsDirectory renders every key EXCEPT that one, so the same
//     character DOES appear in Guides & Such as its own stray category;
//   * the sidebar colours entries only under it.
//
// So the field offered a choice that had exactly one correct answer. It is
// pinned now, in the form and again at submit.
const { test, expect } = require('@playwright/test');

async function openOwner(page) {
    await page.addInitScript(() => {
        Object.defineProperty(window, 'supabase', {
            configurable: true,
            get() { return window.__lib; },
            set(lib) {
                window.__lib = lib;
                if (!lib || !lib.createClient || lib.__patched) return;
                lib.__patched = true;
                const orig = lib.createClient.bind(lib);
                lib.createClient = (...a) => {
                    const c = orig(...a);
                    c.auth.getSession = async () => ({
                        data: { session: { user: { id: 'u-owner', email: 'owner@example.com' }, access_token: 't' } },
                    });
                    const of = c.from.bind(c);
                    c.from = (t) => {
                        if (t === 'user_roles') {
                            return { select() { return this; }, eq: async () => ({ data: [{ role: 'owner' }], error: null }) };
                        }
                        if (t === 'site_pages') {
                            const chain = {
                                select() { return chain; }, order() { return chain; },
                                insert: (rows) => { window.__inserts = rows; return Promise.resolve({ data: rows, error: null }); },
                                then(r) { return Promise.resolve({ data: [], error: null }).then(r); },
                            };
                            return chain;
                        }
                        return of(t);
                    };
                    c.rpc = async () => ({ data: null, error: null });
                    return c;
                };
            },
        });
    });
    await page.goto('/owner.html', { waitUntil: 'networkidle' });
    // owner.html shows one group at a time and opens on People, so the page
    // form is in the DOM but hidden. Switch the way the owner would - a test
    // that reaches a hidden control proves less than one that opens it first.
    await page.click('.owner-nav-btn[data-group="pages"]');
    await page.waitForSelector('#new-page-category', { state: 'visible' });
}

test('the form opens on Character page with the category already decided', async ({ page }) => {
    // 'Character page' is the first <option>, so this is the state the owner
    // actually lands in - which is why the pinning runs at boot as well as on
    // change.
    await openOwner(page);

    await expect(page.locator('#new-page-type')).toHaveValue('character');
    await expect(page.locator('#new-page-category')).toHaveValue('Characters');
    await expect(page.locator('#new-page-category')).toHaveAttribute('readonly', '');
    await expect(page.locator('#new-page-category-note')).toContainText('always go in Characters');
});

test('switching to a system page hands the field back', async ({ page }) => {
    // The pin must not be one-way: leaving 'Characters' behind on a system page
    // would file a guide under the roster, which is the same bug mirrored.
    await openOwner(page);
    await page.selectOption('#new-page-type', 'system');

    const field = page.locator('#new-page-category');
    await expect(field).not.toHaveAttribute('readonly', '');
    await expect(field).toHaveValue('');
});

test('a category typed for a system page survives a trip through character', async ({ page }) => {
    // Picking the wrong type for a moment should not silently discard what was
    // typed - that is the kind of small loss that makes a tool feel unsafe.
    await openOwner(page);
    await page.selectOption('#new-page-type', 'system');
    await page.fill('#new-page-category', 'Guides');

    await page.selectOption('#new-page-type', 'character');
    await expect(page.locator('#new-page-category')).toHaveValue('Characters');

    await page.selectOption('#new-page-type', 'system');
    await expect(page.locator('#new-page-category'), 'restored, not lost').toHaveValue('Guides');
});

test('a character page is filed under Characters even if the field says otherwise', async ({ page }) => {
    // Belt and braces at submit. The form is a courtesy; this is the value that
    // reaches site_pages, and the roster reads it literally.
    await openOwner(page);
    await page.fill('#new-page-name', 'Test Fighter');

    const inserted = await page.evaluate(async () => {
        // Force the field past the lock, the way a devtools edit or a future
        // refactor could.
        const cat = document.getElementById('new-page-category');
        cat.readOnly = false;
        cat.value = 'Fighters';

        window.adminConfirm = async () => true;
        window.loadSitePages = async () => {};
        await createSitePage();
        return window.__inserts;
    });

    expect(inserted).toBeTruthy();
    expect(inserted[0].category, 'forced, not read from the form').toBe('Characters');
    expect(inserted[0].page_type).toBe('character');
});

test('a system page still uses what was typed', async ({ page }) => {
    // The paired positive: the forcing must apply to character pages only, or
    // every page on the site lands in the roster.
    await openOwner(page);
    await page.selectOption('#new-page-type', 'system');
    await page.fill('#new-page-name', 'Some Guide');
    await page.fill('#new-page-category', 'Guides');

    const inserted = await page.evaluate(async () => {
        window.adminConfirm = async () => true;
        window.loadSitePages = async () => {};
        await createSitePage();
        return window.__inserts;
    });

    expect(inserted[0].category).toBe('Guides');
});
