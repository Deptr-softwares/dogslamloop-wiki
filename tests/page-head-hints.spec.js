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
