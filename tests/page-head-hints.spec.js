// v1.1 batch 9: a library a page loads from a CDN names an exact version.
//
// supabase-js was loaded as `@2` on 70 pages: jsDelivr lets browsers keep a
// range for 7 days rather than a year, and any new 2.x release reached the
// site without anyone choosing it. Pinned to 2.118.0, the version `@2` served
// on 2026-10-22 (the same bytes).
//
// (A preconnect to Supabase was tried in the same batch and taken out: the
// first query answered no sooner with it, 669 ms against 668 unthrottled and
// 2,517 against 2,495 at phone speed, medians of 6.)
//
// Reads the committed pages, which the generator keeps in step for the stubs;
// nothing here depends on owner content.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PAGES = execSync('git ls-files "*.html"', { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .map(rel => ({ rel, html: fs.readFileSync(path.join(ROOT, rel), 'utf8') }));

test('every library a page loads from a CDN names an exact version', () => {
    const loose = [];
    for (const { rel, html } of PAGES) {
        for (const [, url] of html.matchAll(/(?:src|href)="(https:\/\/(?:cdn\.jsdelivr\.net\/(?:npm|gh)|unpkg\.com)\/[^"]+)"/g)) {
            // @scope/name@x.y.z or name@x.y.z, then a path or the end.
            if (!/\/(?:@[\w.-]+\/)?[\w.-]+@\d+\.\d+\.\d+(?:\/|$)/.test(url)) loose.push(`${rel}: ${url}`);
        }
    }
    expect(PAGES.length).toBeGreaterThan(0);
    expect(loose).toEqual([]);
});

// v1.2 (owner, 2026-11-17, the performance card): the Supabase library comes
// from the site itself. Every page waited on it from a second CDN before any of
// its own code could run, and in two of 39 cold loads that wait was 3
// to 8 seconds. Served from dogslamloop.com it shares the connection every
// other script already uses.
const VENDORED = 'js/vendor/supabase-js-2.118.0.js';

test('no page loads the Supabase library from a CDN, and every page that talks to the database loads the copy on the site', () => {
    const fromCdn = [];
    const missing = [];
    for (const { rel, html } of PAGES) {
        if (/https:\/\/[^"]*supabase-js/.test(html)) fromCdn.push(rel);
        // site_utils.js makes the client, so a page that loads it needs the
        // library first.
        const utils = html.search(/src="[^"]*js\/site_utils\.js/);
        if (utils === -1) continue;
        const lib = html.indexOf(VENDORED);
        if (lib === -1 || lib > utils) missing.push(rel);
    }
    expect(fromCdn).toEqual([]);
    expect(missing, 'load the library before site_utils.js').toEqual([]);
});

test('the copy on the site is the published 2.118.0 file, unedited, with its licence', () => {
    // npm's dist/umd/supabase.js for 2.118.0, byte for byte (jsDelivr serves
    // the same bytes with a banner comment on top). A changed hash means the
    // file was edited or replaced: update it by replacing it with another
    // published version and renaming it, never by hand.
    const crypto = require('crypto');
    const body = fs.readFileSync(path.join(ROOT, VENDORED), 'utf8').replace(/\r\n/g, '\n');
    expect(crypto.createHash('sha256').update(body, 'utf8').digest('hex'))
        .toBe('ee3be8de192b97cb1d73d1e95d6b82bb1f6b658c0f97c4ef757fc331996ed3d3');

    const licence = fs.readFileSync(path.join(ROOT, 'js/vendor/supabase-js-2.118.0.LICENSE.txt'), 'utf8');
    expect(licence).toContain('MIT License');
    expect(licence).toContain('Copyright (c) 2020 Supabase');
});

test('a page makes its client from the copy on the site and asks no CDN for it', async ({ page }) => {
    const cdn = [];
    page.on('request', r => { if (/cdn\.jsdelivr\.net\/npm\/@supabase/.test(r.url())) cdn.push(r.url()); });
    const served = page.waitForResponse(r => r.url().includes(VENDORED));
    // A page of the site's own, not a character: owner content can be renamed.
    await page.goto('/terms.html', { waitUntil: 'domcontentloaded' });

    const res = await served;
    expect(res.status()).toBe(200);
    await page.waitForFunction(() => !!window.supabaseClient, null, { timeout: 15000 });
    expect(await page.evaluate(() => typeof window.supabase.createClient)).toBe('function');
    expect(cdn).toEqual([]);
});

// v1.2 (owner, 2026-11-17, the performance card): the home page's scripts are
// deferred. It is the one page with a Content-Security-Policy meta tag, and
// Chrome stops fetching ahead when it meets one, so its blocking scripts were
// fetched one at a time, each a whole trip after the last: the page was ready
// for its data at about 1.6s instead of 0.35s. A deferred script never stops
// the parser, so all of them are asked for at once. (Moving them above the tag
// was the plan; a mutation probe showed the position does not matter and
// `defer` does, so they stay below it, where the policy covers them.)
test('the home page asks for all its scripts before the first one arrives, and still boots', async ({ page, context }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    // A trip's worth of delay on every request, so one-at-a-time would show.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: -1, uploadThroughput: -1 });

    const asked = [];
    let firstArrived = Infinity;
    const own = (r) => r.resourceType() === 'script' && /\/js\//.test(r.url());
    page.on('request', r => { if (own(r)) asked.push(Date.now()); });
    page.on('requestfinished', r => { if (own(r)) firstArrived = Math.min(firstArrived, Date.now()); });

    await page.goto('/index.html', { waitUntil: 'load' });

    expect(asked.length, 'the home page loads its scripts').toBeGreaterThan(5);
    expect(Math.max(...asked), 'every script was asked for before the first one arrived').toBeLessThan(firstArrived);

    // Still boots: the scripts ran, then the boot script after them.
    await expect(page.locator('#global-sidebar-nav a').first()).toBeAttached({ timeout: 15000 });
    await expect(page.locator('#faq-dynamic-container')).not.toBeEmpty();
    expect(errors).toEqual([]);
});

test('on the home page every script is deferred and covered by the policy, and the boot script runs after them', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const policy = html.indexOf('http-equiv="Content-Security-Policy"');
    expect(policy).toBeGreaterThan(-1);

    const tags = [...html.matchAll(/<script\b[^>]*\bsrc="[^"]*"[^>]*>/g)];
    expect(tags.length).toBeGreaterThan(5);
    for (const t of tags) {
        expect(t[0], 'deferred, so it never stops the parser, and runs in order once the page is read').toMatch(/\bdefer\b/);
        expect(t.index, `${t[0]} comes after the policy, which then covers it`).toBeGreaterThan(policy);
    }
    // A plain inline script would run during parsing, before the deferred
    // ones, and add its DOMContentLoaded listener ahead of theirs.
    const inline = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>/g)].map(m => m[0]);
    expect(inline).toEqual(['<script type="module">']);
});
