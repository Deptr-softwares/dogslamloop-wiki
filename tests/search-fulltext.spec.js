// v0.19 F1b: the full-text index and search.html.
//
// The first test is the one that made this batch safe to do at all.
//
// F1b needed paragraph text paired with the anchor of the heading above it, and
// collectSectionTargets returns anchors but not the blocks under them. The
// choice was a second walker over desc_data - a third derivation that has to
// agree with the renderer and the picker - or an opt-in on the shared function.
// The owner chose the opt-in, which means the in-page link picker and the
// reader's table of contents now depend on a function this batch modified.
//
// So the invariant is asserted, not assumed: `{collectText: true}` may only ADD
// `text` to targets. Strip it and the two calls must be identical, over real
// content, on every page. When the extension was written this was checked
// against all 49 live pages and came back with zero differences.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FULLTEXT_PATH = path.join(ROOT, 'data', 'search-fulltext.json');

const index = JSON.parse(fs.readFileSync(FULLTEXT_PATH, 'utf8'));
const F = {};
index.fields.forEach((name, i) => { F[name] = i; });

function loadVocabulary() {
    const src = fs.readFileSync(path.join(ROOT, 'js', 'character_tabs.js'), 'utf8');
    const w = {};
    new Function('window', src)(w);
    return w;
}

// --- THE INVARIANT THE SHARED FUNCTION NOW CARRIES ---

test('collectText only adds text - it never changes the structure', () => {
    const vocab = loadVocabulary();

    // Shapes chosen to exercise every branch that mints a target: a system
    // page's tabs, a character's fixed overview fields, extras, keyed sections
    // and frame moves. A fixture rather than live content, so this test states
    // its own case instead of depending on what the owner wrote today.
    const desc = {
        overview: [
            { type: 'paragraph', content: 'Base overview prose.' },
            { type: 'heading', size: 'h3', content: 'A Subheading' },
            { type: 'paragraph', content: 'Text under the subheading.' },
        ],
        strategy: [{ type: 'paragraph', content: 'Strategy prose.' }],
        extras: [{ title: 'An Extra Tab', content: [{ type: 'heading', content: 'Extra Heading' }] }],
        matchups: [{ opponent: 'Honored One', tier: 'Equal', content: [{ type: 'paragraph', content: 'Matchup prose.' }] }],
        counterplay: [],
        moveStrategies: { m1: [{ type: 'paragraph', content: 'Move prose.' }] },
    };
    const frame = { m1s: [{ id: 'm1', name: 'Jab' }], skills: [], specials: [] };

    const plain = vocab.collectSectionTargets(desc, frame);
    const withText = vocab.collectSectionTargets(desc, frame, { collectText: true });

    const strip = (targets) => JSON.parse(JSON.stringify(targets), (key, value) => (key === 'text' ? undefined : value));

    expect(plain.length, 'the fixture produced targets').toBeGreaterThan(0);
    expect(strip(withText)).toEqual(strip(plain));

    // And the positive: it actually collected something, or the equality above
    // would be satisfied by the option doing nothing at all.
    const collected = JSON.stringify(withText).includes('Base overview prose.');
    expect(collected, 'text was actually gathered').toBe(true);
});

test('text lands on the subheading it sits under, not on the section above', () => {
    // The reason collectHeadings tracks a moving target rather than dumping
    // every string on the major section: a reader scrolling to #sec-a-subheading
    // expects the prose that follows it, and a search result that quotes the
    // paragraph above would scroll them to the wrong place.
    const vocab = loadVocabulary();
    const desc = {
        tabs: [{
            tabId: 't', tabLabel: 'T',
            sections: [{
                sectionTitle: 'Top Section',
                blocks: [
                    { type: 'paragraph', content: 'BEFORE the subheading.' },
                    { type: 'heading', size: 'h3', content: 'Inner' },
                    { type: 'paragraph', content: 'AFTER the subheading.' },
                ],
            }],
        }],
    };

    const targets = vocab.collectSectionTargets(desc, {}, { collectText: true });
    const top = targets.find(t => t.title === 'Top Section');
    const inner = (top.children || []).find(c => c.title === 'Inner');

    expect(top.text.join(' ')).toContain('BEFORE');
    expect(top.text.join(' '), 'the section does not swallow its child text').not.toContain('AFTER');
    expect(inner.text.join(' ')).toContain('AFTER');
});

test('machinery keys stay out of the text', () => {
    // A blanket "every string on the block" would index Supabase Storage URLs,
    // the word "left", and every author name. The whitelist is what keeps the
    // index readable.
    const vocab = loadVocabulary();
    const desc = {
        tabs: [{
            tabId: 't', tabLabel: 'T',
            sections: [{
                sectionTitle: 'Media',
                blocks: [{
                    type: 'image', align: 'left', folder: 'stuff', author: 'somebody',
                    src: 'https://example.test/PICTUREURL.webp',
                    caption: 'A real caption', alt: 'Alt words',
                }],
            }],
        }],
    };

    const target = vocab.collectSectionTargets(desc, {}, { collectText: true })
        .find(t => t.title === 'Media');
    const text = (target.text || []).join(' ');

    expect(text).toContain('A real caption');
    expect(text).toContain('Alt words');
    expect(text, 'no URLs').not.toContain('PICTUREURL');
    expect(text, 'no layout values').not.toContain('left');
    expect(text, 'no author names').not.toContain('somebody');
});

// --- THE ARTIFACT ---

test('the full-text index is well formed and keeps what the searchbar drops', () => {
    expect(index.fields).toEqual(['text', 'tab', 'tabLabel', 'anchor', 'page', 'section']);
    expect(index.entries.length, 'there are entries').toBeGreaterThan(0);

    for (const row of index.entries) {
        expect(row.length).toBe(index.fields.length);
        expect(String(row[F.text]).trim().length, 'text is non-empty').toBeGreaterThan(0);
        expect(row[F.anchor]).toMatch(/^sec-[a-z0-9-]+$/);
        expect(index.pages[row[F.page]], 'resolves to a page').toBeTruthy();
    }

    // The half that motivated a second index at all. Matchup prose is excluded
    // from the SEARCHBAR because 492 "vs. <Opponent>" headings are noise in a
    // typeahead - but "how do I deal with X" is among the most valuable writing
    // on the wiki, and it has to be findable somewhere.
    const tabs = new Set(index.entries.map(r => r[F.tab]));
    expect([...tabs], 'matchup prose is searchable here').toContain('matchups');
});

// --- THE PAGE ---

test('search.html finds a phrase and quotes it back with the match marked', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    // A phrase taken from the committed index rather than invented, so this
    // does not depend on the owner having written any particular sentence.
    const row = index.entries.find(r => r[F.text].length > 120);
    const word = row[F.text].split(/\s+/).find(w => w.length > 6 && /^[A-Za-z]+$/.test(w));
    expect(word, 'found a word to search for').toBeTruthy();

    await page.goto(`/search.html?q=${encodeURIComponent(word)}`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#search-page-status')).toContainText('result', { timeout: 15000 });
    await expect(page.locator('.search-page-hit').first()).toBeVisible();
    await expect(page.locator('.search-page-snippet mark').first()).toHaveText(new RegExp(word, 'i'));
    expect(errors).toEqual([]);
});

test('a result links to the section it quoted', async ({ page }) => {
    await page.goto('/search.html?q=combo', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.search-page-hit').first()).toBeVisible({ timeout: 15000 });

    const href = await page.locator('.search-page-hit-link').first().getAttribute('href');
    expect(href, 'carries a tab and an anchor').toMatch(/\?tab=[^#]+#sec-/);
});

test('typing updates the query string so a result page can be shared', async ({ page }) => {
    await page.goto('/search.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#search-page-status')).toContainText('two characters', { timeout: 15000 });

    await page.fill('#search-page-input', 'neutral');
    await expect.poll(() => page.url(), { timeout: 5000 }).toContain('q=neutral');
});

test('the sidebar index and the full-text index are both fetched here, and only here', async ({ page }) => {
    // The whole point of two files. The searchbar never pays for the 332 KB
    // one; this page pays for both because it uses both.
    const hits = { structural: 0, fulltext: 0 };
    await page.route('**/data/search-index.json*', r => { hits.structural += 1; r.continue(); });
    await page.route('**/data/search-fulltext.json*', r => { hits.fulltext += 1; r.continue(); });

    await page.goto('/index.html', { waitUntil: 'networkidle' });
    expect(hits.fulltext, 'the homepage never fetches the big one').toBe(0);

    await page.goto('/search.html?q=neutral', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => hits.fulltext, { timeout: 15000 }).toBe(1);
    expect(hits.structural, 'and it uses the small one too').toBeGreaterThan(0);
});

test('a hostile phrase in a snippet is escaped', async ({ page }) => {
    // Body text is the highest-volume contributor-authored string on the site
    // and it lands in innerHTML as a snippet.
    //
    // The first version of this test searched for a word that matches nothing,
    // so "Nothing matched" rendered and the absence of an <img> proved exactly
    // nothing. A hostile row is injected into the loaded index instead, so the
    // renderer is genuinely handed markup and asked not to run it.
    await page.goto('/search.html?q=neutral', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.search-page-hit').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(async () => {
        const data = await window.__searchPage.loadFulltext();
        const F = {};
        data.fields.forEach((n, i) => { F[n] = i; });

        const row = [];
        row[F.text] = 'Before the payload <img src=x onerror="window.__xss=1"> and after it.';
        row[F.tab] = 'overview';
        row[F.tabLabel] = 'Overview & Strategy';
        row[F.anchor] = 'sec-injected';
        row[F.page] = 0;
        row[F.section] = '<b>Hostile Section</b>';
        data.entries.unshift(row);

        window.__searchPage.render('payload');
        const box = document.getElementById('search-page-results');
        return { html: box.innerHTML, text: box.textContent };
    });

    expect(await page.evaluate(() => window.__xss), 'no handler ran').toBeUndefined();
    expect(await page.locator('.search-page-snippet img').count(), 'no element was created').toBe(0);

    // The positive form: the tag SURVIVED, escaped, rather than being stripped.
    expect(result.text, 'the reader still sees what was written').toContain('<img src=x');
    expect(result.html).toContain('&lt;img');
    expect(result.html).toContain('&lt;b&gt;Hostile Section');
});

test('the searchbar offers a way through to the full-text page', async ({ page }) => {
    // Without this link nothing on the site reaches search.html at all. It also
    // matters most on a MISS: the box deliberately does not index body text, so
    // "no pages or sections matched" is very often "the answer is in a
    // paragraph" - and the reader has no way to know that.
    await page.goto('/index.html', { waitUntil: 'networkidle' });
    await page.click('#site-search-input');
    await page.fill('#site-search-input', 'zzzznothingmatchesthis');

    const more = page.locator('.site-search-more');
    await expect(more).toBeVisible();
    await expect(more).toHaveAttribute('href', /search\.html\?q=zzzznothingmatchesthis/);

    // And it is reachable, not merely present.
    await more.click();
    await page.waitForURL(u => u.pathname.endsWith('/search.html'), { timeout: 15000 });
    await expect(page.locator('#search-page-input')).toHaveValue('zzzznothingmatchesthis');
});
