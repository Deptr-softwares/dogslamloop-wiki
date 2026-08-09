// Protects the v0.11 fold-in fix to pagebuilder.js's two entry-point
// generators.
//
// buildSystemsDirectory built owner-supplied values straight into an inline
// onclick, and interpolated category names, page names, URLs and image paths
// into innerHTML unescaped. That was survivable while navigation.json was
// hand-edited. It stopped being survivable in v0.10, when site_pages became
// admin-editable through owner.html: a page named with an apostrophe breaks
// the handler outright, and CLAUDE.md rules out user-influenced values in an
// inline onclick precisely because the next step past "breaks" is "executes".
//
// The escaping is only half the fix. Replacing onclick with a delegated
// listener changes how navigation happens, so these tests click a real button
// and assert it actually navigates - a rendering assertion would have passed
// against a directory whose buttons all did nothing.

const { test, expect } = require('@playwright/test');

test('systems directory: no button carries an inline onclick', async ({ page }) => {
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    const buttons = page.locator('.system-directory-btn');
    await expect(buttons.first()).toBeVisible();
    expect(await buttons.count()).toBeGreaterThan(5);

    const withOnclick = await buttons.evaluateAll(
        els => els.filter(el => el.hasAttribute('onclick')).length
    );
    expect(withOnclick).toBe(0);

    // The replacement has to actually be wired, not merely absent.
    const withHref = await buttons.evaluateAll(
        els => els.filter(el => el.dataset.href).length
    );
    expect(withHref).toBe(await buttons.count());
});

test('systems directory: clicking a button still navigates', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    const target = page.locator('.system-directory-btn').first();
    const expected = await target.getAttribute('data-href');
    expect(expected).toBeTruthy();

    await target.click();
    await page.waitForURL(url => url.pathname.includes(expected.replace(/^\.\//, '').replace(/^\.\.\//, '')), { timeout: 5000 });

    expect(errors).toEqual([]);
    expect(page.url()).toContain('index.html');
});

test('roster cards escape their name, url and image', async ({ page }) => {
    // A hostile row is injected into navigation.json's response rather than
    // the database, so this exercises the render path without needing an
    // admin session or a write.
    await page.route('**/data/navigation.json*', async route => {
        const response = await route.fetch();
        const nav = await response.json();
        nav.Characters = [{
            id: 'Pwn',
            name: 'Pwn"><img src=x onerror=window.__xss=1>',
            url: 'characters/Pwn/index.html',
            cms_config: { pageType: 'character', pageId: 'pwn', editRole: 'open' },
        }];
        await route.fulfill({ json: nav });
    });

    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('/characters/index.html', { waitUntil: 'networkidle' });
    await expect(page.locator('.roster-card').first()).toBeVisible();

    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    // The name must still be shown, as text - escaping it away entirely would
    // "pass" this test while breaking the roster.
    await expect(page.locator('.roster-card-text').first()).toContainText('Pwn');
    expect(errors).toEqual([]);
});

test('systems directory escapes a hostile category name', async ({ page }) => {
    await page.route('**/data/navigation.json*', async route => {
        const response = await route.fetch();
        const nav = await response.json();
        nav['Evil"><img src=x onerror=window.__xss=1>'] = [{
            id: 'x', name: 'X', url: 'systems/x/index.html',
            cms_config: { pageType: 'system', pageId: 'x', editRole: 'open' },
        }];
        await route.fulfill({ json: nav });
    });

    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });
    await expect(page.locator('.system-directory-btn').first()).toBeVisible();

    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});
