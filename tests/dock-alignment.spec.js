// The left sidebar's dock buttons line up the same on every page type (owner,
// 2026-11-19: "Why is the alignment of the buttons in this tier list
// centered? ... system type page got this centered alignment for the left
// sidebar buttons, and so is tool type page").
//
// .dock-action-btn (style/Layout.css) and .btn-sys (style/Buttons.css) both
// set display and justify-content at the same specificity, so the stylesheet a
// page loads LAST decided: character pages and the home page load Layout.css
// last (icon and label on the left), system and tool pages load Buttons.css
// last (centred). The same tie was settled for padding and font-size on
// 2026-08-14; these two were left. Measured, not read off the stylesheets.
const { test, expect } = require('@playwright/test');

const PAGES = [
    ['a character page', '/characters/Boomcat/index.html'],
    ['a system page', '/systems/color-codes/index.html'],
    ['a tool page', '/tools/create-tier-list/index.html'],
    ['the Tier Lists page', '/systems/tierlist/index.html'],
    ['the Update Log', '/systems/updatelog/index.html'],
    ['a hub page', '/systems/index.html'],
    ['the home page', '/index.html'],
];

for (const [label, url] of PAGES) {
    test(`the dock's buttons start at their left edge on ${label}`, async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 900 });
        await page.goto(url, { waitUntil: 'networkidle' });
        const buttons = page.locator('.dock-action-btn');
        await expect(buttons.first()).toBeVisible();

        const measured = await buttons.evaluateAll(nodes => nodes.filter(n => n.offsetParent).map(n => {
            const style = getComputedStyle(n);
            const box = n.getBoundingClientRect();
            const first = n.firstElementChild ? n.firstElementChild.getBoundingClientRect() : box;
            return {
                id: n.id || n.textContent.trim(),
                display: style.display,
                justify: style.justifyContent,
                // How far the icon sits from the button's left edge, past
                // the padding: 0 when the content starts at the left.
                inset: Math.round(first.left - box.left - parseFloat(style.paddingLeft) - parseFloat(style.borderLeftWidth)),
            };
        }));
        expect(measured.length).toBeGreaterThan(0);
        for (const b of measured) {
            expect(b, `${b.id} on ${label}`).toMatchObject({ display: 'flex', justify: 'flex-start', inset: 0 });
        }
    });

    test(`the collapsed sidebar centres the dock's icons on ${label}`, async ({ page }) => {
        // Collapsed, a button is its icon alone, centred like the other
        // collapsed sidebar buttons (.btn-manga-content).
        await page.setViewportSize({ width: 1400, height: 900 });
        await page.goto(url, { waitUntil: 'networkidle' });
        await expect(page.locator('.dock-action-btn').first()).toBeVisible();
        await page.evaluate(() => document.querySelector('.global-sidebar-left').classList.add('collapsed'));

        const off = await page.locator('.dock-action-btn').evaluateAll(nodes => nodes.filter(n => n.offsetParent).map(n => {
            const box = n.getBoundingClientRect();
            const icon = n.querySelector('.btn-manga-icon, .dock-action-icon, .px-icon') || n.firstElementChild;
            const r = icon.getBoundingClientRect();
            return Math.round(Math.abs((r.left + r.width / 2) - (box.left + box.width / 2)));
        }));
        expect(off.length).toBeGreaterThan(0);
        for (const o of off) expect(o, `icon off centre by ${o}px on ${label}`).toBeLessThanOrEqual(2);
    });
}
