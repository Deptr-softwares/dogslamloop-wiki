// One roster loader for every tier list (v1.1, owner's call 2026-10-20).
//
// There were three copies of loadRoster (certified lists, Free Submit, the
// tier editor), and two shipped reading `entry.image` off navigation.json,
// which carries no image on any character: old art, or nothing, until each was
// found and fixed on its own (v0.18 FT3, then one batch later). The fourth
// tier list, Create Tier List, would have been a fourth copy.
//
// Each list's own portrait test (free-submit-tier-list, tier-editor,
// certified-tier-lists) still proves its board draws the mirrored art. This
// file proves the loader they share, and that none of them grew its own again.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGE = '/privacy-policy.html';

const NAV = {
    Characters: [
        { id: 'A', name: 'Alpha', url: 'characters/Alpha/index.html', cms_config: { pageType: 'character', pageId: 'alpha', editRole: 'open' } },
        { id: 'B', name: 'Bravo', url: 'characters/Bravo/index.html', isHidden: true, cms_config: { pageType: 'character', pageId: 'bravo', editRole: 'open' } },
        { id: 'T', name: 'Template', url: 'characters/Template/index.html' },
    ],
    'System Pages': [
        { id: 'H', name: 'HUD', url: 'systems/hud/index.html', cms_config: { pageType: 'system', pageId: 'hud', editRole: 'open' } },
    ],
};
const PORTRAITS = { alpha: 'medias/portraits/alpha.webp' };

async function serve(page, { nav = NAV, portraits = PORTRAITS } = {}) {
    const state = { nav, portraits };
    await page.route('**/data/navigation.json*', route => state.nav
        ? route.fulfill({ json: state.nav })
        : route.fulfill({ status: 503, body: 'down' }));
    await page.route('**/data/portraits.json*', route => state.portraits
        ? route.fulfill({ json: state.portraits })
        : route.fulfill({ status: 404, body: 'missing' }));
    return state;
}

const read = (page) => page.evaluate(async () => {
    const roster = await window.loadCharacterRoster();
    return Array.from(roster.entries());
});

test('characters only, keyed by page id, with the mirrored portrait and the hidden flag', async ({ page }) => {
    await serve(page);
    await page.goto(PAGE);

    expect(await read(page)).toEqual([
        ['alpha', { name: 'Alpha', url: 'characters/Alpha/index.html', image: 'medias/portraits/alpha.webp', hidden: false }],
        ['bravo', { name: 'Bravo', url: 'characters/Bravo/index.html', image: undefined, hidden: true }],
    ]);
});

test('each call is its own Map, so one list cannot change another\'s', async ({ page }) => {
    await serve(page);
    await page.goto(PAGE);

    const shared = await page.evaluate(async () => {
        const a = await window.loadCharacterRoster();
        a.delete('alpha');
        const b = await window.loadCharacterRoster();
        return [a === b, b.has('alpha')];
    });
    expect(shared).toEqual([false, true]);
});

test('no portrait manifest still gives the names', async ({ page }) => {
    await serve(page, { portraits: null });
    await page.goto(PAGE);

    const roster = await read(page);
    expect(roster.map(([id, m]) => [id, m.name, m.image])).toEqual([['alpha', 'Alpha', undefined], ['bravo', 'Bravo', undefined]]);
});

test('an unreadable navigation gives an empty roster, and the next call tries again', async ({ page }) => {
    const state = await serve(page, { nav: null });
    await page.goto(PAGE);

    expect(await read(page)).toEqual([]);
    state.nav = NAV;
    expect((await read(page)).map(([id]) => id)).toEqual(['alpha', 'bravo']);
});

test('every tier list reads the shared roster, and none keeps a copy', async () => {
    const lists = ['js/certified-tier-lists.js', 'js/tools/free_submit_tier_list.js', 'js/tier-editor.js'];
    for (const file of lists) {
        const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
        expect(src, `${file} uses the shared loader`).toContain('window.loadCharacterRoster()');
        expect(src, `${file} reads the portrait manifest itself`).not.toMatch(/portraits\.json['`]/);
        expect(src, `${file} reads navigation.json itself`).not.toMatch(/navigation\.json['`]/);
    }
});
