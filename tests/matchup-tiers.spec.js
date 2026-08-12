// The matchup tier vocabulary (v0.13 items 12 and 13).
//
// Two additions - Slight Disadvantage, Slight Advantage - and two renames:
// Unwinnable becomes Hopeless, Unloseable becomes Dominating. The renames are
// a data change, because the tier string IS the stored value and the colour
// is a lookup on it. 32 live matchups used the old words.
//
// The pieces that have to hold together:
//
//   * one definition (window.MATCHUP_TIERS), read by the live page, the
//     editor preview and the editor dropdown. It used to be two colour maps
//     and a separate option array, which is how a rename half-lands.
//   * a permanent alias for the old words. page_history and
//     pending_revisions are deliberately not migrated - they record what was
//     actually submitted and approved - so old revisions replay with the old
//     words forever and must keep rendering.
//   * an unrecognised tier keeps its own wording rather than being quietly
//     rebadged as a real difficulty. One live entry reads "Aerial Circling
//     tier"; guessing which difficulty that means would invent a claim about
//     the matchup.
const { test, expect } = require('@playwright/test');

// Declared once here and asserted in both the live-page and editor-preview
// tests. If those two renderers ever drift apart, one of them fails.
const HOPELESS_COLOR = 'rgb(220, 38, 38)';
const DOMINATING_COLOR = 'rgb(34, 211, 238)';
const UNKNOWN_COLOR = 'rgb(255, 255, 255)';

const DESC = {
    overview: [], strategy: [], extras: [], counterplay: [], moveStrategies: {},
    matchups: [
        { opponent: 'Sukuna', tier: 'Unwinnable', content: [] },
        { opponent: 'Todo', tier: 'Unloseable', content: [] },
        { opponent: 'Nobara', tier: 'Slight Advantage', content: [] },
        { opponent: 'Megumi', tier: 'Slight Disadvantage', content: [] },
        { opponent: 'Crow Charmer', tier: 'Aerial Circling tier', content: [] },
    ],
};

const FRAME = { m1s: [], skills: [], specials: [] };

// The live page renders matchups inside loadPageDescriptions, which reads
// window.currentEditorDescData first - the same path the editor preview uses.
//
// Seeded before navigation, deliberately. Setting it afterwards and calling
// the renderer leaves the page's own boot still in flight, and its render
// lands on top of the seeded one - which passes in isolation and fails under
// a loaded suite. Seeding first means the boot render and this one read the
// same data, so there is no ordering to get wrong.
async function renderLive(page, desc) {
    await page.addInitScript((data) => { window.currentEditorDescData = data; }, desc);
    await page.goto('/characters/Boomcat/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => window.loadPageDescriptions('boomcat'));
}

const labels = (page) => page.locator('#tab-matchups .card-tier-label');
const colorOf = (locator) => locator.evaluate(el => getComputedStyle(el).color);

test('the vocabulary is one list, in order, with the new tiers in place', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const tiers = await page.evaluate(() => window.MATCHUP_TIERS.map(t => t.id));

    expect(tiers).toEqual([
        'Hopeless', 'Extreme Disadvantage', 'Disadvantage', 'Slight Disadvantage',
        'Equal', 'Slight Advantage', 'Advantage', 'Extreme Advantage', 'Dominating',
    ]);

    // The old words are gone from what is offered, but not from what renders.
    expect(tiers).not.toContain('Unwinnable');
    expect(tiers).not.toContain('Unloseable');
    const resolved = await page.evaluate(() => [
        window.resolveMatchupTier('Unwinnable').id,
        window.resolveMatchupTier('Unloseable').id,
        window.resolveMatchupTier(undefined).id,
    ]);
    expect(resolved).toEqual(['Hopeless', 'Dominating', 'Equal']);
});

test('a matchup stored under an old name renders under the new one', async ({ page }) => {
    // This is what makes not migrating page_history safe. Every replayed
    // revision still says "Unwinnable" in the database.
    await renderLive(page, DESC);

    await expect(labels(page).nth(0)).toHaveText('Hopeless');
    await expect(labels(page).nth(1)).toHaveText('Dominating');
    expect(await colorOf(labels(page).nth(0))).toBe(HOPELESS_COLOR);
    expect(await colorOf(labels(page).nth(1))).toBe(DOMINATING_COLOR);
});

test('the two new tiers render with their own colours, not the fallback', async ({ page }) => {
    await renderLive(page, DESC);

    await expect(labels(page).nth(2)).toHaveText('Slight Advantage');
    await expect(labels(page).nth(3)).toHaveText('Slight Disadvantage');

    // A tier the renderer does not know falls back to white. A new tier that
    // still rendered white would look fine on the page and be broken.
    expect(await colorOf(labels(page).nth(2))).not.toBe(UNKNOWN_COLOR);
    expect(await colorOf(labels(page).nth(3))).not.toBe(UNKNOWN_COLOR);
    expect(await colorOf(labels(page).nth(2))).not.toBe(await colorOf(labels(page).nth(3)));
});

test('an unrecognised tier keeps its own wording rather than being rebadged', async ({ page }) => {
    await renderLive(page, DESC);

    await expect(labels(page).nth(4)).toHaveText('Aerial Circling tier');
    expect(await colorOf(labels(page).nth(4))).toBe(UNKNOWN_COLOR);
});

test('an opponent name is escaped, not parsed as markup', async ({ page }) => {
    // Matchups are contributor-submitted, and this header interpolated both
    // the opponent and the tier straight into innerHTML.
    await renderLive(page, {
        ...DESC,
        matchups: [{ opponent: '<img src=x onerror="window.__xss=1">Gojo', tier: 'Equal', content: [] }],
    });

    await expect(page.locator('#tab-matchups .card-header-title')).toContainText('<img src=x');
    expect(await page.locator('#tab-matchups img').count()).toBe(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('the colour never comes from the stored string', async ({ page }) => {
    // The tier lands inside a style attribute, so it is whitelisted through
    // the tier table rather than escaped. A tier that closes the declaration
    // must not be able to add one.
    await renderLive(page, {
        ...DESC,
        matchups: [{ opponent: 'X', tier: 'red; position: fixed; inset: 0', content: [] }],
    });

    const label = labels(page).first();
    expect(await label.evaluate(el => getComputedStyle(el).position)).toBe('static');
    expect(await colorOf(label)).toBe(UNKNOWN_COLOR);
});

// --- EDITOR SIDE ---

async function openMatchupEditor(page, desc) {
    // Mocked: an unmocked page_data fetch lands mid-test and re-renders the
    // builder underneath the assertions.
    await page.route('**/rest/v1/page_data*', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

    // networkidle, not domcontentloaded: the editor's own boot renders the
    // preview panes from whatever it loaded, and seeding before it finishes
    // means it overwrites the seed.
    await page.goto('/edit.html?char=testchar&tab=matchups', { waitUntil: 'networkidle' });
    await page.evaluate(async ({ desc, frame }) => {
        window.currentEditorPageType = 'character';
        window.currentEditorCharId = 'testchar';
        window.currentEditorTabId = 'matchups';
        window.currentOverviewSection = null;
        window.currentMatchupIndex = undefined;
        window.originalCloudDescData = JSON.parse(JSON.stringify(desc));
        window.originalCloudFrameData = JSON.parse(JSON.stringify(frame));

        await window.initEditorModes('testchar', desc, frame);
        initFullTabEditor('testchar', 'matchups', window.currentEditorDescData, window.currentEditorFrameData);
    }, { desc: JSON.parse(JSON.stringify(desc)), frame: FRAME });
}

const tierSelect = (page) => page.locator('#matchup-editor-container select.editor-select');

test('the editor offers exactly the nine tiers', async ({ page }) => {
    await openMatchupEditor(page, DESC);
    await page.evaluate(() => window.loadMatchupIntoEditor(2));

    await expect(tierSelect(page).locator('option')).toHaveText([
        'Hopeless', 'Extreme Disadvantage', 'Disadvantage', 'Slight Disadvantage',
        'Equal', 'Slight Advantage', 'Advantage', 'Extreme Advantage', 'Dominating',
    ]);
    await expect(tierSelect(page)).toHaveValue('Slight Advantage');
});

test('a matchup stored under an old name shows the new one as selected', async ({ page }) => {
    // The trap this guards: an unresolved "Unwinnable" matches no option, so
    // the browser displays the first one - Hopeless - while the data says
    // something else, and the control only writes when touched. Here the
    // display is right because the value really did resolve.
    await openMatchupEditor(page, DESC);
    await page.evaluate(() => window.loadMatchupIntoEditor(0));

    await expect(tierSelect(page)).toHaveValue('Hopeless');
    await expect(tierSelect(page).locator('option')).toHaveCount(9);
});

test('an unrecognised tier is offered as itself, not silently corrected', async ({ page }) => {
    await openMatchupEditor(page, DESC);
    await page.evaluate(() => window.loadMatchupIntoEditor(4));

    await expect(tierSelect(page)).toHaveValue('Aerial Circling tier');
    await expect(tierSelect(page).locator('option')).toHaveCount(10);
    await expect(tierSelect(page).locator('option').first()).toHaveText('Aerial Circling tier');
});

test('an opponent name with a quote does not break out of the input', async ({ page }) => {
    await openMatchupEditor(page, {
        ...DESC,
        matchups: [{ opponent: 'Gojo" autofocus onfocus="window.__xss=1', tier: 'Equal', content: [] }],
    });
    await page.evaluate(() => window.loadMatchupIntoEditor(0));

    const input = page.locator('#matchup-editor-container input.editor-input').first();
    await expect(input).toHaveValue('Gojo" autofocus onfocus="window.__xss=1');
    expect(await input.evaluate(el => el.hasAttribute('onfocus'))).toBe(false);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('the editor preview agrees with the live page', async ({ page }) => {
    // Two renderers, one vocabulary. Asserted against the same constants the
    // live-page tests use, so a change to one side alone fails here.
    await page.route('**/rest/v1/page_data*', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.goto('/edit.html?char=testchar&tab=matchups', { waitUntil: 'networkidle' });

    await page.evaluate((desc) => {
        window.currentEditorDescData = desc;
        renderMatchupsPreview();
    }, DESC);

    await expect(labels(page).nth(0)).toHaveText('Hopeless');
    await expect(labels(page).nth(1)).toHaveText('Dominating');
    expect(await colorOf(labels(page).nth(0))).toBe(HOPELESS_COLOR);
    expect(await colorOf(labels(page).nth(1))).toBe(DOMINATING_COLOR);
    await expect(labels(page).nth(4)).toHaveText('Aerial Circling tier');
});
