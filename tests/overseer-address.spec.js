// The Overseer's address is overseer.html. Bookmarks and links that still name
// admin.html land there with their ?query and #section, without leaving the
// old address in the back button, and nothing on the site links to it.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// The Overseer is stood in for, so it does not boot or ask anyone to sign in.
// admin.html is the real file.
async function standIn(context) {
    await context.route('**/overseer.html*', route => route.fulfill({
        contentType: 'text/html', body: '<!DOCTYPE html><title>arrived</title><p>arrived</p>',
    }));
}

test('the old address lands on overseer.html with its query and section', async ({ page }) => {
    await standIn(page.context());
    await page.route('**/before.html', route => route.fulfill({ contentType: 'text/html', body: '<!DOCTYPE html><title>before</title>' }));
    await page.goto('/before.html');
    await page.goto('/admin.html?tab=media#queue');
    await expect(page).toHaveURL(/\/overseer\.html\?tab=media#queue$/);
    await expect(page).toHaveTitle('arrived');

    await page.goBack();
    await expect(page, 'Back goes to where the reader was, not to the forward again').toHaveURL(/\/before\.html$/);
});

test('without JavaScript the old address still forwards', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
        await standIn(context);
        const page = await context.newPage();
        await page.goto('/admin.html');
        await expect(page).toHaveURL(/\/overseer\.html$/);
    } finally {
        await context.close();
    }
});

test('no page or script links to the old address', () => {
    const files = execSync('git ls-files "*.html" "js/**"', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n')
        .filter(file => file !== 'admin.html' && /\.(html|js)$/.test(file) && !file.startsWith('js/vendor/'));
    expect(files).toContain('js/pages/core/page_shell.js');
    const naming = files.filter(file => /(?<![\w-])admin\.html/.test(fs.readFileSync(path.join(ROOT, file), 'utf8')));
    expect(naming).toEqual([]);
});
