// Protects the marked-region rewrite that makes the three hub pages' <title>
// and social metadata owner-editable.
//
// The constraint that forces this whole mechanism to exist: Discord, Twitter
// and Facebook unfurlers do not execute JavaScript. A tag injected at runtime
// by js/site_meta.js is never seen by any of them, so hub metadata cannot be
// solved the way hub prose was. And because all three pages are hand-authored
// (NEVER_TOUCH in generate-pages.js), they cannot be regenerated wholesale
// either - hence a region inside an otherwise hand-written file.
//
// The sharp edge is that a generator now owns lines inside files humans still
// edit. These tests pin that boundary: the region must be exactly replaced,
// the surrounding markup must survive untouched, and a file without markers
// must be refused rather than guessed at.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { buildRegion, replaceRegion, BEGIN, END, HUBS } = require('../scripts/generate-hub-meta.js');

const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'site_meta.json'), 'utf8'));

test('every hub page is committed in sync with site_meta.json', () => {
    for (const [hubId, hub] of Object.entries(HUBS)) {
        const current = fs.readFileSync(path.join(ROOT, hub.file), 'utf8');
        const next = replaceRegion(current, buildRegion(hubId, meta.hubs[hubId] || {}));
        expect(next, `${hub.file} has no hub-meta markers`).not.toBeNull();
        expect(next, `${hub.file} is stale - run npm run generate`).toBe(current);
    }
});

test('rewriting a region leaves the rest of the file byte-identical', () => {
    const file = path.join(ROOT, 'characters', 'index.html');
    const current = fs.readFileSync(file, 'utf8');

    const changed = replaceRegion(current, buildRegion('character-hub', {
        title: 'Something Else Entirely',
        description: 'A different description.',
    }));

    // Everything outside the region survives.
    const tail = current.slice(current.indexOf(END) + END.length);
    expect(changed.slice(changed.indexOf(END) + END.length)).toBe(tail);
    expect(changed.slice(0, changed.indexOf(BEGIN))).toBe(current.slice(0, current.indexOf(BEGIN)));

    expect(changed).toContain('Something Else Entirely');
    expect(changed).not.toContain('Every Jujutsu Shenanigans character');
});

test('a file with no markers is refused, not guessed at', () => {
    expect(replaceRegion('<html><head><title>x</title></head></html>', 'anything')).toBeNull();
    // A start marker with no end is equally unsafe: replacing to end-of-file
    // would eat the entire page.
    expect(replaceRegion(`<head>${BEGIN}<title>x</title></head>`, 'anything')).toBeNull();
});

test('rewriting is idempotent', () => {
    const file = path.join(ROOT, 'index.html');
    const current = fs.readFileSync(file, 'utf8');
    const region = buildRegion('main-hub', meta.hubs['main-hub']);

    const once = replaceRegion(current, region);
    const twice = replaceRegion(once, region);
    expect(twice).toBe(once);
});

test('the title suffix convention is preserved per hub', () => {
    // The homepage title already IS the site name; appending would read
    // "Dogslamloop Wiki | Dogslamloop Wiki". The sub-hubs carry the suffix.
    expect(buildRegion('main-hub', { title: 'Dogslamloop Wiki' }))
        .toContain('<title>Dogslamloop Wiki</title>');
    expect(buildRegion('character-hub', { title: 'Character Dashboard' }))
        .toContain('<title>Character Dashboard | Dogslamloop Wiki</title>');

    // og:title never carries the suffix on any hub - a Discord embed already
    // shows og:site_name on its own line directly above it.
    expect(buildRegion('character-hub', { title: 'Character Dashboard' }))
        .toContain('<meta property="og:title" content="Character Dashboard">');
});

test('hostile metadata cannot break out of an attribute', () => {
    const region = buildRegion('main-hub', {
        title: 'Evil"><script>alert(1)</script>',
        description: 'Also "quoted" & <dangerous>',
    });
    expect(region).not.toContain('<script>alert(1)');
    expect(region).toContain('&lt;script&gt;');
    expect(region).toContain('&quot;quoted&quot;');
});

test('served hub HTML carries the tags statically, not via JavaScript', async ({ page }) => {
    // Asserting on the DOM would pass for JS-injected tags, which unfurlers
    // never see. This reads the raw bytes off the wire instead.
    for (const hub of Object.values(HUBS)) {
        const res = await page.request.get(`/${hub.file}`);
        const html = await res.text();
        expect(html).toContain('property="og:title"');
        expect(html).toContain('property="og:description"');
        expect(html).toContain('rel="canonical"');
        expect(html).toContain(BEGIN);
    }
});
