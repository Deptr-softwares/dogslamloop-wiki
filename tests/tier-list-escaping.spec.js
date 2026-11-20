// A tier list's data is contributor-submitted, and two things draw it: the
// tier list renderer (History, and the Overseer's preview of a submission) and
// the tier list editor (a reviewer editing a ticket). Every field must come out
// as text: tab ids, tier colours, changelog dates and notes. Until 2026-11-21
// the ids and colours went into attributes as written, so markup in them ran.
//
// A colour is checked rather than escaped: inside a style attribute, escaping
// stops it closing the attribute but not adding declarations of its own. So a
// real colour must still paint, and anything else must fall back to grey.
const { test, expect } = require('@playwright/test');

// Closes an attribute ("'>) before it opens elements, so it escapes a
// value="..." as well as a text node.
const PAYLOAD = '"\'><b data-pwn="1">x</b><img src=x onerror="window.__PWN=(window.__PWN||0)+1">';
const REAL_COLOR = 'hsl(120, 60%, 60%)';

const tierListData = () => ({
    tabs: [
        {
            id: `${PAYLOAD}overall`,
            label: 'Overall',
            tiers: [
                { name: 'S', color: PAYLOAD, characters: [] },
                { name: 'A', color: REAL_COLOR, characters: [] },
                { name: 'B', color: `#${PAYLOAD}`, characters: [] },
            ],
            changelog: [{ date: PAYLOAD, notes: [`</textarea>${PAYLOAD}`] }],
        },
        { id: `${PAYLOAD}matchup`, label: 'vs Boomcat', tiers: [], changelog: [] },
    ],
});

const fired = (page) => page.evaluate(() => window.__PWN || 0);
const injected = (page) => page.evaluate(() => document.querySelectorAll('img[src="x"], [data-pwn]').length);

test('the tier list renderer draws every submitted field as text', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const revision = {
        id: '00000000-0000-0000-0000-000000000001',
        page_id: 'tierlist',
        page_type: 'tierlist',
        author_id: '00000000-0000-0000-0000-000000000002',
        author_name: 'test-author',
        created_at: new Date().toISOString(),
        status: 'approved',
        is_delta: false,
        target_scope: null,
        target_key: null,
        delta_payload: null,
        qa_metadata: { reviewed_by: 'test-reviewer', changelog: 'Escaping test revision' },
        desc_data: tierListData(),
        frame_data: {},
    };
    await page.route('**/rest/v1/approved_revisions**', route => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify([revision]),
    }));

    await page.goto('/history.html?page=tierlist', { waitUntil: 'networkidle' });
    await expect(page.locator('#tier-list-ui .tier-list-row')).toHaveCount(3);
    await page.waitForTimeout(300);

    expect(await fired(page), 'no submitted markup may run').toBe(0);
    expect(await injected(page), 'no submitted markup may become an element').toBe(0);

    // The ids are kept as written: the tab switcher finds its button by id.
    const matchupBtn = page.locator('#tier-tabs-container .tier-nav-matchup-btn');
    expect(await matchupBtn.getAttribute('id')).toBe(`nav-tier-${PAYLOAD}matchup`);
    expect(await page.locator('#tier-tabs-container .tier-nav-overall-btn').getAttribute('id'))
        .toBe(`nav-tier-${PAYLOAD}overall`);
    await matchupBtn.click();
    await expect(matchupBtn).toHaveClass(/\bactive\b/);
    await page.locator('#tier-tabs-container .tier-nav-overall-btn').click();
    await expect(page.locator('#tier-list-ui .tier-list-row')).toHaveCount(3);

    // A real colour paints its row; the others get the grey.
    const rowColors = await page.$$eval('#tier-list-ui .tier-list-row-label',
        labels => labels.map(l => getComputedStyle(l).getPropertyValue('--tier-row-color').trim()));
    expect(rowColors).toEqual(['#555555', REAL_COLOR, '#555555']);

    // The changelog was already escaped here; it stays text.
    await expect(page.locator('#changelog-container .tier-changelog-date')).toHaveText(PAYLOAD);
    expect(errors).toEqual([]);
});

test('the tier list editor shows every submitted field as text', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/rest/v1/page_data**', async (route) => {
        if (!route.request().url().includes('page_id=eq.tierlist')) return route.continue();
        const row = { page_id: 'tierlist', desc_data: tierListData(), frame_data: {} };
        // .single() asks for one object, a plain select for a list.
        const wantsObject = (route.request().headers()['accept'] || '').includes('vnd.pgrst.object');
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wantsObject ? row : [row]) });
    });

    await page.goto('/edit.html?page=tierlist&type=tierlist', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.tier-editor-row')).toHaveCount(3, { timeout: 15000 });
    await page.waitForTimeout(300);

    expect(await fired(page), 'no submitted markup may run').toBe(0);
    expect(await injected(page), 'no submitted markup may become an element').toBe(0);

    // The changelog is kept as written, ready to edit.
    await expect(page.locator('.tier-changelog-date-input')).toHaveValue(PAYLOAD);
    await expect(page.locator('.tier-changelog-textarea')).toHaveValue(`</textarea>${PAYLOAD}`);

    // A real colour paints its row's edge; the others get the grey.
    const painted = await page.evaluate((real) => {
        const probe = document.createElement('div');
        document.body.appendChild(probe);
        const resolve = (c) => { probe.style.color = c; return getComputedStyle(probe).color; };
        const want = { grey: resolve('#555'), real: resolve(real) };
        probe.remove();
        const edges = [...document.querySelectorAll('.tier-editor-row')].map(r => getComputedStyle(r).borderLeftColor);
        return { want, edges };
    }, REAL_COLOR);
    expect(painted.edges).toEqual([painted.want.grey, painted.want.real, painted.want.grey]);
    expect(errors).toEqual([]);
});
