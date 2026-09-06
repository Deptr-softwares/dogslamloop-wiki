// Loads EVERY page on the site and fails on what a browser actually complains
// about. This exists because the suite was deep on logic and shallow on pages:
// 174 spec files, but only twelve distinct pages were ever loaded end-to-end,
// and exactly one of the twenty-three character pages. Fifty pages were loaded
// by nothing, which is why runtime breakage kept reaching the owner by eye
// instead of reaching CI.
//
// smoke.spec.js is the ancestor of this file and stays as it is: it asserts a
// handful of representative pages carefully. This one trades depth for reach.
//
// THE PAGE LIST IS DERIVED, NEVER LISTED. A new page is covered the moment it
// is in navigation.json, and nothing here counts pages, names characters or
// asserts anything the owner can change by editing content. That is not a
// style choice - the regeneration job commits only after this suite passes, so
// a test an owner edit can turn red takes the whole content pipeline down with
// it. See CLAUDE.md; it has happened twice.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const nav = require('../data/navigation.json');

const PAGES = [...new Set([
    ...Object.values(nav).flat().map(e => '/' + e.url),
    ...fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).map(f => '/' + f),
])].sort();

// A local file the site ships as CODE. A 404 here is always breakage: a
// renamed module, a bad relative path, a missing stylesheet or font.
const SITE_ASSET = /\.(js|css|json|woff2?|ico)(\?|$)/i;

// ...and `medias/` is deliberately NOT in it.
//
// The first version of this check covered images too, and that was wrong in a
// way worth spelling out, because the rule it breaks is one this repo learned
// the hard way and then broke again the next day.
//
// medias/ holds OWNER-UPLOADED CONTENT. A roster icon is added by dropping a
// file in, and creating the character page first is an ordinary thing to do -
// the site is built for it: markLoadedRosterIcons removes the <img> on error
// and the card falls back to the pre-v0.16 solid-colour design, which
// roster-icon.spec.js asserts directly. So a missing image is a content state
// with a designed answer, not a fault.
//
// Treating it as a fault made this spec something the owner could turn red by
// adding a character, which is a production outage rather than a failing test:
// the regeneration job commits only after this suite passes. It happened on
// 2026-09-05, hours after this file was written, when "Sky Assassin" was
// created without its icon - and it took smoke.spec.js and roster-icon.spec.js
// down with it.
//
// What still gets caught: a missing script, stylesheet, font or data file -
// none of which the owner can cause, and all of which genuinely break a page.
const OWNER_MEDIA = /\/medias\//i;

// There is no allow-list, and that is the point.
//
// The first version of this file had one entry: the pre-Supabase
// *_descriptions.json / *_framedata.json fallback, which fired on every page
// with no page_data row and could only 404, since no such file has existed in
// this repo since content moved to Supabase. Both fallbacks are now deleted
// rather than tolerated, so nothing needs excusing and a reintroduction fails
// here instead of being waved through.
//
// Note what this file does NOT do: filter by status code. smoke.spec.js has to
// suppress every 404 that way, because the console reports them without a URL
// and it cannot tell a dead fallback from a missing stylesheet. Reading the URL
// off the response event instead is what makes being specific possible.

for (const p of PAGES) {
    test(`no runtime errors on ${p}`, async ({ page }) => {
        const thrown = [];
        const brokenAssets = [];

        // A script that threw. Always real, never load-dependent, and the single
        // highest-signal thing on this page - it means execution STOPPED, so
        // everything after it silently did not happen.
        page.on('pageerror', e => thrown.push(e.message));

        page.on('response', r => {
            const url = r.url();
            if (r.status() < 400) return;
            // Supabase REST 4xx is not breakage: 406 is PostgREST saying no row
            // matched, which is the correct answer for a page whose content has
            // not been written yet. Whether a page SHOULD have content is the
            // owner's call, not a test's.
            if (url.includes('/rest/v1/')) return;
            if (OWNER_MEDIA.test(url)) return;
            if (!SITE_ASSET.test(url)) return;
            brokenAssets.push(`${r.status()} ${url.replace(/^https?:\/\/[^/]+/, '')}`);
        });

        const response = await page.goto(p, { waitUntil: 'networkidle' });
        expect(response.ok(), `${p} did not serve`).toBeTruthy();
        await page.waitForTimeout(400);

        // Deliberately NOT asserting on requestfailed / net::ERR_*. Those are
        // transport-level and this project's own dev server produces them under
        // parallel load - ERR_CONNECTION_REFUSED appeared on two pages at four
        // workers and on none at one worker. Asserting them would buy a
        // permanently flaky spec, and flaky here means the regeneration job
        // stops committing at random.
        expect(thrown, `${p} threw at runtime`).toEqual([]);
        expect(brokenAssets, `${p} requested assets that do not exist`).toEqual([]);
    });
}

test('the sweep actually covered the site', () => {
    // Guards the failure mode this whole file is vulnerable to: a glob or a
    // path change quietly reducing PAGES to a handful, leaving every test above
    // passing while covering nothing. A floor, not a count - it moves only if
    // the site loses most of its pages, which is not something owner content
    // can do.
    expect(PAGES.length, 'the page list collapsed; check navigation.json loaded').toBeGreaterThan(30);
    expect(PAGES.some(p => p.startsWith('/characters/')), 'character pages are in the sweep').toBe(true);
    expect(PAGES.some(p => p.startsWith('/systems/')), 'system pages are in the sweep').toBe(true);
    expect(PAGES.includes('/index.html'), 'the homepage is in the sweep').toBe(true);
});
