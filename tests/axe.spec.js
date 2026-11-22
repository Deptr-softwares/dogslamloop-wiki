// Accessibility on one page of each kind, checked with axe (WCAG 2.0 to 2.2,
// levels A and AA), in the Default look at desktop size.
//
// Everything these pages read is frozen, so only a code change can change
// what axe finds: Supabase answers from here (Crow Charmer's page data from
// tests/fixtures, empty lists for the rest, no media), the generated data
// files come from tests/fixtures/axe-site.json, and site_meta.js arrives with
// its character colours swapped for the copy in that file. Text in a
// character's own colour (.sc-auto) is left out: those colours are the
// owner's content.
//
// BASELINE is what axe found when this check arrived that changes how the
// site looks, left for the UI/UX pass (C-5): low contrast and small touch
// targets. A new finding fails, and so does a listed one that is gone, so the
// list stays true. tests/accessibility.spec.js guards the v0.11 fixes.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'axe-site.json'), 'utf8'));
const CROW = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'crow-charmer-page-data.json'), 'utf8'));
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const PAGES = [
    { url: '/index.html', ready: ['#global-sidebar-nav a'] },
    { url: '/characters/Crow_charmer/index.html', ready: ['#global-sidebar-nav a', '.wiki-section', '.toc-toggle-btn'] },
    { url: '/characters/index.html', ready: ['#global-sidebar-nav a'] },
    { url: '/systems/tierlist/index.html', ready: ['#global-sidebar-nav a'] },
    { url: '/privacy-policy.html', ready: ['#global-sidebar-nav a'] },
    { url: '/edit.html?page=crow_charmer', ready: ['#editor-splitter'] },
];

const BASELINE = {
    '/index.html': [
        'color-contrast .mb-2',
        'color-contrast .site-footer-note',
        'color-contrast div > .game-info-label',
        'scrollable-region-focusable .scroll-sm',
    ],
    '/characters/Crow_charmer/index.html': [
        'color-contrast .author-badge',
        'color-contrast .combo-block > .combo-container > .is-1.combo-node.is-slotted',
        'color-contrast .combo-block > .combo-container > .is-2.combo-node.is-slotted',
        'color-contrast .combo-block > .combo-container > .is-3.combo-node.is-slotted',
        'color-contrast .combo-block > .combo-container > .is-q.combo-node.is-slotted',
        'color-contrast .combo-block > .combo-container > .is-r.combo-node.is-slotted',
        'color-contrast .is-q.combo-node.is-slotted',
        'color-contrast .is-r.combo-node.is-slotted',
        'color-contrast .site-footer-link',
        'color-contrast .site-footer-note',
        'color-contrast a',
        'color-contrast th',
        'frame-title iframe',
        'label-content-name-mismatch #btn-jump-discussion',
        'target-size a',
        'target-size li > .toc-group-row > .toc-toggle-btn',
        'target-size li > .toc-link-minor.btn-nav',
    ],
    '/characters/index.html': [
        'color-contrast .site-footer-note',
    ],
    '/systems/tierlist/index.html': [
        'color-contrast .site-footer-note',
    ],
    '/privacy-policy.html': [
        'color-contrast .site-footer-note',
    ],
    '/edit.html?page=crow_charmer': [
        'color-contrast #editor-subtitle',
        'color-contrast #overview-nav-extra-0',
        'color-contrast #overview-nav-overview',
        'color-contrast #overview-nav-playstyle',
        'color-contrast #overview-nav-profile',
        'color-contrast #overview-nav-strategy',
        'color-contrast .editor-section-banner-text',
        'frame-title iframe',
        'target-size .daw-tab-insert-btn',
        'target-size button',
    ],
};

async function freeze(page) {
    const unfrozen = [];
    await page.route(/\.supabase\.co\//, route => {
        const request = route.request();
        if (/\/storage\/v1\//.test(request.url())) return route.abort();
        // .single() and .maybeSingle() ask for one object; anything else, a list.
        const one = /vnd\.pgrst\.object/.test(request.headers()['accept'] || '');
        // Three visible posts, so the jump-to-discussion button shows its count.
        if (/\/rest\/v1\/page_discussions/.test(request.url()) && /count=exact/.test(request.headers()['prefer'] || '')) {
            return route.fulfill({
                status: 200, contentType: 'application/json', body: '[]',
                headers: { 'content-range': '*/3', 'access-control-expose-headers': 'content-range' },
            });
        }
        if (/\/rest\/v1\/page_data/.test(request.url()) && request.url().includes('page_id=eq.crow_charmer')) {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(one ? CROW : [CROW]) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: one ? 'null' : '[]' });
    });
    await page.route('**/data/*.json*', route => {
        const name = new URL(route.request().url()).pathname.split('/').pop();
        if (!(name in SITE.data)) {
            unfrozen.push(name);
            return route.abort();
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SITE.data[name]) });
    });
    await page.route('**/js/utility/site_meta.js*', async route => {
        const response = await route.fetch();
        const body = (await response.text()).replace(
            /(\/\/ --- GENERATED REGION: CHARACTER_COLORS[^\n]*\n)[\s\S]*?(\n\/\/ --- END GENERATED REGION)/,
            (_, open, close) => `${open}${SITE.characterColorsRegion}${close}`);
        return route.fulfill({ response, body });
    });
    return unfrozen;
}

// One entry per kind of element: a selector without its :nth-child() or
// attribute parts, so one more row of the same kind is the same finding.
const key = (rule, target) => `${rule} ${target.join(' ').replace(/:nth-child\(\d+\)/g, '').replace(/\[[^\]]*\]/g, '')}`;

for (const { url, ready } of PAGES) {
    test(`axe finds nothing new on ${url}`, async ({ page }) => {
        const unfrozen = await freeze(page);
        await page.goto(url, { waitUntil: 'networkidle' });
        for (const selector of ready) await expect(page.locator(selector).first()).toBeAttached();
        await page.evaluate(() => document.fonts.ready);

        const { violations } = await new AxeBuilder({ page }).withTags(TAGS).exclude('.sc-auto').analyze();
        const found = [...new Set(violations.flatMap(v => v.nodes.map(n => key(v.id, n.target))))].sort();

        expect(unfrozen, 'a page read a data file the fixture does not freeze').toEqual([]);
        const listed = [...(BASELINE[url] || [])].sort();
        expect({ new: found.filter(f => !listed.includes(f)), gone: listed.filter(f => !found.includes(f)) })
            .toEqual({ new: [], gone: [] });
    });
}
