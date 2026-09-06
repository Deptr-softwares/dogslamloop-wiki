// Escaping at the interpolations a contributor can reach on a PUBLIC page.
//
// CLAUDE.md's rule is "escape at every innerHTML interpolation", and the
// enforcement so far has been review plus a spec per bug. This file came out of
// a deliberate sweep of all 517 innerHTML sites: 56 interpolations carried
// contributor-influenced data into markup, and after tracing each one, these
// are the ones that were genuinely unescaped on a page a reader loads.
//
// Two things the sweep taught, both worth keeping:
//
//   Most candidates were already safe, and not obviously so. Paragraph content
//   is escaped at the SOURCE - "escape first, then add the generated markup"
//   in js/description.js - so js/internalstyling.js interpolating a link label
//   raw is correct, and escaping it there would double-escape and break nested
//   shortcodes. A scan result is a hypothesis.
//
//   The tab-label bug had already been fixed ONCE, in the admin preview
//   (admin-preview-states.spec.js, "a state label cannot inject markup"). The
//   live renderer that readers actually load was never given the same fix.
//   Fixing a class in one renderer and not its twin is the shape to look for.
//
// Asserted as "the tag survives ESCAPED", never as "the substring is absent" -
// an absence assertion here passes the moment the payload is spelled
// differently.
const { test, expect } = require('@playwright/test');

// Inert if escaped; sets a flag and vanishes from the text if not.
const PAYLOAD = '<img src=x onerror="window.__xssFired=true">';

function watch(page) {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    return errors;
}

const fired = (page) => page.evaluate(() => window.__xssFired === true);

// --- THE PUBLIC TIER LIST ---

const revisionWith = (tierName, note) => ({
    id: '00000000-0000-0000-0000-000000000001',
    page_id: 'tierlist',
    page_type: 'tierlist',
    author_id: '00000000-0000-0000-0000-000000000002',
    author_name: 'test-author',
    created_at: new Date().toISOString(),
    status: 'approved',
    is_delta: false,
    target_scope: null,
    target_key: null,
    delta_payload: null,
    qa_metadata: { reviewed_by: 'test-reviewer', changelog: 'escaping probe' },
    desc_data: {
        tabs: [{
            id: 'overall',
            label: 'Overall',
            tiers: [{ name: tierName, color: 'hsl(0, 80%, 60%)', characters: ['Boomcat'] }],
            changelog: [{ date: '2026-09-06', notes: [note] }],
        }],
    },
    frame_data: {},
});

async function renderTierList(page, revision) {
    await page.route('**/rest/v1/pending_revisions**', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([revision]) }));
    await page.goto('/history.html?page=tierlist', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
}

test('a tier name cannot inject markup into the public tier list', async ({ page }) => {
    const errors = watch(page);
    await renderTierList(page, revisionWith(`S${PAYLOAD}`, 'ordinary note'));

    expect(await fired(page), 'the payload must not execute').toBe(false);

    const label = page.locator('.tier-list-row-label-text').first();
    await expect(label, 'the tier row still rendered').toHaveCount(1);
    // The positive form: the markup is present as TEXT, which is only true if
    // it was escaped on the way in.
    expect(await label.textContent(), 'the tag survives as text').toContain('<img');
    expect(await page.locator('.tier-list-row-label-text img').count(),
        'and never became an element').toBe(0);

    expect(errors).toEqual([]);
});

test('a tier changelog note cannot inject markup', async ({ page }) => {
    const errors = watch(page);
    await renderTierList(page, revisionWith('S', `Moved up${PAYLOAD}`));

    expect(await fired(page), 'the payload must not execute').toBe(false);

    const notes = page.locator('.tier-changelog-notes li').first();
    await expect(notes).toHaveCount(1);
    expect(await notes.textContent(), 'the tag survives as text').toContain('<img');
    expect(await page.locator('.tier-changelog-notes img').count()).toBe(0);

    expect(errors).toEqual([]);
});

// --- THE HISTORY PAGE TAB STRIP ---

test('a revision target_key cannot break out of the history tab handler', async ({ page }) => {
    // history.js builds its tab list from the FIXED vocabulary, with one
    // exception: a delta revision scoped to a move pushes
    // rev.target_key.split('::')[0] in as a tab id. target_key is
    // contributor-submitted, and it was being written into an inline
    // onclick="window.switchHistoryTab('...')" - the one construction CLAUDE.md
    // names outright, because escaping cannot save a value inside a JS string
    // inside an attribute.
    const errors = watch(page);

    await page.route('**/rest/v1/pending_revisions**', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
            id: '00000000-0000-0000-0000-000000000003',
            page_id: 'boomcat',
            page_type: 'character',
            author_id: '00000000-0000-0000-0000-000000000002',
            author_name: 'probe',
            created_at: new Date().toISOString(),
            status: 'approved',
            is_delta: true,
            target_scope: 'move',
            // Closes the handler's string, runs, comments out the remainder.
            target_key: `');window.__xssFired=true;//::m1`,
            delta_payload: { name: 'probe move' },
            qa_metadata: { reviewed_by: 'probe', changelog: 'escaping probe' },
            desc_data: {},
            frame_data: {},
        }]),
    }));

    await page.goto('/history.html?page=boomcat', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // CLICKING IS THE TEST. The first version of this asserted only that
    // nothing had fired after load, and passed - while the button had been
    // rendered carrying
    //   onclick="window.switchHistoryTab('');window.__xssFired=true;//')"
    // The injection had fully succeeded; the payload was simply waiting for
    // the click that any reader opening that tab would give it. A handler that
    // has not run yet is not a handler that is safe.
    const tab = page.locator('nav button[id^="nav-"]').first();
    await expect(tab, 'the crafted tab rendered, so there is something to click').toHaveCount(1);

    const inlineHandler = await tab.getAttribute('onclick');
    expect(inlineHandler, 'the tab must not carry an inline handler at all').toBeNull();

    await tab.click();
    await page.waitForTimeout(400);

    expect(await fired(page), 'the target_key must not become executable').toBe(false);
    expect(errors.filter(e => !/SyntaxError/.test(e)), 'and must not break the page').toEqual([]);
});

// --- THE SYSTEM PAGE TAB STRIP ---

test('a tab label cannot inject markup into the system page nav', async ({ page }) => {
    // The same data the admin preview already guards. This is the renderer a
    // reader loads, and it had no guard at all.
    const errors = watch(page);

    await page.route('**/rest/v1/page_data**', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        // A single OBJECT, not an array: fetchCloudCharacterData uses
        // .single(), so an array comes back as a PostgREST shape error and the
        // renderer silently falls through to its default "Overview" tab - which
        // is how the first version of this test passed nothing while looking
        // like it was testing something.
        body: JSON.stringify({
            page_id: 'framedata',
            desc_data: {
                tabs: [{
                    tabId: 'probe',
                    tabLabel: `Startup${PAYLOAD}`,
                    sections: [{ blocks: [{ type: 'paragraph', align: 'left', content: 'body text' }] }],
                }],
            },
        }),
    }));

    await page.goto('/systems/framedata/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    expect(await fired(page), 'the payload must not execute').toBe(false);

    const nav = page.locator('#system-dynamic-nav');
    if (await nav.count() === 0) {
        // The renderer did not take this branch, so this test proved nothing.
        // Fail loudly rather than passing vacuously.
        throw new Error('system nav did not render; the fixture no longer reaches the renderer');
    }
    expect(await nav.textContent(), 'the tag survives as text').toContain('<img');
    expect(await nav.locator('img').count(), 'and never became an element').toBe(0);

    expect(errors).toEqual([]);
});
