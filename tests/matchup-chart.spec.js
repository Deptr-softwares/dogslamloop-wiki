// v0.19 F4: the matchup chart on the systems hub ("Side Dashboard").
//
// Every character against every other, coloured by the tier the ROW
// character's own page claims. The risks here are data-shaped, because the
// data is messier than it looks:
//
//   - `tier` is FREE TEXT. Read from production on 2026-09-20: 417 entries
//     across 22 pages, and one of them reads "Aerial Circling tier". A grid
//     that assumed the nine known tiers would render a hole there.
//   - Opponents are stored by NAME, not by page id, so the grid joins on a
//     string somebody typed.
//   - 266 of 417 are "Equal" and only 121 entries have any written content.
//     Most of the grid is grey and most cells link to an empty section. That
//     is the honest state of the wiki, not a bug to paper over.
//   - The chart is NOT symmetrical and must never be made so. Two character
//     pages are two people's opinions, and forcing agreement would invent a
//     rating nobody wrote.
const { test, expect } = require('@playwright/test');

const ROSTER = {
    Characters: [
        { id: 'Boomcat', name: 'Boomcat', url: 'characters/Boomcat/index.html',
          cms_config: { pageType: 'character', pageId: 'boomcat' } },
        { id: 'Vessel', name: 'Vessel', url: 'characters/Vessel/index.html',
          cms_config: { pageType: 'character', pageId: 'vessel' } },
        { id: 'Honored-One', name: 'Honored One', url: 'characters/Honored_one/index.html',
          cms_config: { pageType: 'character', pageId: 'honored_one' } },
    ],
};

const MATCHUPS = [
    { page_id: 'boomcat', matchups: [
        { opponent: 'Vessel', tier: 'Advantage', content: [] },
        { opponent: 'Honored One', tier: 'Aerial Circling tier', content: [] },
    ] },
    // Deliberately DISAGREES with Boomcat about the same pairing: Boomcat's
    // page says it beats Vessel, Vessel's page says it beats Boomcat. Both are
    // real opinions and both must render.
    { page_id: 'vessel', matchups: [
        { opponent: 'Boomcat', tier: 'Dominating', content: [] },
    ] },
    // Rates nobody - every cell in its row is "not rated".
    { page_id: 'honored_one', matchups: [] },
];

async function mockHub(page, { roster = ROSTER, matchups = MATCHUPS, fail = false } = {}) {
    await page.route('**/data/navigation.json*', route => route.fulfill({ json: roster }));

    await page.addInitScript(({ matchups, fail }) => {
        Object.defineProperty(window, 'supabase', {
            configurable: true,
            get() { return window.__lib; },
            set(lib) {
                window.__lib = lib;
                if (lib && lib.createClient && !lib.__patched) {
                    const orig = lib.createClient.bind(lib);
                    lib.createClient = (...args) => {
                        const client = orig(...args);
                        const origFrom = client.from.bind(client);

                        client.from = (table) => {
                            if (table !== 'page_data') return origFrom(table);
                            const result = fail
                                ? { data: null, error: { message: 'the database said no' } }
                                : { data: matchups, error: null };
                            const chain = {
                                select() { return chain; },
                                eq() { return chain; },
                                // buildMatchupTable awaits the chain straight
                                // after .select(); the terminology peek beside
                                // it calls .maybeSingle(). Both are supported so
                                // this mock does not break the other widget.
                                maybeSingle: async () => ({ data: null, error: null }),
                                then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
                            };
                            return chain;
                        };
                        return client;
                    };
                    lib.__patched = true;
                }
            },
        });
    }, { matchups, fail });
}

const grid = page => page.locator('#matchup-grid .matchup-grid');

test('the chart renders a cell per pairing, coloured by tier', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await mockHub(page);
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    await expect(page.locator('#matchup-section')).toBeVisible();
    await expect(grid(page)).toBeVisible();

    // Three characters, so three rows and three columns.
    await expect(grid(page).locator('tbody tr')).toHaveCount(3);
    await expect(grid(page).locator('thead .matchup-grid-col')).toHaveCount(3);

    // Read back the COMPUTED colour, not the class or the attribute: the whole
    // point of the cell is the colour a reader sees, and a style that loses to
    // something else in the cascade would still have the right markup.
    const painted = await page.locator('.matchup-grid-link').first()
        .evaluate(el => getComputedStyle(el).backgroundColor);
    expect(painted).not.toBe('rgba(0, 0, 0, 0)');

    expect(errors).toEqual([]);
});

test('an unrecognised tier still renders, keeping its own wording', async ({ page }) => {
    // "Aerial Circling tier" is real, and is in production today. It must not
    // be silently rewritten to a neighbouring difficulty - a matchup rating is
    // a claim about the game, and guessing at one is worse than showing that
    // nobody set it properly.
    await mockHub(page);
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    const odd = page.locator('.matchup-grid-link[title*="Aerial Circling tier"]');
    await expect(odd).toHaveCount(1);
    await expect(odd).toHaveAttribute('title', 'Boomcat vs Honored One: Aerial Circling tier');
});

test('the chart is not symmetrical, because the two pages disagree', async ({ page }) => {
    // The property most likely to be "fixed" by a future change. Boomcat's page
    // rates Vessel as Advantage; Vessel's page rates Boomcat as Dominating.
    // Both are somebody's written opinion and the grid reports both.
    await mockHub(page);
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    // A prefix match: the two disagree, so both cells are also Clashes and
    // their titles carry a second line naming the other side.
    await expect(page.locator('.matchup-grid-link[title^="Boomcat vs Vessel: Advantage"]')).toHaveCount(1);
    await expect(page.locator('.matchup-grid-link[title^="Vessel vs Boomcat: Dominating"]')).toHaveCount(1);
});

test('a cell links to the matchup section, not the top of the page', async ({ page }) => {
    // The anchor collectSectionTargets mints for the rendered "vs. X" heading.
    // Landing on the Matchups tab and making the reader hunt would waste the
    // one thing the grid knows that a link to the page does not.
    await mockHub(page);
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    const href = await page.locator('.matchup-grid-link[title^="Boomcat vs Vessel: Advantage"]')
        .getAttribute('href');
    expect(href).toContain('characters/Boomcat/index.html');
    expect(href).toContain('?tab=matchups');
    expect(href).toMatch(/#sec-vs-vessel$/);
});

test('a character who rates nobody gets an empty row, not a missing one', async ({ page }) => {
    // Honored One rates nobody. Dropping the row would make the grid's shape
    // depend on how much work has been done, and a reader could not tell "no
    // opinion" from "not on the roster".
    await mockHub(page);
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    // Filtered on the ROW HEADER, not on the row's text. Every cell carries an
    // sr-only label naming both characters, so `hasText: 'Honored One'` matches
    // Boomcat's row as well - which is how this test first failed, reporting a
    // duplicate row that does not exist.
    const row = grid(page).locator('tbody tr')
        .filter({ has: page.locator('.matchup-grid-row', { hasText: 'Honored One' }) });
    await expect(row).toHaveCount(1);
    // Two unrated cells plus its own diagonal.
    await expect(row.locator('.matchup-grid-cell.is-blank')).toHaveCount(2);
    await expect(row.locator('.matchup-grid-cell.is-self')).toHaveCount(1);
    await expect(row.locator('.matchup-grid-link')).toHaveCount(0);
});

test('the diagonal is blank - nobody is rated against themselves', async ({ page }) => {
    await mockHub(page);
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });
    await expect(grid(page).locator('.matchup-grid-cell.is-self')).toHaveCount(3);
});

test('the section stays hidden when nothing is rated at all', async ({ page }) => {
    // Same rule the Terminology section follows: the table of contents is built
    // from the sections that are visible, so a section rendering nothing must
    // not be in it.
    await mockHub(page, { matchups: [{ page_id: 'boomcat', matchups: [] }] });
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    await expect(page.locator('#matchup-section')).toBeHidden();
});

test('a failure explains itself rather than rendering an empty box', async ({ page }) => {
    // Rule 2 in js/dashboards.js's header. Deliberately UNLIKE the terminology
    // peek, which hides on failure: that is a sample of something one click
    // away, and this is the only place the whole grid exists, so a reader who
    // came for it should be told why it is missing.
    await mockHub(page, { fail: true });
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    await expect(page.locator('#matchup-section')).toBeVisible();
    await expect(page.locator('#matchup-grid')).toContainText('could not be loaded');
});

test('a hostile character name is escaped', async ({ page }) => {
    // Page names are owner-authored rather than contributor-authored, but they
    // reach innerHTML here like everything else, and the standard is escape at
    // every interpolation.
    const hostile = '<img src=x onerror="window.__xss=1">';
    await mockHub(page, {
        roster: { Characters: [
            { id: 'a', name: hostile, url: 'characters/A/index.html', cms_config: { pageId: 'a' } },
            { id: 'b', name: 'Normal', url: 'characters/B/index.html', cms_config: { pageId: 'b' } },
        ] },
        matchups: [{ page_id: 'a', matchups: [{ opponent: 'Normal', tier: 'Equal', content: [] }] }],
    });
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    await expect(page.locator('#matchup-section')).toBeVisible();
    expect(await page.evaluate(() => window.__xss), 'no handler ran').toBeUndefined();
    // The positive form: the name survived, escaped, rather than being dropped.
    await expect(grid(page).locator('.matchup-grid-row').first()).toContainText('<img src=x');
    expect(await page.locator('#matchup-grid img').count()).toBe(0);
});

test('the chart appears in the table of contents', async ({ page }) => {
    // It is awaited before refreshTOC for this reason. A section that renders
    // after the ToC is built is a section nobody can navigate to.
    await mockHub(page);
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    await expect(page.locator('#dynamic-toc')).toContainText('Matchup Chart', { timeout: 10000 });
});

test('at phone width the grid scrolls inside its own box, never the page', async ({ page }) => {
    // Live from v0.19 until v0.20: the hub was 639px wide at a 390px viewport.
    // The wrapper scrolled, but every cell's .sr-only label is absolutely
    // positioned and resolved against an ancestor outside it, so the labels
    // escaped its clipping and widened the page. Found by measuring the page,
    // which is the assertion here too.
    //
    // A roster wide enough to overflow a phone, every pair rated Equal both
    // ways, so no cell is a Clash: a clashing link is itself position:
    // relative and would contain its own label, hiding the bug.
    const names = Array.from({ length: 24 }, (_, i) => 'Fighter ' + String.fromCharCode(65 + i));
    const roster = { Characters: names.map(n => ({
        id: n, name: n, url: 'characters/' + n.replace(' ', '_') + '/index.html',
        cms_config: { pageType: 'character', pageId: n.replace(' ', '_').toLowerCase() },
    })) };
    const matchups = names.map(n => ({
        page_id: n.replace(' ', '_').toLowerCase(),
        matchups: names.filter(o => o !== n).map(o => ({ opponent: o, tier: 'Equal', content: [] })),
    }));
    await page.setViewportSize({ width: 390, height: 800 });
    await mockHub(page, { roster, matchups });
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });
    await expect(grid(page).locator('.matchup-grid-link')).toHaveCount(24 * 23);

    const widths = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        grid: document.querySelector('.matchup-grid').scrollWidth,
    }));
    // The grid really is wider than the phone, so the page staying narrow is
    // the wrapper doing its job and not a small fixture.
    expect(widths.grid).toBeGreaterThan(widths.viewport);
    expect(widths.page).toBeLessThanOrEqual(widths.viewport);
});

test('an opponent name that matches no character is dropped, never guessed at', async ({ page }) => {
    // Found in production on 2026-09-20: twelve pages rate "Disaster Plant"
    // while the roster says "Disaster Plants", and one page has an opponent
    // called "More pls fill this up". Thirteen entries that join to nothing.
    //
    // It is tempting to match loosely and recover the twelve. Do not: a fuzzy
    // match attaches somebody's written opinion to a character they did not
    // write it about, and a matchup rating is a claim about the game. A cell
    // that is missing is visibly missing; a cell that is wrong is invisible.
    await mockHub(page, {
        matchups: [{ page_id: 'boomcat', matchups: [
            { opponent: 'Vessel', tier: 'Equal', content: [] },
            { opponent: 'Vessell', tier: 'Dominating', content: [] },   // one letter off
            { opponent: 'vessel',  tier: 'Hopeless',   content: [] },   // wrong case
        ] }],
    });
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    // Exactly one cell in Boomcat's row is rated, and it is the exact match.
    const row = grid(page).locator('tbody tr')
        .filter({ has: page.locator('.matchup-grid-row', { hasText: 'Boomcat' }) });
    await expect(row.locator('.matchup-grid-link')).toHaveCount(1);
    await expect(row.locator('.matchup-grid-link')).toHaveAttribute('title', 'Boomcat vs Vessel: Equal');
});

// ---------------------------------------------------------------------------
// v0.20: Clashes. A pair whose two pages don't mirror each other, in the
// owner's words: "Honored One vs True Cannon is Equal but True Cannon vs
// Honored One is Hopeless, that's a clash."
//
// ANY mismatch is a Clash, one step included. The owner chose that on
// 2026-09-24 over "disagree on who wins" and "three or more steps apart", so
// the one-step pair below is the assertion that pins their decision.
//
// One pair per case the rule has to decide. The three Clashes are found in
// exactly the opposite order to their gaps (1, 3, 4), so the sort is tested,
// not roster order.
const CLASH_ROSTER = { Characters: [
    ...ROSTER.Characters,
    { id: 'True-Cannon', name: 'True Cannon', url: 'characters/True_Cannon/index.html',
      cms_config: { pageType: 'character', pageId: 'true_cannon' } },
    { id: 'Blood-Manipulator', name: 'Blood Manipulator', url: 'characters/Blood_Manipulator/index.html',
      cms_config: { pageType: 'character', pageId: 'blood_manipulator' } },
] };

const CLASH_MATCHUPS = [
    { page_id: 'boomcat', matchups: [
        // vs Extreme Disadvantage: ONE step off, and both agree Boomcat wins.
        // A Clash only under the rule the owner chose.
        { opponent: 'Vessel', tier: 'Advantage', content: [] },
        // vs Advantage: an exact mirror.
        { opponent: 'Honored One', tier: 'Disadvantage', content: [] },
        // vs Unwinnable, the v0.13 word for Hopeless: a mirror once resolved.
        { opponent: 'True Cannon', tier: 'Dominating', content: [] },
        // vs Unloseable, the v0.13 word for Dominating: a Clash three steps
        // off, and ONLY once resolved. Unresolved, the word is off the ladder
        // and would be skipped, so this is the pair that proves resolution.
        { opponent: 'Blood Manipulator', tier: 'Slight Disadvantage', content: [] },
    ] },
    { page_id: 'vessel', matchups: [
        { opponent: 'Boomcat', tier: 'Extreme Disadvantage', content: [] },
        // vs Hopeless: the owner's own example, four steps off.
        { opponent: 'Honored One', tier: 'Equal', content: [] },
        // vs wording off the ladder: nothing to mirror.
        { opponent: 'True Cannon', tier: 'Equal', content: [] },
    ] },
    { page_id: 'honored_one', matchups: [
        { opponent: 'Boomcat', tier: 'Advantage', content: [] },
        { opponent: 'Vessel', tier: 'Hopeless', content: [] },
        // Never rates True Cannon, so that pair is one-sided.
    ] },
    { page_id: 'true_cannon', matchups: [
        { opponent: 'Boomcat', tier: 'Unwinnable', content: [] },
        { opponent: 'Vessel', tier: 'Aerial Circling tier', content: [] },
        { opponent: 'Honored One', tier: 'Hopeless', content: [] },
    ] },
    { page_id: 'blood_manipulator', matchups: [
        { opponent: 'Boomcat', tier: 'Unloseable', content: [] },
    ] },
];

const mockClashes = page => mockHub(page, { roster: CLASH_ROSTER, matchups: CLASH_MATCHUPS });

// Asserts the cell exists before asserting its class, so a title that stopped
// matching fails here rather than passing a negative check on nothing.
async function expectClash(page, titleStart, isClash) {
    const cell = page.locator(`.matchup-grid-link[title^="${titleStart}"]`);
    await expect(cell).toHaveCount(1);
    if (isClash) await expect(cell).toHaveClass(/\bis-clash\b/);
    else await expect(cell).not.toHaveClass(/\bis-clash\b/);
}

test('a Clash is marked on BOTH cells of the pair, and the mark is painted', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await mockClashes(page);
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    await expectClash(page, 'Vessel vs Honored One:', true);
    await expectClash(page, 'Honored One vs Vessel:', true);
    // Three Clashes in the fixture, two cells each.
    await expect(page.locator('.matchup-grid-link.is-clash')).toHaveCount(6);

    // The corner a reader sees, read off the pseudo-element rather than the
    // class: a rule that loses in the cascade would leave the class in place.
    const corner = el => {
        const s = getComputedStyle(el, '::after');
        return { content: s.content, colour: s.borderRightColor, width: parseFloat(s.borderRightWidth) };
    };
    const marked = await page.locator('.matchup-grid-link[title^="Vessel vs Honored One:"]').evaluate(corner);
    expect(marked.content).not.toBe('none');
    expect(marked.colour).not.toBe('rgba(0, 0, 0, 0)');
    expect(marked.width).toBeGreaterThan(0);
    const plain = await page.locator('.matchup-grid-link[title^="Boomcat vs Honored One:"]').evaluate(corner);
    expect(plain.content).toBe('none');

    expect(errors).toEqual([]);
});

test('a clashing cell names the other page\'s rating too', async ({ page }) => {
    await mockClashes(page);
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    const cell = page.locator('.matchup-grid-link[title^="Vessel vs Honored One:"]');
    await expect(cell).toHaveAttribute('title',
        'Vessel vs Honored One: Equal\nClash: Honored One vs Vessel is Hopeless');
    // A screen reader gets the same two facts, as a sentence.
    await expect(cell.locator('.sr-only')).toHaveText(
        'Vessel vs Honored One: Equal. Clash: Honored One vs Vessel is Hopeless');
});

test('an exact mirror is not a Clash, including through the renamed tier words', async ({ page }) => {
    await mockClashes(page);
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    await expectClash(page, 'Boomcat vs Honored One: Disadvantage', false);
    await expectClash(page, 'Honored One vs Boomcat: Advantage', false);
    // True Cannon's page says Unwinnable. It resolves to Hopeless, which is
    // Dominating's mirror, so comparing the stored words would call this a
    // Clash that nobody wrote.
    await expectClash(page, 'Boomcat vs True Cannon: Dominating', false);
    await expectClash(page, 'True Cannon vs Boomcat: Hopeless', false);
    // The other direction, and the one that fails if resolution is skipped:
    // Unloseable is Dominating, three steps from Slight Disadvantage's mirror.
    await expectClash(page, 'Boomcat vs Blood Manipulator: Slight Disadvantage', true);
    await expectClash(page, 'Blood Manipulator vs Boomcat: Dominating', true);
});

test('a one-step difference is still a Clash (owner, 2026-09-24)', async ({ page }) => {
    // Advantage against Extreme Disadvantage: both pages agree Boomcat wins
    // and differ by one step on how much. The owner's rule is ANY mismatch,
    // and this is the pair a looser rule would drop.
    await mockClashes(page);
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    await expectClash(page, 'Boomcat vs Vessel: Advantage', true);
    await expectClash(page, 'Vessel vs Boomcat: Extreme Disadvantage', true);
});

test('a one-sided rating, or wording off the ladder, is never a Clash', async ({ page }) => {
    await mockClashes(page);
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    // Honored One never rates True Cannon: nothing to disagree with.
    await expectClash(page, 'True Cannon vs Honored One: Hopeless', false);
    // "Aerial Circling tier" has no mirror. Guessing one is the same guess
    // resolveMatchupTier refuses to make.
    await expectClash(page, 'True Cannon vs Vessel: Aerial Circling tier', false);
    await expectClash(page, 'Vessel vs True Cannon: Equal', false);
});

test('each Clash is one notice in both pages\' words, biggest gap first', async ({ page }) => {
    await mockClashes(page);
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    await expect(page.locator('.matchup-clashes > summary')).toHaveText('Clashes (3)');
    const items = page.locator('.matchup-clashes li');
    await expect(items).toHaveCount(3);
    // Found last, listed first: four steps, then three, then one.
    await expect(items.nth(0)).toHaveText(
        'Vessel vs Honored One is Equal, but Honored One vs Vessel is Hopeless.');
    await expect(items.nth(1)).toHaveText(
        'Boomcat vs Blood Manipulator is Slight Disadvantage, but Blood Manipulator vs Boomcat is Dominating.');
    await expect(items.nth(2)).toHaveText(
        'Boomcat vs Vessel is Advantage, but Vessel vs Boomcat is Extreme Disadvantage.');

    // Each tier word is painted in its own tier colour, compared against what
    // the browser resolves that colour to rather than a pinned value.
    const painted = await items.nth(0).locator('.matchup-clash-tier').evaluateAll(els => els.map(el => {
        const probe = document.createElement('span');
        probe.style.color = window.resolveMatchupTier(el.textContent).color;
        document.body.appendChild(probe);
        const want = getComputedStyle(probe).color;
        probe.remove();
        return getComputedStyle(el).color === want;
    }));
    expect(painted).toEqual([true, true]);
});

test('the notice list opens on click, and each half links to its own page', async ({ page }) => {
    await mockClashes(page);
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    const first = page.locator('.matchup-clashes li').first();
    // Collapsed by default: the grid is what the section is for.
    await expect(first).toBeHidden();
    await page.locator('.matchup-clashes > summary').click();
    await expect(first).toBeVisible();

    // Each half goes to the page that wrote it, which is where a fix is made.
    const links = first.locator('a');
    await expect(links).toHaveCount(2);
    expect(await links.nth(0).getAttribute('href'))
        .toMatch(/characters\/Vessel\/index\.html\?tab=matchups#sec-vs-honored-one$/);
    expect(await links.nth(1).getAttribute('href'))
        .toMatch(/characters\/Honored_one\/index\.html\?tab=matchups#sec-vs-vessel$/);
});

test('no Clash, no notice list and no legend entry', async ({ page }) => {
    await mockHub(page, { matchups: [
        { page_id: 'boomcat', matchups: [{ opponent: 'Vessel', tier: 'Advantage', content: [] }] },
        { page_id: 'vessel', matchups: [{ opponent: 'Boomcat', tier: 'Disadvantage', content: [] }] },
    ] });
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    // The grid rendered both ratings, so the absences below are about Clashes
    // and not about an empty section.
    await expect(grid(page).locator('.matchup-grid-link')).toHaveCount(2);
    await expect(page.locator('.matchup-grid-link.is-clash')).toHaveCount(0);
    await expect(page.locator('.matchup-clashes')).toHaveCount(0);
    await expect(page.locator('.matchup-legend-swatch.is-clash')).toHaveCount(0);
    // The tier legend itself is still there.
    await expect(page.locator('.matchup-legend')).toContainText('Dominating');
});

test('a hostile character name is escaped in a Clash notice', async ({ page }) => {
    // A notice interpolates both names twice, into text and into a link.
    const hostile = '<img src=x onerror="window.__xss=1">';
    await mockHub(page, {
        roster: { Characters: [
            { id: 'a', name: hostile, url: 'characters/A/index.html', cms_config: { pageId: 'a' } },
            { id: 'b', name: 'Normal', url: 'characters/B/index.html', cms_config: { pageId: 'b' } },
        ] },
        matchups: [
            { page_id: 'a', matchups: [{ opponent: 'Normal', tier: 'Equal', content: [] }] },
            { page_id: 'b', matchups: [{ opponent: hostile, tier: 'Hopeless', content: [] }] },
        ],
    });
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    await expect(page.locator('.matchup-clashes li')).toHaveCount(1);
    expect(await page.evaluate(() => window.__xss), 'no handler ran').toBeUndefined();
    await expect(page.locator('.matchup-clashes li')).toContainText('<img src=x');
    expect(await page.locator('#matchup-grid img').count()).toBe(0);
});
