// The v0.11 accessibility baseline.
//
// Before this the codebase had 2 aria-* attributes total, no role or tabindex
// anywhere, and no keyboard focus indicator outside form inputs. These tests
// pin the specific things that were wrong, so they cannot quietly come back as
// pages are added:
//
//   - Every page carried TWO <h1>, because the mobile bar's brand was one.
//   - The three icon-only buttons (burger, sidebar collapse, ToC toggle) had
//     no accessible name at all - a screen reader announced "button".
//   - The collapsible sidebar groups were <div onclick>, so they were
//     unreachable by keyboard and announced no open/closed state.
//   - Reaching a character page's first paragraph meant tabbing through ~40
//     sidebar links, on every page.
//
// A note on what this file cannot do: it is not an audit. It checks the
// specific regressions above, not WCAG conformance.

const { test, expect } = require('@playwright/test');

// One of each kind of page: a hub, a generated character stub, a generated
// system stub, and a hand-authored standalone page.
const PAGES = [
    '/index.html',
    '/characters/index.html',
    '/systems/index.html',
    '/characters/Boomcat/index.html',
    '/systems/framedata/index.html',
    '/blog.html',
    '/404.html',
];

test.describe('headings', () => {
    for (const path of PAGES) {
        test(`${path} has exactly one <h1>`, async ({ page }) => {
            await page.goto(path, { waitUntil: 'networkidle' });

            const h1s = await page.locator('h1').allTextContents();
            expect(h1s, `found ${h1s.length}: ${JSON.stringify(h1s)}`).toHaveLength(1);
            // And it must be the page's subject, not the site brand.
            expect(h1s[0].toLowerCase()).not.toBe('dogslamloop wiki');
        });
    }
});

test.describe('accessible names', () => {
    for (const path of ['/index.html', '/characters/Boomcat/index.html']) {
        test(`${path}: no control is announced as an unlabelled button`, async ({ page }) => {
            await page.goto(path, { waitUntil: 'networkidle' });

            const unnamed = await page.locator('button:visible').evaluateAll(els =>
                els.filter(el => {
                    const text = (el.textContent || '').replace(/[\s☰▼✕×➔←→]/g, '').trim();
                    const label = el.getAttribute('aria-label') || el.getAttribute('title') || '';
                    return text === '' && label.trim() === '';
                }).map(el => el.className || el.id || el.outerHTML.slice(0, 60))
            );

            expect(unnamed, `unlabelled: ${JSON.stringify(unnamed)}`).toEqual([]);
        });
    }
});

test.describe('skip link', () => {
    for (const path of PAGES) {
        test(`${path} has a skip link pointing at real content`, async ({ page }) => {
            await page.goto(path, { waitUntil: 'networkidle' });

            const link = page.locator('.skip-link');
            await expect(link).toHaveCount(1);

            const href = await link.getAttribute('href');
            expect(href).toMatch(/^#.+/);
            await expect(page.locator(href)).toHaveCount(1);
        });
    }

    test('it is the first thing a keyboard user reaches, and it moves focus', async ({ page }) => {
        await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

        await page.keyboard.press('Tab');
        await expect(page.locator('.skip-link')).toBeFocused();

        // Visible only once focused - it must not sit on the page permanently.
        const top = await page.locator('.skip-link').evaluate(el => el.getBoundingClientRect().top);
        expect(top).toBeGreaterThanOrEqual(0);

        await page.keyboard.press('Enter');
        // Focus has to actually land in main, or the next Tab resumes from the
        // top of the page and the link achieved nothing.
        const focusedInMain = await page.evaluate(() => {
            const main = document.querySelector('main');
            return !!main && (document.activeElement === main || main.contains(document.activeElement));
        });
        expect(focusedInMain).toBe(true);
    });
});

test.describe('collapsible controls report their state', () => {
    test('sidebar category groups are buttons with aria-expanded', async ({ page }) => {
        await page.goto('/index.html', { waitUntil: 'networkidle' });

        const headers = page.locator('.sidebar-group-header');
        await expect(headers.first()).toBeVisible();

        // Was a <div onclick>: unreachable by keyboard, announced as nothing.
        const tags = await headers.evaluateAll(els => [...new Set(els.map(e => e.tagName))]);
        expect(tags).toEqual(['BUTTON']);

        const first = headers.first();
        await expect(first).toHaveAttribute('aria-expanded', 'false');
        await first.click();
        await expect(first).toHaveAttribute('aria-expanded', 'true');
        await first.click();
        await expect(first).toHaveAttribute('aria-expanded', 'false');
    });

    test('a sidebar group can be opened from the keyboard alone', async ({ page }) => {
        await page.goto('/index.html', { waitUntil: 'networkidle' });
        const first = page.locator('.sidebar-group-header').first();
        await expect(first).toBeVisible();

        await first.focus();
        await page.keyboard.press('Enter');
        await expect(first).toHaveAttribute('aria-expanded', 'true');
    });

    test('the ToC toggle reports and changes its state', async ({ page }) => {
        await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

        const toggle = page.locator('.toc-toggle-btn').first();
        await expect(toggle).toBeVisible();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(toggle).toHaveAttribute('aria-label', /Toggle subsections/);

        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });
});

test.describe('landmarks', () => {
    test('the two sidebars are distinguishable', async ({ page }) => {
        await page.goto('/characters/index.html', { waitUntil: 'networkidle' });

        const labels = await page.locator('aside').evaluateAll(els =>
            els.map(el => el.getAttribute('aria-label'))
        );
        // Two <aside> landmarks with no names are announced identically.
        expect(labels.filter(Boolean).length).toBe(labels.length);
        expect(new Set(labels).size).toBe(labels.length);
    });
});

test.describe('keyboard focus is visible', () => {
    test('links and buttons get an outline on :focus-visible', async ({ page }) => {
        await page.goto('/index.html', { waitUntil: 'networkidle' });

        // Keyboard focus, not a click - :focus-visible deliberately does not
        // fire for a mouse.
        await page.keyboard.press('Tab');

        const outline = await page.evaluate(() => {
            const el = document.activeElement;
            const cs = getComputedStyle(el);
            return { width: cs.outlineWidth, style: cs.outlineStyle };
        });

        expect(outline.style).not.toBe('none');
        expect(parseFloat(outline.width)).toBeGreaterThan(0);
    });
});

test('the mobile menu reports its state and closes on Escape', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto('/index.html', { waitUntil: 'networkidle' });

    const btn = page.locator('#mobile-menu-toggle');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(btn).toHaveAttribute('aria-label', 'Open navigation menu');

    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(btn).toHaveAttribute('aria-label', 'Close navigation menu');

    // Previously the only way out was tapping the backdrop, which a keyboard
    // user cannot reach.
    await page.keyboard.press('Escape');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#master-sidebar')).not.toHaveClass(/mobile-open/);
});
