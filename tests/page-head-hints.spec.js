// v1.1 batch 9: what every page's head says about the libraries it loads.
//
// 1. A library from a CDN names an exact version. supabase-js was loaded as
//    `@2` on 70 pages: jsDelivr lets browsers keep a range for 7 days rather
//    than a year, and any new 2.x release reached the site without anyone
//    choosing it. Pinned to 2.118.0, the version `@2` served on 2026-10-22
//    (the same bytes).
// 2. A page that loads supabase-js says so early, with a preconnect to the
//    project, so the connection is opened while the scripts download rather
//    than after they run (measured: the first query started ~470 ms in).
//    `crossorigin` because the client's requests are CORS without
//    credentials, and a hint without it warms the wrong connection pool.
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
const SUPABASE_URL = /^const SUPABASE_URL = '([^']+)';$/m
    .exec(fs.readFileSync(path.join(ROOT, 'js', 'site_utils.js'), 'utf8'))[1];

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

test('every page that loads supabase-js preconnects to the project, in its head', () => {
    const loaders = PAGES.filter(p => p.html.includes('/@supabase/supabase-js@'));
    expect(loaders.length).toBeGreaterThan(0);
    const missing = [];
    for (const { rel, html } of loaders) {
        const head = html.slice(0, html.indexOf('</head>'));
        const hint = [...head.matchAll(/<link\b[^>]*>/g)].map(m => m[0])
            .find(tag => /rel="preconnect"/.test(tag) && tag.includes(`href="${SUPABASE_URL}"`));
        if (!hint || !/\scrossorigin(?:[\s=>])/.test(hint)) missing.push(rel);
    }
    expect(missing).toEqual([]);
});
