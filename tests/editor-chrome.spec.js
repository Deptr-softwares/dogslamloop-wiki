// Reclaiming editor space (v0.14 §8, owner's item).
//
// The top of the editor was spending vertical space on things a contributor
// reads once and then writes underneath for an hour: a title, a subtitle, five
// action buttons and a paragraph explaining how submission works.
//
// Owner's call, 2026-08-14: a control folds away the action row and the title,
// and the tip can be dismissed. Both remembered.
//
// The claim is SPACE, so the assertions measure it. "The class was applied"
// would pass with a collapsed header that gave nothing back.

const { test, expect } = require('@playwright/test');

const PAGE = '/edit.html?page=boomcat';

// Where the editing surface starts. Everything above it is chrome, so this one
// number is the whole feature.
const surfaceTop = (page) => page.evaluate(() =>
    Math.round(document.getElementById('interactive-builder').getBoundingClientRect().top));

test('collapsing the header gives the editing surface real space back', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await expect(page.locator('#btn-collapse-chrome')).toBeVisible();

    const before = await surfaceTop(page);

    await page.locator('#btn-collapse-chrome').click();
    await expect(page.locator('#editor-header')).toHaveClass(/is-collapsed/);

    const after = await surfaceTop(page);
    // Measured at ~114px for the header alone. A floor rather than the exact
    // number, because font metrics differ by OS and the point is that it is a
    // lot, not that it is precisely this.
    expect(before - after).toBeGreaterThan(60);

    expect(errors).toEqual([]);
});

test('Submit survives the collapse and the rest of the action row does not', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await page.locator('#btn-collapse-chrome').click();

    // The one control you cannot make somebody expand a panel to reach. A
    // contributor who has finished writing should never have to hunt for it.
    await expect(page.locator('#submit-payload-btn')).toBeVisible();

    await expect(page.locator('.header-actions .btn-sys', { hasText: 'Cancel' })).toBeHidden();
    await expect(page.locator('#btn-toggle-diff')).toBeHidden();
    await expect(page.locator('.editor-hub-link')).toBeHidden();
});

test('the tab strip is not part of the collapse', async ({ page }) => {
    // The owner's constraint, and the reason this collapses the header rather
    // than everything above the surface: you collapse the chrome to get room
    // for writing, and you still switch tabs while writing.
    await page.goto(PAGE, { waitUntil: 'networkidle' });

    const nav = page.locator('#editor-tab-nav');
    const wasHidden = await nav.evaluate(el => el.classList.contains('hidden'));

    await page.locator('#btn-collapse-chrome').click();

    // Unchanged either way - the collapse must not touch it.
    expect(await nav.evaluate(el => el.classList.contains('hidden'))).toBe(wasHidden);
});

test('the tip can be dismissed, and dismissing it moves the surface up too', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'networkidle' });

    await expect(page.locator('#editor-scope-tip')).toBeVisible();
    const before = await surfaceTop(page);

    await page.locator('#btn-dismiss-tip').click();

    await expect(page.locator('#editor-scope-tip')).toBeHidden();
    expect(await surfaceTop(page)).toBeLessThan(before);
});

test('both choices survive a reload', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'networkidle' });

    // Set through the page rather than seeded into storage. addInitScript runs
    // on every document load, so state planted there cannot tell a remembered
    // preference apart from one the harness keeps re-applying.
    await page.locator('#btn-collapse-chrome').click();
    await page.locator('#btn-dismiss-tip').click();

    await page.reload({ waitUntil: 'networkidle' });

    await expect(page.locator('#editor-header')).toHaveClass(/is-collapsed/);
    await expect(page.locator('#editor-scope-tip')).toBeHidden();
    await expect(page.locator('#btn-collapse-chrome')).toHaveAttribute('aria-expanded', 'false');
});

test('expanding again is remembered as well', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await page.locator('#btn-collapse-chrome').click();
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('#editor-header')).toHaveClass(/is-collapsed/);

    // The half a one-way write would miss: the preference has to be cleared,
    // not only set.
    await page.locator('#btn-collapse-chrome').click();
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('#editor-header')).not.toHaveClass(/is-collapsed/);
});

test('storage that throws costs the memory, not the control', async ({ page }) => {
    // localStorage throws outright in a few real configurations - Safari's
    // private mode historically, any browser with site data blocked. The
    // control still has to work; it just forgets.
    //
    // Broken AFTER load rather than through addInitScript, deliberately. The
    // drafts system also reads localStorage and blocking it from boot tests
    // that module's resilience, not this one's - and it fails loudly enough to
    // put a modal over the button, which is a different bug report entirely.
    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await expect(page.locator('#btn-collapse-chrome')).toBeVisible();

    await page.evaluate(() => {
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            get() { throw new Error('storage is blocked'); },
        });
    });

    const threw = await page.evaluate(() => {
        try {
            window.setEditorChromeCollapsed(true);
            window.setEditorTipDismissed(true);
            return null;
        } catch (e) {
            return e.message;
        }
    });
    expect(threw, 'the write must be swallowed, not propagated').toBeNull();

    // And the visible half still happened.
    await expect(page.locator('#editor-header')).toHaveClass(/is-collapsed/);
    await expect(page.locator('#editor-scope-tip')).toBeHidden();
});
