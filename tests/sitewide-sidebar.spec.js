// A right sidebar on every page that had none - v1.0 Part 2, P4 (owner,
// 2026-10-08).
//
// "For page without a right sidebar, add a right sidebar with the ko-fi button
// moved up, and a sitewide navigation just like the Main Dashboard (> Forum,
// > View History)". Before this, Ko-fi stayed buried in the left sidebar on
// these pages (#221 moved it only where a right sidebar existed), and on a
// phone their top-right menu button was hidden because there was no drawer
// for it to open.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Each page, and the Sitewide link it leaves out because it is that page.
const PAGES = [
    ['/404.html', null],
    ['/blog.html', null],
    ['/forum.html', 'forum.html'],
    ['/privacy-policy.html', null],
    ['/terms.html', null],
    ['/recent-changes.html', 'recent-changes.html'],
    ['/search.html', null],
    ['/submissions.html', null],
];
const SITEWIDE = ['forum.html', 'recent-changes.html'];

test('every hand-written page with a left sidebar has a right one', () => {
    // Derived from the files, not listed, so a ninth page cannot be missed.
    // Generated pages build both sidebars in js/page_router.js.
    const SKIP = new Set(['node_modules', '.git', 'test-results', 'playwright-report']);
    const missing = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (SKIP.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.html')) {
                const src = fs.readFileSync(full, 'utf8');
                if (src.includes('class="global-sidebar-left"') && !src.includes('class="local-sidebar-right"')) {
                    missing.push(path.relative(ROOT, full));
                }
            }
        }
    };
    walk(ROOT);
    expect(missing).toEqual([]);
});

for (const [url, self] of PAGES) {
    test(`Ko-fi tops the right sidebar, then the Sitewide links: ${url}`, async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(url, { waitUntil: 'networkidle' });

        const right = page.locator('.local-sidebar-right');
        await expect(right.locator(':scope > :first-child')).toHaveClass(/kofi-btn-wrapper/);
        const kofi = right.locator(':scope > :first-child a');
        await expect(kofi).toHaveAttribute('href', /ko-fi\.com/i);
        await expect(kofi).toBeInViewport();
        await expect(page.locator('.global-sidebar-left a[href*="Ko-fi"]')).toHaveCount(0);

        // Reachable, not just drawn: nothing sits over it.
        const onTop = await kofi.evaluate(a => {
            const r = a.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return a.contains(hit);
        });
        expect(onTop).toBe(true);

        await expect(right.locator('.sidebar-nav-title')).toHaveText('Sitewide');
        const links = await right.locator('a.btn-nav').evaluateAll(as => as.map(a => a.pathname.replace(/^\//, '')));
        expect(links, 'the Main Dashboard\'s links, less the page itself')
            .toEqual(SITEWIDE.filter(href => href !== self));
        expect(errors).toEqual([]);
    });
}

test('a Sitewide link goes where it says', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/privacy-policy.html', { waitUntil: 'networkidle' });
    await page.locator('.local-sidebar-right a.btn-nav', { hasText: 'Forum' }).click();
    await expect(page).toHaveURL(/\/forum\.html$/);
});

test('on a phone, the top-right menu opens the drawer with Ko-fi and the links', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/404.html', { waitUntil: 'networkidle' });

    const burger = page.locator('#mobile-menu-toggle');
    await expect(burger).toBeVisible();
    // It opens no contents here, so it is not called that.
    await expect(burger).toHaveAttribute('aria-label', 'Open sidebar');
    await burger.click();

    await expect(page.locator('.local-sidebar-right')).toHaveClass(/mobile-open/);
    await expect(page.locator('.local-sidebar-right > :first-child a[href*="Ko-fi"]')).toBeInViewport();
    await expect(page.locator('.local-sidebar-right a.btn-nav', { hasText: 'Forum' })).toBeInViewport();
    await expect(burger).toHaveAttribute('aria-label', 'Close sidebar');
});
