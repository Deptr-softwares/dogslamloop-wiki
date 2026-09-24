// The wiki's written rules: privacy-policy.html, terms.html, LICENSE and
// CONTENT-LICENSE.md (v0.20).
//
// WHY THIS FILE EXISTS. Three of these four documents make claims ABOUT EACH
// OTHER, and nothing else in the suite would notice them drifting apart:
//
//   * The content licence only binds anything because the Terms grant the wiki
//     a licence over what contributors write. Delete that clause and the
//     licence file is still there, still valid-looking, and covers only what
//     the owner personally typed. Nothing renders differently.
//   * The Terms name a licence. CONTENT-LICENSE.md names a licence. The footer
//     links to one of them. Swap the variant in one place - NC to plain BY, say
//     - and the site states two different licences with a straight face.
//
// So this file compares them BOTH WAYS rather than checking each in isolation,
// which is the same rule the section-link picker earned in v0.15: "everything I
// offer resolves" and "everything real is offered" are different claims.
const { test, expect } = require('@playwright/test');

const CONTENT_LICENCE = 'CC BY-NC-SA 4.0';

test('the terms page loads and drives without throwing', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('/terms.html', { waitUntil: 'networkidle' });
    await expect(page.locator('h1')).toHaveText('Terms of Service');

    // The sidebar is built by JS on every page of this site; a hand-authored
    // page that forgot a script tag renders a permanent "Loading menu..."
    // rather than an error, which is precisely the failure that looks fine.
    //
    // Attached rather than visible, and the placeholder rather than a count.
    // The first assertion here was toBeVisible(), which failed against a page
    // that was working: the nav had built, and its first link sits inside a
    // collapsed group. A count would pin this to whatever the owner currently
    // has in the roster.
    await expect(page.locator('#global-sidebar-nav a').first()).toBeAttached();
    await expect(page.locator('#global-sidebar-nav .loading-msg')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('the terms carry the contributor grant, which is what makes the content licence mean anything', async ({ request }) => {
    const html = await (await request.get('/terms.html')).text();

    // The author keeps copyright...
    expect(html).toMatch(/you keep the copyright/i);
    // ...and grants the wiki an onward licence. All four words matter: a
    // revocable or non-transferable grant cannot support a ShareAlike licence
    // over a page a dozen people wrote.
    expect(html).toMatch(/worldwide/i);
    expect(html).toMatch(/royalty-free/i);
    expect(html).toMatch(/perpetual/i);
    expect(html).toMatch(/irrevocable/i);
    expect(html).toContain(CONTENT_LICENCE);
});

test('the terms honour what the Writing Guide already promised about media', async ({ request }) => {
    // The Writing Guide tells contributors the media rules "can be revisited in
    // the terms of service" - written before any such page existed. The promise
    // is content the owner wrote, so it is not asserted here; what is asserted
    // is that the page it points at actually carries the rules.
    const html = await (await request.get('/terms.html')).text();

    for (const format of ['webp', 'webm', 'gif']) {
        expect(html, `accepted formats name ${format}`).toContain(format);
    }
});

test('the two licences agree with each other, in both directions', async ({ request }) => {
    const terms = await (await request.get('/terms.html')).text();
    const content = await (await request.get('/CONTENT-LICENSE.md')).text();
    const code = await (await request.get('/LICENSE')).text();

    // Content: named identically in both places.
    expect(content).toContain(CONTENT_LICENCE);
    expect(terms).toContain(CONTENT_LICENCE);

    // Code: still MIT, and both documents still say so. The v0.20 licence
    // change was deliberately to the CONTENT only, and a later sweep that
    // "finishes the job" by changing LICENSE too would break the promise the
    // terms make to anyone who forked the engine.
    expect(code).toContain('MIT License');
    expect(content).toContain('MIT');
    expect(terms).toContain('MIT');

    // The other direction: the content licence must not quietly claim the code,
    // and must point at the file that does.
    expect(content).toContain('LICENSE');
});

test('the licence and terms are reachable from the footer, not just from each other', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'networkidle' });
    await expect(page.locator('#site-footer')).toBeAttached();

    const labels = await page.locator('#site-footer a').allTextContents();
    expect(labels.join(' | ')).toMatch(/Terms of Service/);

    // The footer said "License (MIT)" until v0.20, which named the CODE licence
    // to readers who will never fork it and never named the one covering what
    // they are reading. Asserted positively: the link resolves to the content
    // licence, rather than asserting the old label is absent.
    const licence = page.locator('#site-footer a[href$="CONTENT-LICENSE.md"]');
    await expect(licence).toHaveCount(1);
});
