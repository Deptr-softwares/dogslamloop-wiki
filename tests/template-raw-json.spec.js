// characters/Template advertises a "Behind the Scenes: Raw JSON" section. It
// read ./template_descriptions.json and ./template_framedata.json, which
// stopped existing when content moved to Supabase - so both fetches 404'd,
// both accordions were skipped, and the page appended the heading with nothing
// underneath. A section promising content it could never show, on the page the
// owner points contributors at.
//
// It reads page_data now, the same row the rest of the page renders from.
//
// ASSERTED AS A CONTRACT, NOT AGAINST THE TEMPLATE'S CONTENT: either the
// section has at least one accordion, or it is not rendered at all. Pinning it
// to what the owner has written in that row would let an ordinary content edit
// fail this test - and a red test here stops the regeneration job committing
// anything at all, which is an outage rather than a failure. See CLAUDE.md.
const { test, expect } = require('@playwright/test');

const SECTION = 'Behind the Scenes';

test('the raw-JSON section shows content, or is not rendered at all', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('/characters/Template/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1600);

    const section = page.locator('#tab-overview section.wiki-section')
        .filter({ hasText: SECTION });

    if (await section.count() === 0) {
        // Valid: the template row is empty or unreachable. The point of the fix
        // is that the heading does not appear without something under it.
        expect(errors, 'and it got there without throwing').toEqual([]);
        return;
    }

    const accordions = section.locator('details.manga-accordion');
    expect(await accordions.count(), 'the section was rendered, so it must have content')
        .toBeGreaterThan(0);

    // The heading is a promise to the reader; an accordion that opens onto
    // nothing keeps the letter of it and not the meaning.
    const firstBody = accordions.first().locator('pre');
    expect((await firstBody.textContent() || '').trim().length,
        'the accordion contains real JSON').toBeGreaterThan(2);

    expect(errors).toEqual([]);
});

test('it does not read the local JSON files that no longer exist', async ({ page }) => {
    // The specific regression. Guarded here as well as in page-sweep.spec.js
    // because this names the bug, and the sweep only reports that some asset on
    // some page 404'd.
    const requested = [];
    page.on('request', r => {
        if (/_(descriptions|framedata)\.json/.test(r.url())) requested.push(r.url());
    });

    await page.goto('/characters/Template/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1600);

    expect(requested, 'content comes from page_data now').toEqual([]);
});
