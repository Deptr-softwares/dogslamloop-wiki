// v0.13 items 16-19: sidebar density, sidebar header styling, and the colour
// picker's fit and finish.
//
// Assertions here are structural or computed-style, never pixel comparisons -
// font rendering differs by OS and the visual suite is a local-only tool for
// that reason. What is pinned is the thing that broke, not how it looks.
const { test, expect } = require('@playwright/test');

test('sidebar category headers keep the title styling instead of the button reset', async ({ page }) => {
    // The bug: .sidebar-nav-title.sidebar-group-header is 0-2-0 and carried
    // `font: inherit; color: inherit` from the UA button reset, which beat
    // .sidebar-nav-title at 0-1-0. The headers rendered in the body font and
    // body colour, next to a plain <div> heading that had kept both.
    await page.goto('/', { waitUntil: 'networkidle' });

    const header = page.locator('#global-sidebar-nav .sidebar-group-header').first();
    await expect(header).toBeVisible();

    const style = await header.evaluate(el => {
        const computed = getComputedStyle(el);
        return { font: computed.fontFamily, color: computed.color, bodyColor: getComputedStyle(document.body).color };
    });

    expect(style.font).toContain('Finger-Paint');
    expect(style.color, 'not the inherited body colour').not.toBe(style.bodyColor);
});

test('the header colour follows the page accent, not a fixed blue', async ({ page }) => {
    // js/site_meta.js re-points --accent-blue per character, so a hardcoded
    // value would be right on the hub and wrong on every character page.
    // Proven by moving the variable and watching the header follow.
    await page.goto('/', { waitUntil: 'networkidle' });

    const header = page.locator('#global-sidebar-nav .sidebar-group-header').first();
    const before = await header.evaluate(el => getComputedStyle(el).color);

    await page.evaluate(() => document.documentElement.style.setProperty('--accent-blue', 'rgb(255, 0, 128)'));
    const after = await header.evaluate(el => getComputedStyle(el).color);

    expect(after).toBe('rgb(255, 0, 128)');
    expect(after).not.toBe(before);
});

test('the sidebar fits its categories and the Ko-fi button in one screen', async ({ page }) => {
    // The actual complaint: seven categories pushed Ko-fi out of sight. This
    // asserts the outcome rather than a spacing number, so the rule can be
    // tuned freely as long as the button stays reachable.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/', { waitUntil: 'networkidle' });

    const groups = page.locator('#global-sidebar-nav .sidebar-group-wrapper');
    expect(await groups.count(), 'the sidebar really does carry this many groups now').toBeGreaterThanOrEqual(7);

    const kofi = page.locator('.kofi-btn-wrapper, .kofi-btn-full').first();
    if (await kofi.count() === 0) test.skip(true, 'no Ko-fi button on this build');

    const box = await kofi.boundingBox();
    expect(box, 'the Ko-fi button is laid out').not.toBeNull();
    expect(box.y, 'and sits within the viewport rather than below the fold').toBeLessThan(800);
});

test('the colour picker is square and hard-shadowed like the rest of the editor', async ({ page }) => {
    await page.route('**/rest/v1/page_data*', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.goto('/edit.html?char=testchar&tab=overview', { waitUntil: 'networkidle' });

    const popup = await page.evaluate(() => {
        const el = document.createElement('div');
        el.className = 'format-color-popup';
        document.body.appendChild(el);
        const computed = getComputedStyle(el);
        return {
            radius: computed.borderTopLeftRadius,
            shadow: computed.boxShadow,
            gutter: computed.scrollbarGutter,
            paddingRight: parseFloat(computed.paddingRight),
            paddingLeft: parseFloat(computed.paddingLeft),
        };
    });

    expect(popup.radius, 'square corners').toBe('0px');
    expect(popup.shadow, 'a hard offset shadow, not a blur').toMatch(/0px 4px 4px|4px 4px 0px/);
});

test('the open picker stays inside the pane that clips it', async ({ page }) => {
    // Asserts the symptom, not a mechanism. The first fix for this pinned
    // "a scrollbar gutter is reserved", which passed while the popup was
    // still visibly cut off - it was the editor pane clipping it, not the
    // popup's own scrollbar. Measured: popup 216->491, pane ends at 383.
    await page.route('**/rest/v1/page_data*', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.goto('/edit.html?char=testchar&tab=overview', { waitUntil: 'networkidle' });

    await page.evaluate(() => {
        window.initStrategyBlockBuilder('interactive-builder', [{ type: 'paragraph', content: 'Hello' }]);
    });
    await expect(page.locator('.format-btn-color-trigger').first()).toBeVisible();
    await page.locator('.format-btn-color-trigger').first().click();

    const fit = await page.evaluate(() => {
        const popup = document.querySelector('.format-color-popup');
        let clipper = popup.parentElement;
        while (clipper && clipper !== document.body) {
            const style = getComputedStyle(clipper);
            if (/(auto|scroll|hidden)/.test(style.overflowX + style.overflowY)) break;
            clipper = clipper.parentElement;
        }
        const bounds = (clipper && clipper !== document.body)
            ? clipper.getBoundingClientRect()
            : { left: 0, right: window.innerWidth };
        const box = popup.getBoundingClientRect();
        return { overflowRight: Math.round(box.right - bounds.right), overflowLeft: Math.round(bounds.left - box.left), width: Math.round(box.width) };
    });

    expect(fit.width, 'the popup really is wide enough for this to matter').toBeGreaterThan(200);
    expect(fit.overflowRight, 'no swatch column past the right edge').toBeLessThanOrEqual(0);
    expect(fit.overflowLeft, 'and it was not shoved out the other side').toBeLessThanOrEqual(0);
});

test('a preset swatch is square and shows it is clickable', async ({ page }) => {
    await page.route('**/rest/v1/page_data*', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.goto('/edit.html?char=testchar&tab=overview', { waitUntil: 'networkidle' });

    const style = await page.evaluate(() => {
        const el = document.createElement('button');
        el.className = 'color-preset-btn';
        document.body.appendChild(el);
        const computed = getComputedStyle(el);
        return { radius: computed.borderTopLeftRadius, cursor: computed.cursor };
    });

    expect(style.radius).toBe('0px');
    expect(style.cursor, 'a swatch has no label, so the cursor is the affordance').toBe('pointer');
});
