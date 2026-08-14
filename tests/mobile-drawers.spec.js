// The mobile top bar, reworked 2026-08-14 (v0.14 §8).
//
// Before this, the table of contents was `display: none` below 1024px - it did
// not exist on a phone at all, on a wiki whose longest pages are exactly the
// ones a phone reader needs to jump around inside. The bar's two controls were
// a link home and a burger that opened the left sidebar, which meant the site
// spent its only drawer control on navigation and had none left for contents.
//
// Owner's call: the site name opens the LEFT drawer, the burger opens the
// RIGHT one. Dropping the link home costs nothing, because the drawer it opens
// carries its own link to the Main Dashboard - the bar was the second route to
// the same place.
//
// Everything here drives a real control on a real phone viewport. A drawer
// that renders and does not open is the whole failure mode.

const { test, expect } = require('@playwright/test');

const PAGE = '/systems/hud/index.html';

test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the site name opens the navigation, and it is not a second link home', async ({ page }) => {
        await page.goto(PAGE, { waitUntil: 'networkidle' });

        const nav = page.locator('#mobile-nav-toggle');
        // A button, not an anchor: it performs an action rather than going
        // somewhere, and a screen reader should say so.
        await expect(nav).toHaveJSProperty('tagName', 'BUTTON');
        await expect(nav).toHaveAttribute('aria-expanded', 'false');

        await nav.click();

        await expect(page.locator('#master-sidebar')).toHaveClass(/mobile-open/);
        await expect(nav).toHaveAttribute('aria-expanded', 'true');

        // The route home the bar gave up. If this ever stops being true, the
        // bar has to go back to being a link.
        await expect(page.locator('#master-sidebar a.site-title')).toHaveAttribute('href', /index\.html$/);
    });

    test('the burger opens the contents, and the contents are actually in it', async ({ page }) => {
        await page.goto(PAGE, { waitUntil: 'networkidle' });

        const toc = page.locator('.local-sidebar-right');
        const burger = page.locator('#mobile-menu-toggle');

        await expect(burger).toHaveAttribute('aria-label', /contents/i);

        // Populated before it is opened - the entries are built at boot, and a
        // drawer that opens onto "Loading contents..." is the version of this
        // feature that looks broken.
        await expect(page.locator('#dynamic-toc a').first()).toBeAttached({ timeout: 15000 });

        await burger.click();
        await expect(toc).toHaveClass(/mobile-open/);

        // On screen, not merely class-toggled: the drawer slides in from the
        // right edge and a wrong transform would leave it parked off-screen
        // with every assertion above still passing.
        const box = await toc.boundingBox();
        expect(box.x).toBeLessThan(390);
        expect(box.x + box.width).toBeGreaterThan(0);
    });

    test('one drawer at a time, and the backdrop puts it away', async ({ page }) => {
        await page.goto(PAGE, { waitUntil: 'networkidle' });

        await page.locator('#mobile-nav-toggle').click();
        await expect(page.locator('#master-sidebar')).toHaveClass(/mobile-open/);
        await expect(page.locator('.local-sidebar-right')).not.toHaveClass(/mobile-open/);
        await expect(page.locator('#mobile-backdrop')).toHaveClass(/active/);

        await page.locator('#mobile-backdrop').click({ position: { x: 350, y: 500 } });
        await expect(page.locator('#master-sidebar')).not.toHaveClass(/mobile-open/);
        await expect(page.locator('#mobile-backdrop')).not.toHaveClass(/active/);

        await page.locator('#mobile-menu-toggle').click();
        await expect(page.locator('.local-sidebar-right')).toHaveClass(/mobile-open/);
        await expect(page.locator('#master-sidebar')).not.toHaveClass(/mobile-open/);
    });

    // The drawer is now the ONLY route to Edit and History on a phone. The
    // page body carried a duplicate pair until 2026-08-14, removed because
    // this exists - so if the drawer ever stops carrying them, a phone reader
    // loses both outright rather than falling back to anything.
    test('the contents drawer carries the Edit and History pair', async ({ page }) => {
        await page.goto(PAGE, { waitUntil: 'networkidle' });

        const drawer = page.locator('.local-sidebar-right');
        await page.locator('#mobile-menu-toggle').click();
        await expect(drawer).toHaveClass(/mobile-open/);

        await expect(drawer.locator('#btn-edit-current-tab')).toBeVisible();
        await expect(drawer.locator('#btn-history-current-tab')).toBeVisible();

        // Inside the drawer's own box, not merely a descendant pushed off it
        // by the narrower width.
        //
        // Both boxes are read in ONE evaluate, and only once the slide has
        // settled. Two separate boundingBox() calls during the 0.3s transition
        // sample the drawer and the button at different offsets and report a
        // 12px overflow that is entirely the animation.
        await expect.poll(async () => drawer.evaluate(el =>
            Math.round(el.getBoundingClientRect().x))).toBe(110);

        const fits = await drawer.evaluate(el => {
            const d = el.getBoundingClientRect();
            return ['btn-edit-current-tab', 'btn-history-current-tab'].map(id => {
                const b = document.getElementById(id).getBoundingClientRect();
                return b.x >= d.x - 1 && b.x + b.width <= d.x + d.width + 1;
            });
        });
        expect(fits).toEqual([true, true]);
    });

    test('following a contents link puts the drawer away', async ({ page }) => {
        await page.goto(PAGE, { waitUntil: 'networkidle' });

        await page.locator('#mobile-menu-toggle').click();
        await expect(page.locator('.local-sidebar-right')).toHaveClass(/mobile-open/);

        // Otherwise the reader lands on the heading they picked with the drawer
        // still covering it, which reads as the tap having done nothing.
        await page.locator('#dynamic-toc a').first().click();
        await expect(page.locator('.local-sidebar-right')).not.toHaveClass(/mobile-open/);
    });

    test('a page with no contents hides the burger rather than opening nothing', async ({ page }) => {
        // 404, the blog index, the privacy policy, recent changes and
        // submissions all carry the bar and have no table of contents.
        await page.goto('/404.html', { waitUntil: 'networkidle' });

        await expect(page.locator('#mobile-menu-toggle')).toBeHidden();
        // The navigation is still reachable, so nothing is stranded.
        await expect(page.locator('#mobile-nav-toggle')).toBeVisible();
        await page.locator('#mobile-nav-toggle').click();
        await expect(page.locator('#master-sidebar')).toHaveClass(/mobile-open/);
    });

    test('the closed contents drawer adds no horizontal scrolling', async ({ page }) => {
        await page.goto(PAGE, { waitUntil: 'networkidle' });

        // It is parked off the right edge with a transform. Position fixed is
        // what keeps that out of the document's scrollable overflow - static or
        // absolute would hand every page a sideways scrollbar.
        const overflow = await page.evaluate(() =>
            document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });

    test('the site name is set in the wiki typeface', async ({ page }) => {
        await page.goto(PAGE, { waitUntil: 'networkidle' });

        const font = await page.locator('.mobile-site-title').evaluate(el =>
            getComputedStyle(el).fontFamily);
        expect(font).toContain('Finger-Paint');
    });
});

// The drawers exist only below 1024px. On a desktop the contents are a column
// beside the page and must stay one - a fixed-position ToC sliding over the
// content would be a regression nobody is looking for.
test.describe('on a desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the contents are still a column, not a drawer', async ({ page }) => {
        await page.goto(PAGE, { waitUntil: 'networkidle' });

        const toc = page.locator('.local-sidebar-right');
        await expect(toc).toBeVisible();

        const position = await toc.evaluate(el => getComputedStyle(el).position);
        expect(position).not.toBe('fixed');

        await expect(page.locator('#mobile-backdrop')).not.toHaveClass(/active/);
    });
});
