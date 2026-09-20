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

    await expect(page.locator('.matchup-grid-link[title="Boomcat vs Vessel: Advantage"]')).toHaveCount(1);
    await expect(page.locator('.matchup-grid-link[title="Vessel vs Boomcat: Dominating"]')).toHaveCount(1);
});

test('a cell links to the matchup section, not the top of the page', async ({ page }) => {
    // The anchor collectSectionTargets mints for the rendered "vs. X" heading.
    // Landing on the Matchups tab and making the reader hunt would waste the
    // one thing the grid knows that a link to the page does not.
    await mockHub(page);
    await page.goto('/systems/index.html', { waitUntil: 'networkidle' });

    const href = await page.locator('.matchup-grid-link[title="Boomcat vs Vessel: Advantage"]')
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
