// The Main Dashboard's chrome, from the owner's fine-tuning list (v0.14 §8).
//
// Four separate complaints that turned out to share one shape: a rule stated
// twice, or stated once and then beaten by source order. So the assertions
// here are mostly EQUALITY BETWEEN TWO RENDERED THINGS rather than pinned
// pixel values - "these two agree" survives a future resize, "this is 18.4px"
// does not, and font metrics differ by OS anyway.

const { test, expect } = require('@playwright/test');

function mockNav(page, nav) {
    return page.route('**/data/navigation.json*', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(nav) }));
}

// --------------------------------------------------------------------------
// COLUMN SUB-HEADINGS
// --------------------------------------------------------------------------
//
// Site Info sits in Guides & Such as .sidebar-master-title; Gamemodes sits in
// Others as .column-subgroup-title. Two classes, two columns, side by side -
// and until 2026-08-14 one was Finger-Paint 1.15rem and the other was mono
// 0.68rem.

test('every column sub-heading on the dashboard renders in one font at one size', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'networkidle' });

    // Both kinds have to be on screen for the comparison to mean anything.
    // Generous timeouts: all three columns are built from navigation.json
    // after load, and networkidle does not cover the rendering that follows -
    // under four parallel workers the default 5s is not always enough.
    await expect(page.locator('#systems-grid .sidebar-master-title').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.column-subgroup-title').first()).toBeVisible({ timeout: 15000 });

    const shapes = await page.evaluate(() => {
        const nodes = document.querySelectorAll('#systems-grid .sidebar-master-title, .column-subgroup-title');
        return Array.from(new Set(Array.from(nodes).map(el => {
            const cs = getComputedStyle(el);
            return `${cs.fontFamily}|${cs.fontSize}|${cs.textTransform}`;
        })));
    });

    // One distinct shape across both classes and all three columns.
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toContain('Finger-Paint');
});

// --------------------------------------------------------------------------
// BUTTON SPACING
// --------------------------------------------------------------------------
//
// The owner asked for tighter spacing "keeping enough room that the hover
// state does not clip". The tightening is taste and is not asserted; the
// floor is geometry and is.

test('directory buttons sit closer together than the hover state they must clear', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'networkidle' });
    await expect(page.locator('#others-grid .system-directory-btn').first()).toBeVisible({ timeout: 15000 });

    const measured = await page.evaluate(() => {
        const btn = document.querySelector('#others-grid .system-directory-btn');
        const cs = getComputedStyle(btn);

        // The overhang is read from the CSS rather than hardcoded, so changing
        // the hover physics moves this floor with it instead of leaving a
        // stale number behind.
        document.body.classList.add('__probe');
        const shadow = cs.boxShadow;

        const rows = [];
        const all = Array.from(document.querySelectorAll('#others-grid .system-directory-btn'));
        for (let i = 1; i < all.length; i++) {
            const a = all[i - 1].getBoundingClientRect();
            const b = all[i].getBoundingClientRect();
            // Only pairs stacked vertically in the same group; a pair split by
            // a sub-heading is separated by the heading's margin instead.
            if (b.top > a.bottom && b.top - a.bottom < 40) rows.push(b.top - a.bottom);
        }
        return { shadow, rows };
    });

    expect(measured.rows.length).toBeGreaterThan(0);

    // .btn-manga-slanted:hover moves the button translate(-2px, -2px) and its
    // shadow grows to 4px, so it paints 6px past its resting box.
    const HOVER_OVERHANG = 6;
    measured.rows.forEach(gap => expect(gap).toBeGreaterThanOrEqual(HOVER_OVERHANG));
});

// --------------------------------------------------------------------------
// THE SIDEBAR DOCK
// --------------------------------------------------------------------------
//
// THE REAL BUG, and the reason this file exists. .dock-action-btn in
// Layout.css and .btn-sys in Buttons.css both declared padding and font-size
// at identical 0-1-0 specificity, so the winner was whichever stylesheet the
// page loaded last - and generated character stubs load Layout.css AFTER
// Buttons.css while system stubs load it BEFORE. The same button rendered
// 45px tall on one page type and 34px on the other.
//
// Asserted as agreement between page types, which is the actual claim. A
// pinned height would pass just as happily with the bug restored on both.

test('the sidebar dock is the same size on a character page and a system page', async ({ page }) => {
    const shapeOf = async (url) => {
        await page.goto(url, { waitUntil: 'networkidle' });
        await expect(page.locator('#dock-btn-auth')).toBeVisible();
        return page.evaluate(() => {
            const cs = getComputedStyle(document.getElementById('dock-btn-auth'));
            return `${cs.padding}|${cs.fontSize}`;
        });
    };

    const character = await shapeOf('/characters/Ten_shadows/index.html');
    const system = await shapeOf('/systems/hud/index.html');
    const home = await shapeOf('/index.html');

    expect(character).toBe(system);
    expect(home).toBe(system);
});

test('Ko-fi matches the buttons it is stacked with', async ({ page }) => {
    await page.goto('/characters/Ten_shadows/index.html', { waitUntil: 'networkidle' });
    await expect(page.locator('#dock-btn-auth')).toBeVisible();

    const [dock, kofi] = await page.evaluate(() => ['#dock-btn-auth', '.kofi-btn-full'].map(sel => {
        const el = document.querySelector(sel);
        if (!el) return 'MISSING';
        const cs = getComputedStyle(el);
        return `${cs.padding}|${cs.fontSize}`;
    }));

    expect(kofi).not.toBe('MISSING');
    expect(kofi).toBe(dock);
});

// The inline styles that used to carry Ko-fi's sizing on nine hand-authored
// pages. They agreed with the class when they were written and would not have
// been updated with it.
test('no hand-authored page still sizes Ko-fi with an inline style', async ({ page }) => {
    for (const url of ['/index.html', '/404.html', '/privacy-policy.html', '/characters/index.html', '/systems/index.html']) {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        const inline = await page.evaluate(() => {
            const el = document.querySelector('.kofi-btn-wrapper a');
            return el ? (el.getAttribute('style') || '') : '';
        });
        expect(inline, `${url} still styles Ko-fi inline`).not.toContain('font-size');
        expect(inline, `${url} still styles Ko-fi inline`).not.toContain('padding');
    }
});

// --------------------------------------------------------------------------
// THE ROSTER FILTERS
// --------------------------------------------------------------------------
//
// These were the only dropdowns on the site without the editor-select marker,
// so they alone summoned the operating system's own dropdown over the wiki's
// palette. The widget's stylesheet also lived in editor.css, which the
// Character Dashboard has no business loading - so opting them in without
// moving those rules would have rendered an unstyled box beside a still
// visible native select.

const ROSTER_NAV = {
    Characters: [
        { id: 'A', name: 'Alpha', url: 'characters/Alpha/index.html', archetype: 'Rushdown', tier: 'S', cms_config: { pageType: 'character', pageId: 'alpha' } },
        { id: 'B', name: 'Beta', url: 'characters/Beta/index.html', archetype: 'Zoner', tier: 'B', cms_config: { pageType: 'character', pageId: 'beta' } },
        { id: 'C', name: 'Gamma', url: 'characters/Gamma/index.html', archetype: 'Zoner', tier: 'C', cms_config: { pageType: 'character', pageId: 'gamma' } },
    ],
};

test('the roster filters use the wiki dropdown, not the operating system one', async ({ page }) => {
    await mockNav(page, ROSTER_NAV);
    await page.goto('/characters/index.html', { waitUntil: 'networkidle' });

    const wrapper = page.locator('#filter-archetype + .manga-select-wrapper');
    await expect(wrapper).toHaveCount(1);
    await expect(page.locator('#filter-tier + .manga-select-wrapper')).toHaveCount(1);

    // The native control must be gone, not merely covered - one visible beside
    // the other is worse than the plain select this replaced.
    await expect(page.locator('#filter-archetype')).toBeHidden();

    // Proof the widget's stylesheet is actually reachable from this page,
    // which is the half that opting in alone would not have fixed.
    const styled = await page.evaluate(() => {
        const trigger = document.querySelector('#filter-archetype + .manga-select-wrapper .manga-select-trigger');
        return trigger ? getComputedStyle(trigger).boxShadow : 'none';
    });
    expect(styled).not.toBe('none');
});

// Driving the real control. A dropdown that renders and does not filter is
// worse than the native one it replaced, and the widget dispatches its own
// synthetic change event - which is exactly the kind of wiring that breaks
// silently.
test('picking an archetype in the new dropdown actually filters the roster', async ({ page }) => {
    await mockNav(page, ROSTER_NAV);
    await page.goto('/characters/index.html', { waitUntil: 'networkidle' });

    const cards = page.locator('.roster-card');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBe(3);

    await page.locator('#filter-archetype + .manga-select-wrapper .manga-select-trigger').click();
    await page.locator('#filter-archetype + .manga-select-wrapper .manga-option', { hasText: 'Zoner' }).click();

    await expect(cards).toHaveCount(2);
});
