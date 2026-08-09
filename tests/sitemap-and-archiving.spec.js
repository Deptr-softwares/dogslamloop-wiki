// Protects two v0.11 contracts that are easy to break silently.
//
// 1. sitemap.xml and robots.txt must not contradict each other. Listing a page
//    in the sitemap while disallowing it in robots.txt is the specific mistake
//    Search Console reports as an error, and neither file's own generator can
//    notice it - only a test that reads both can.
//
// 2. Archiving a page must actually archive it. Before v0.11, setting status
//    to 'archived' removed the page from every menu while its stub stayed on
//    disk serving HTTP 200 with the full original content: it never 404'd and
//    never became a tombstone, because generate-pages.js only ever read
//    navigation.json and archived rows are dropped from that file by design.
//    The tests below pin the manifest that closes that gap, and the two
//    failure modes that must refuse rather than guess.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const { buildPages, MARKER, NEVER_TOUCH } = require('../scripts/generate-pages.js');
const { buildSitemap, EXCLUDED } = require('../scripts/generate-sitemap.js');
const { buildArchived } = require('../scripts/fetch-registry.js');

const nav = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'navigation.json'), 'utf8'));

// ---------------------------------------------------------------- sitemap

test.describe('sitemap.xml', () => {
    test('is committed in sync with navigation.json', () => {
        const committed = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
        expect(buildSitemap(nav)).toBe(committed);
    });

    test('never lists a URL that robots.txt disallows', () => {
        const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
        const disallowed = [...robots.matchAll(/^Disallow:\s*(\S+)/gm)]
            .map(m => m[1])
            .filter(p => !p.includes('*'))          // wildcard rules are not literal paths
            .map(p => p.replace(/^\//, ''));

        expect(disallowed.length).toBeGreaterThan(0);   // guard against a regex that matches nothing

        const locs = [...buildSitemap(nav).matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
        for (const rule of disallowed) {
            expect(locs.some(l => l.endsWith(`/${rule}`)), `${rule} is both disallowed and listed`).toBe(false);
        }
    });

    test('lists only URLs that resolve to a real file', () => {
        const locs = [...buildSitemap(nav).matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
        expect(locs.length).toBeGreaterThan(30);

        for (const loc of locs) {
            const rel = loc.replace('https://dogslamloop.com/', '') || 'index.html';
            expect(fs.existsSync(path.join(ROOT, rel)), `${rel} is in the sitemap but not on disk`).toBe(true);
        }
    });

    test('excludes external links, which belong to another host', () => {
        const xml = buildSitemap(nav);
        expect(xml).not.toContain('github.com');
        expect(EXCLUDED.has('admin.html')).toBe(true);
    });
});

// ---------------------------------------------------------------- archiving

test.describe('archived pages get a tombstone', () => {
    const archivedFixture = {
        boomcat_old: {
            name: 'Boomcat Classic',
            url: 'characters/Boomcat_classic/index.html',
            pageType: 'character',
            hideEntryPoints: false,
        },
    };

    test('an archived page produces a tombstone stub', () => {
        const { pages, problems } = buildPages(nav, {}, archivedFixture);
        expect(problems).toEqual([]);

        const tomb = pages.find(p => p.archived);
        expect(tomb).toBeTruthy();
        expect(tomb.relPath).toBe('characters/Boomcat_classic/index.html');

        // noindex is the load-bearing tag: without it the tombstone competes
        // in search with whatever replaced the page.
        expect(tomb.html).toContain('name="robots" content="noindex, follow"');
        expect(tomb.html).toContain(MARKER);
        expect(tomb.html).toContain('Boomcat Classic');
        expect(tomb.html).toContain('../../characters/index.html');

        // A tombstone has no content to load. Booting the router and Supabase
        // to render one paragraph is only a way for it to break.
        expect(tomb.html).not.toContain('page_router.js');
        expect(tomb.html).not.toContain('supabase');
    });

    test('no manifest leaves generation exactly as it was', () => {
        const without = buildPages(nav, {}, {});
        const withEmpty = buildPages(nav, {}, undefined);
        expect(withEmpty.pages.length).toBe(without.pages.length);
        expect(without.pages.some(p => p.archived)).toBe(false);
    });

    test('refuses when a page is both archived and live', () => {
        const live = nav.Characters.find(c => !NEVER_TOUCH.has(c.url));
        const { problems } = buildPages(nav, {}, {
            [live.cms_config.pageId]: { name: live.name, url: live.url, pageType: 'character' },
        });

        expect(problems.length).toBe(1);
        expect(problems[0]).toContain('refusing to guess');
    });

    test('never tombstones a hand-authored page', () => {
        const { pages } = buildPages(nav, {}, {
            tierlist: { name: 'Tier List', url: 'systems/tierlist/index.html', pageType: 'system' },
        });
        expect(pages.some(p => p.archived)).toBe(false);
    });

    test('escapes a hostile page name into the tombstone', () => {
        const { pages } = buildPages(nav, {}, {
            evil: { name: 'Evil"><script>alert(1)</script>', url: 'characters/Evil/index.html', pageType: 'character' },
        });
        const tomb = pages.find(p => p.archived);
        expect(tomb.html).not.toContain('<script>alert(1)');
        expect(tomb.html).toContain('&lt;script&gt;');
    });
});

test.describe('the archive manifest', () => {
    test('carries only archived rows, and defaults the hide switch off', () => {
        const out = buildArchived([
            { page_id: 'a', nav_id: 'A', name: 'A', url: 'characters/A/index.html', page_type: 'character', status: 'live' },
            { page_id: 'b', nav_id: 'B', name: 'B', url: 'characters/B/index.html', page_type: 'character', status: 'draft' },
            { page_id: 'c', nav_id: 'C', name: 'C', url: 'characters/C/index.html', page_type: 'character', status: 'archived' },
        ]);

        expect(Object.keys(out)).toEqual(['c']);
        // Archiving must stay reversible on its own; scrubbing every reference
        // to a page is the heavier, opt-in decision.
        expect(out.c.hideEntryPoints).toBe(false);
    });

    test('reads the hide switch when the column is set', () => {
        const out = buildArchived([
            { page_id: 'c', nav_id: 'C', name: 'C', url: 'characters/C/index.html', page_type: 'character', status: 'archived', hide_entry_points: true },
        ]);
        expect(out.c.hideEntryPoints).toBe(true);
    });

    test('the committed manifest is valid JSON the generator can consume', () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'archived-pages.json'), 'utf8'));
        expect(typeof manifest).toBe('object');
        expect(() => buildPages(nav, {}, manifest)).not.toThrow();
    });
});
