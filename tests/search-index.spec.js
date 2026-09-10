// v0.19 F1a: the search index and the searchbar.
//
// The index is built by scripts/fetch-search-index.js, which does NOT walk
// desc_data itself - it calls window.collectSectionTargets, the same function
// behind the in-page link picker. That is the whole design, and it buys the
// thing these tests mostly protect: every result deep links to an anchor that
// the rendered page actually mints.
//
// The most important test in this file is the LAST one. The generator runs in
// Node, where js/pagebuilder.js cannot be evaluated, so collectSectionTargets
// falls back to its own inline copy of sectionAnchorSlug. That fallback happens
// to be character-for-character identical to pagebuilder.js's version - which
// is an ASSUMPTION, not a guarantee. If the two ever drift, every anchor in the
// committed index silently points at nothing and no other test would notice:
// the file would still be valid JSON, still the right size, still full of
// plausible-looking ids.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX_PATH = path.join(ROOT, 'data', 'search-index.json');

const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
const F = {};
index.fields.forEach((name, i) => { F[name] = i; });

// --- THE ARTIFACT ---

test('the index declares its columns, and every entry matches them', () => {
    expect(index.fields).toEqual(['title', 'tab', 'tabLabel', 'anchor', 'page', 'parent']);
    expect(index.pages.length, 'there are pages').toBeGreaterThan(0);
    expect(index.entries.length, 'there are entries').toBeGreaterThan(0);

    // Deliberately NOT an exact count. A test pinned to "982 entries" turns
    // every heading the owner writes into a red required check, and a test an
    // owner edit can break is a production outage rather than a failing test.
    for (const entry of index.entries) {
        expect(Array.isArray(entry)).toBe(true);
        expect(entry.length).toBe(index.fields.length);
    }
});

test('every entry points at a page that exists in the same file', () => {
    // The page index is a position, so an off-by-one here would silently
    // attribute every section to the wrong character.
    for (const entry of index.entries) {
        const i = entry[F.page];
        expect(Number.isInteger(i), `${entry[F.title]} has an integer page`).toBe(true);
        expect(index.pages[i], `${entry[F.title]} resolves to a page`).toBeTruthy();
    }
});

test('every page in the index is a real file in the repo', () => {
    // A result that 404s is worse than no result. fetch-search-index.js skips
    // page_data rows with no live registry entry precisely to avoid this.
    for (const page of index.pages) {
        const file = path.join(ROOT, page.url);
        expect(fs.existsSync(file), `${page.name} -> ${page.url}`).toBe(true);
    }
});

test('matchup and discussion sections are deliberately absent', () => {
    // 540 of 1,501 entries before filtering - 36%, and 492 of them "vs. <name>"
    // headings that would bury the character's own page under twenty near
    // identical rows. They belong in search.html, where results are ranked and
    // paginated. Asserted so that removing the filter is a decision rather than
    // an accident.
    const tabs = new Set(index.entries.map(e => e[F.tab]));
    expect([...tabs]).not.toContain('matchups');
    expect([...tabs]).not.toContain('page');

    // And the positive: the tabs that carry the highest-value entries are here.
    // Move names live in frame_data, so their presence also proves the
    // generator read it - an index built from desc_data alone would have no
    // skills at all, on a wiki that is mostly about skills.
    expect([...tabs], 'skills are indexed').toContain('skills');
});

test('anchors are well formed and titles are non-empty', () => {
    for (const entry of index.entries) {
        expect(String(entry[F.title]).trim().length, 'a title').toBeGreaterThan(0);
        expect(entry[F.anchor], `${entry[F.title]} has an anchor`).toMatch(/^sec-[a-z0-9-]+$/);
    }
});

// --- THE MATCHING ---

test('a page name outranks the sections that merely mention it', async ({ page }) => {
    // Typing a character's name means "take me to that character". Without the
    // page weighting, the character's own page competes on equal terms with
    // every section whose title contains their name.
    await page.goto('/index.html', { waitUntil: 'networkidle' });

    const top = await page.evaluate(async () => {
        await window.__siteSearch.loadIndex();
        return window.__siteSearch.search('boomcat').slice(0, 3).map(r => ({ kind: r.kind, name: r.name }));
    });

    expect(top.length, 'something matched').toBeGreaterThan(0);
    expect(top[0].kind, 'the page itself is first').toBe('page');
});

test('an exact title beats a prefix, which beats a match in the middle', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'networkidle' });
    const scores = await page.evaluate(() => ({
        exact: window.__siteSearch.score('Neutral', 'neutral'),
        prefix: window.__siteSearch.score('Neutral Game Notes', 'neutral'),
        word: window.__siteSearch.score('The Neutral Game', 'neutral'),
        middle: window.__siteSearch.score('Aneutralish', 'neutral'),
        none: window.__siteSearch.score('Combos', 'neutral'),
    }));

    expect(scores.exact).toBeGreaterThan(scores.prefix);
    expect(scores.prefix).toBeGreaterThan(scores.word);
    expect(scores.word).toBeGreaterThan(scores.middle);
    expect(scores.none).toBe(-1);
});

test('a one-character query returns nothing', async ({ page }) => {
    // Otherwise the first keystroke matches most of the index and the panel
    // opens on noise.
    await page.goto('/index.html', { waitUntil: 'networkidle' });
    const n = await page.evaluate(async () => {
        await window.__siteSearch.loadIndex();
        return window.__siteSearch.search('a').length;
    });
    expect(n).toBe(0);
});

// --- THE SEARCHBAR ---

test('the searchbar appears on a page that ships no markup for it', async ({ page }) => {
    // The whole point of injecting it from buildGlobalSidebarMenu: no page
    // carries this markup, and it still has to be on all of them. A generated
    // character stub is the case with the least of its own HTML.
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
    await expect(page.locator('#site-search-input')).toBeVisible();
    expect(errors).toEqual([]);
});

test('typing shows results, and clicking one navigates to its anchor', async ({ page }) => {
    // Drives the real control rather than calling search() - a panel that
    // renders but cannot be clicked is the failure this project keeps finding.
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('/index.html', { waitUntil: 'networkidle' });
    await page.click('#site-search-input');
    await page.fill('#site-search-input', 'combos');

    const panel = page.locator('#site-search-results');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.site-search-hit').first()).toBeVisible();

    const href = await panel.locator('.site-search-hit').first().getAttribute('href');
    expect(href, 'the hit is a real link').toBeTruthy();

    await panel.locator('.site-search-hit').first().click();

    // waitForURL on the PATHNAME, not networkidle. Two traps here, both hit
    // while writing this: these pages keep talking to Supabase after load
    // (discussions, alerts, the auth dock), so networkidle never settles; and
    // every page on this site is called index.html, so "the url stopped being
    // index.html" is never true. The destination's DIRECTORY is the difference.
    const target = href.replace(/^\.\//, '').split('#')[0].split('?')[0];
    await page.waitForURL(u => u.pathname.endsWith(target), { timeout: 15000 });

    expect(page.url(), 'landed on the hit, anchor included').toContain('#');
    expect(errors).toEqual([]);
});

test('the index is fetched on first use, not on page load', async ({ page }) => {
    // 83 KB of JSON parsed on every page view, for a feature most visits never
    // touch. Counted at the network boundary rather than by reading the code.
    let hits = 0;
    await page.route('**/data/search-index.json*', route => { hits += 1; route.continue(); });

    await page.goto('/index.html', { waitUntil: 'networkidle' });
    expect(hits, 'not fetched at page load').toBe(0);

    await page.click('#site-search-input');
    await expect.poll(() => hits, { timeout: 5000 }).toBe(1);

    // And a second focus reuses it rather than refetching.
    await page.click('body');
    await page.click('#site-search-input');
    await page.waitForTimeout(300);
    expect(hits, 'fetched once').toBe(1);
});

test('a hostile section title is escaped in the results panel', async ({ page }) => {
    // Section titles are contributor-authored. The generator does no escaping
    // and should not - it writes data, and the renderer escapes.
    await page.goto('/index.html', { waitUntil: 'networkidle' });

    const html = await page.evaluate(async () => {
        await window.__siteSearch.loadIndex();
        const hostile = '<img src=x onerror="window.__xss=1">';
        // Reach into the loaded index rather than the committed file, so this
        // does not depend on the owner having written something hostile.
        window.__siteSearch.loadIndex().then(() => {});
        const panel = document.getElementById('site-search-results');
        const input = document.getElementById('site-search-input');
        input.value = hostile;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return panel.innerHTML;
    });

    expect(await page.evaluate(() => window.__xss), 'no handler ran').toBeUndefined();
    expect(html).not.toContain('<img src=x');
});

// --- THE ASSUMPTION THE WHOLE INDEX RESTS ON ---

test('the Node slug and the browser slug produce identical anchors', async ({ page }) => {
    // scripts/fetch-search-index.js evaluates js/character_tabs.js in Node,
    // where js/pagebuilder.js is unavailable - so collectSectionTargets uses
    // its INLINE fallback for sectionAnchorSlug. The committed anchors are only
    // correct while that fallback and pagebuilder.js's real function agree.
    //
    // Drift here breaks every link in the index at once and looks like nothing:
    // valid JSON, right size, plausible ids, all pointing at elements that do
    // not exist.
    await page.goto('/index.html', { waitUntil: 'networkidle' });

    const samples = [
        'Neutral', 'General Strategy', 'vs. Honored One', 'Punish Combos',
        'M1 Trading', "Sukuna's Domain", 'Notes  &  Tips', '  leading spaces  ',
        'Multi--dash', 'UPPER CASE', '123 numbers', 'accents: café',
    ];

    const fromBrowser = await page.evaluate(
        list => list.map(t => window.sectionAnchorSlug(t)), samples);

    // The exact expression collectSectionTargets falls back to, read out of
    // the module rather than retyped - a retyped copy would agree with itself
    // forever and prove nothing.
    const src = fs.readFileSync(path.join(ROOT, 'js', 'character_tabs.js'), 'utf8');
    const fakeWindow = {};
    new Function('window', src)(fakeWindow);
    expect(fakeWindow.sectionAnchorSlug, 'the fallback is used, not a real one')
        .toBeUndefined();

    // Build the anchors both ways through the REAL entry point, so this tests
    // what the generator actually calls.
    const desc = { tabs: [{ tabId: 't', tabLabel: 'T', sections: samples.map(s => ({ sectionTitle: s, blocks: [] })) }] };

    // collectSectionTargets appends its synthetic STRUCTURAL_SECTIONS entry
    // ("Discussion", tab 'page') to every system page. It is not one of these
    // samples and the generator filters that tab out anyway, so it is dropped
    // here by TAB rather than by title - dropping the last element positionally
    // would quietly hide a real extra target if one were ever added.
    const nodeIds = fakeWindow.collectSectionTargets(desc, {})
        .filter(t => t.tab !== 'page')
        .map(t => t.id);

    const browserIds = fromBrowser
        .filter(Boolean)
        .map((slug, i) => ({ slug, i }));

    // Compare position by position against the browser's slugifier.
    const expected = [];
    const counts = Object.create(null);
    for (const slug of fromBrowser) {
        if (!slug) continue;
        counts[slug] = (counts[slug] || 0) + 1;
        expected.push(counts[slug] === 1 ? `sec-${slug}` : `sec-${slug}-${counts[slug]}`);
    }

    expect(browserIds.length, 'the samples produced slugs').toBeGreaterThan(0);
    expect(nodeIds).toEqual(expected);
});

test('the anchors in the index resolve on the rendered page', async ({ page }) => {
    // The claim everything else here rests on, checked against a real page
    // rather than reasoned about. collectSectionTargets is SUPPOSED to mirror
    // assignSectionAnchors' sweep of the DOM; this loads a page and asks the
    // DOM whether the ids the generator wrote are actually there.
    //
    // Scoped to one character's Overview tab: that tab is open on load, so this
    // does not depend on tab-switching machinery it is not trying to test.
    const pageIdx = index.pages.findIndex(p => p.url === 'characters/Boomcat/index.html');
    expect(pageIdx, 'Boomcat is in the index').toBeGreaterThan(-1);

    const wanted = index.entries
        .filter(e => e[F.page] === pageIdx && e[F.tab] === 'overview')
        .map(e => ({ title: e[F.title], anchor: e[F.anchor] }));

    expect(wanted.length, 'there are overview sections to check').toBeGreaterThan(0);

    await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
    // assignSectionAnchors runs after the description renders.
    await page.waitForSelector('#tab-overview .section-title, #tab-overview .strategy-title', { timeout: 10000 });

    const missing = await page.evaluate(
        list => list.filter(x => !document.getElementById(x.anchor)).map(x => `${x.title} -> #${x.anchor}`),
        wanted);

    expect(missing, 'every indexed anchor exists in the DOM').toEqual([]);
});

test('every page with a sidebar loads js/search.js', () => {
    // The searchbar is INJECTED by buildGlobalSidebarMenu, but the module has
    // to be on the page for that to do anything - and the tag lives in 17
    // hand-authored files plus three generator templates.
    //
    // Written after a rebase silently deleted all 17. The conflict was 64
    // stamped HTML files, resolving them toward the integration branch was
    // correct for 63 of them, and it also dropped a tag that nothing checked.
    // The searchbar would have vanished from every hand-authored page with a
    // green suite: no error, no console warning, just no search box.
    //
    // DERIVED, not listed. Listing the 17 would pass forever and say nothing
    // about the eighteenth page.
    const SKIP = new Set(['node_modules', '.git', 'test-results', 'playwright-report']);
    const walk = (d, out = []) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
            const f = path.join(d, e.name);
            if (e.isDirectory()) walk(f, out);
            else if (e.name.endsWith('.html')) out.push(f);
        }
        return out;
    };

    const missing = [];
    let checked = 0;

    for (const file of walk(ROOT)) {
        const src = fs.readFileSync(file, 'utf8');
        // A page that does not load site_utils.js has no sidebar machinery at
        // all; one with neither the nav container nor the generated marker
        // (owner.html, post-editor.html) genuinely has no sidebar.
        if (!/src="[^"]*js\/site_utils\.js/.test(src)) continue;
        if (!/global-sidebar-nav/.test(src) && !/GENERATED by/.test(src)) continue;

        checked += 1;
        if (!/src="[^"]*js\/search\.js/.test(src)) {
            missing.push(path.relative(ROOT, file).split(path.sep).join('/'));
        }
    }

    expect(checked, 'the sweep found pages to check').toBeGreaterThan(30);
    expect(missing, 'these pages build a sidebar but cannot search').toEqual([]);
});
