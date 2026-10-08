// @ts-check
const { test, expect } = require('@playwright/test');

// The sign-in window names the Terms of Service and the Privacy Policy
// (v1.0 Part 3, owner, 2026-10-08).
//
// Before this, the Terms were linked from the footer alone, and courts often
// hold that terms shown only that way bind nobody: they look for a notice
// where the person signs in. Every sign-in on the site goes through this one
// modal (js/site_utils.js), whichever of the three providers or the email
// form is used, so the notice has to sit above all of them and in both tabs.
//
// The modal is built on every page from one template, at every folder depth,
// so the links are checked from a nested page as well as the root: a link
// that is right on the Main Dashboard and 404s two folders down is the
// failure a root-only test would never see.

async function openSignIn(page, path) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    // The real dock button, signed out: openAuthModal shows the sign-in window.
    await page.locator('#dock-btn-auth').click();
    await expect(page.locator('#auth-modal-overlay')).not.toHaveClass(/hidden/);
    return errors;
}

for (const path of ['/', '/systems/tierlist/index.html']) {
    test(`the sign-in window links the Terms and the Privacy Policy that exist (${path})`, async ({ page }) => {
        const errors = await openSignIn(page, path);
        const notice = page.locator('#auth-terms-notice');
        await expect(notice).toBeVisible();
        await expect(notice).toContainText('you agree to the Terms of Service and the Privacy Policy');
        await expect(notice).toContainText('13 or older');

        const hrefs = await notice.locator('a').evaluateAll(as => as.map(a => new URL(a.href).pathname));
        expect(hrefs).toEqual(['/terms.html', '/privacy-policy.html']);
        for (const href of hrefs) {
            const res = await page.request.get(href);
            expect(res.status(), href).toBe(200);
        }
        expect(errors).toEqual([]);
    });
}

test('the notice sits above every sign-in button, in both tabs', async ({ page }) => {
    await openSignIn(page, '/');
    const notice = page.locator('#auth-terms-notice');
    const noticeBottom = async () => (await notice.boundingBox()).y + (await notice.boundingBox()).height;

    const firstProvider = page.locator('#auth-modal-overlay button', { hasText: 'LOGIN WITH DISCORD' });
    expect(await noticeBottom()).toBeLessThanOrEqual((await firstProvider.boundingBox()).y);

    await page.locator('#auth-tab-register').click();
    await expect(page.locator('#btn-auth-action-register')).toBeVisible();
    await expect(notice).toBeVisible();
    expect(await noticeBottom()).toBeLessThanOrEqual((await page.locator('#btn-auth-action-register').boundingBox()).y);
});

test('opening the Terms from the sign-in window keeps the window open', async ({ page, context }) => {
    await openSignIn(page, '/');
    const [terms] = await Promise.all([
        context.waitForEvent('page'),
        page.locator('#auth-terms-notice a', { hasText: 'Terms of Service' }).click(),
    ]);
    await terms.waitForLoadState('domcontentloaded');
    await expect(terms.locator('h1')).toHaveText('Terms of Service');
    await expect(page.locator('#auth-modal-overlay')).not.toHaveClass(/hidden/);
});
