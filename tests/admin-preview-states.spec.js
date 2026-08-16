// Character states in the reviewer's preview (v0.14 bug-fix phase).
//
// States shipped in v0.12 and admin.html was never taught about them. The
// preview drew the base kit and offered no way to leave it, so a revision that
// edited a state rendered as *unchanged* - and a reviewer clicking Approve on
// a page where nothing appears to have changed is reviewing blind.
//
// Everything below drives the real functions in js/admin-modes.js,
// js/admin-diff.js and js/admin-preview.js against seeded page data. The
// queue's Supabase fetches are not involved: previewRevision's job is to put
// two versions in memory, and these tests start from the point where it has.
const { test, expect } = require('@playwright/test');


// Derived from js/character_tabs.js, not restated: these are the tabs
// admin.html's static strip owns, and a second copy here would go stale the
// next time one is added.
const VOCAB = (() => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'js', 'character_tabs.js'), 'utf8');
  const w = {};
  new Function('window', src)(w);
  return w;
})();
const TABS = VOCAB.getCharacterTabIds({ editableOnly: true });

const move = (id, name) => ({ id, name, startup: '5', active: '3', recovery: '12', damage: '10' });
const para = (text) => ({ type: 'paragraph', content: text });

// A character with two states, in the shape js/site_utils.js documents:
// frame_data.modes declares them, frame_data.modeData holds the non-base kits.
function twoStateCharacter() {
    return {
        frame: {
            modes: [{ id: 'base', label: 'Base Kit' }, { id: 'shrine', label: 'Malevolent Shrine' }],
            m1s: [move('m1-base', 'Base Jab')],
            skills: [move('skill-base', 'BASE SKILL NAME')],
            specials: [],
            modeData: {
                shrine: {
                    m1s: [],
                    skills: [move('skill-shrine', 'SHRINE SKILL NAME')],
                    specials: [],
                },
            },
        },
        desc: {
            profile: { name: 'Testchar', archetype: 'Rushdown', image: '' },
            playstyle: {},
            overview: [para('BASE OVERVIEW')],
            strategy: [],
            extras: [],
            matchups: [],
            counterplay: [],
            moveStrategies: {},
            modeData: {
                shrine: {
                    overview: [para('SHRINE OVERVIEW')],
                    strategy: [],
                    extras: [],
                    matchups: [],
                    counterplay: [],
                    moveStrategies: {},
                },
            },
        },
    };
}

// admin.html's RBAC gate replaces the body for a logged-out visitor, so the
// preview markup is rebuilt afterwards with the same ids and the same wiring
// the page itself uses. Waiting for the gate first matters: rebuilding before
// it runs means seeding a body it is about to replace.
async function openPreviewShell(page) {
    await page.goto('/admin.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('.access-denied-screen');

    await page.evaluate((tabs) => {
        document.body.innerHTML = `
          <div class="admin-main-pane">
            <div class="admin-live-header"></div>
            <div id="preview-mode-bar" class="character-mode-bar admin-preview-mode-bar hidden" role="tablist"></div>
            <nav id="preview-tab-nav" class="admin-preview-tab-nav">
              ${tabs.map((t, i) => `<button id="nav-${t}" class="btn-manga btn-manga-slanted${i === 0 ? ' active' : ''}"><div class="btn-manga-content"><span class="btn-manga-text">${t}</span></div></button>`).join('')}
            </nav>
            <div class="main-content-area" id="preview-content-area">
              ${tabs.map((t, i) => `<div id="tab-${t}"${i === 0 ? '' : ' class="hidden"'}></div>`).join('')}
            </div>
          </div>
        `;
        window.setupTabs('nav', 'tab', tabs, 'major');
    }, TABS);
}

// Seeds the globals previewRevision leaves behind, then runs the two pieces of
// it under test: state setup, then change detection.
async function loadRevision(page, { live, pending, rev }) {
    await page.evaluate(({ live, pending, rev }) => {
        window.activePreviewPageType = 'character';
        window.activePreviewCharId = 'testchar';
        window.activePreviewRevId = rev.id;
        window.currentQueueData = [rev];

        window.currentLiveDescData = live.desc;
        window.currentLiveFrameData = live.frame;
        window.currentPendingDescData = pending.desc;
        window.currentPendingFrameData = pending.frame;

        window.initPreviewStates(rev);
        calculateTabDiffs(rev);
    }, { live, pending, rev });
}

test('a state edit is announced when the base kit it leaves alone is what renders', async ({ page }) => {
    // The exact bug. This revision rewrites the base overview *and* a skill
    // inside the ultimate state. The reviewer opens on base, where the skill
    // change is genuinely invisible - so something has to say so.
    await openPreviewShell(page);

    const char = twoStateCharacter();
    const pending = JSON.parse(JSON.stringify(char));
    pending.desc.overview = [para('REWRITTEN BASE OVERVIEW')];
    pending.frame.modeData.shrine.skills = [move('skill-shrine', 'RENAMED SHRINE SKILL')];

    await loadRevision(page, { live: char, pending, rev: { id: 'rev-1', page_id: 'testchar', is_delta: false } });

    const state = await page.evaluate(() => ({
        changedModes: window.changedModes,
        activeMode: window.activePreviewMode,
        changedTabs: window.changedTabs,
        popupText: (document.getElementById('changed-tabs-popup') || {}).textContent || '',
    }));

    // Both states changed, so there is no single one to open on - base stays.
    expect(state.changedModes.sort()).toEqual(['base', 'shrine']);
    expect(state.activeMode).toBe(null);

    // The tab markers describe the state on screen, which is the honest claim:
    // Skills really is unchanged in the base kit.
    expect(state.changedTabs).toEqual(['overview']);

    // ...and the thing that stops the reviewer concluding that is all of it.
    expect(state.popupText).toContain('Malevolent Shrine');
    expect(state.popupText.toLowerCase()).toContain('another state');
});

test('a revision that only touches one state opens on that state', async ({ page }) => {
    await openPreviewShell(page);

    const char = twoStateCharacter();
    const pending = JSON.parse(JSON.stringify(char));
    pending.desc.modeData.shrine.overview = [para('REWRITTEN SHRINE OVERVIEW')];

    await loadRevision(page, { live: char, pending, rev: { id: 'rev-2', page_id: 'testchar', is_delta: false } });

    const state = await page.evaluate(() => ({
        activeMode: window.activePreviewMode,
        changedTabs: window.changedTabs,
        barHidden: document.getElementById('preview-mode-bar').classList.contains('hidden'),
        chips: Array.from(document.querySelectorAll('#preview-mode-bar .character-mode-chip')).map(c => ({
            id: c.dataset.modeId, text: c.textContent,
            active: c.classList.contains('active'), changed: c.classList.contains('tab-changed'),
        })),
    }));

    expect(state.activeMode, 'lands where the change is, not on the base kit').toBe('shrine');
    expect(state.changedTabs).toEqual(['overview']);
    expect(state.barHidden).toBe(false);
    expect(state.chips).toEqual([
        { id: 'base', text: 'Base Kit', active: false, changed: false },
        { id: 'shrine', text: 'Malevolent Shrine', active: true, changed: true },
    ]);
});

test('switching state redraws the preview with that state\'s moves', async ({ page }) => {
    // The interaction, not the render: click the chip a reviewer would click
    // and check the move cards underneath actually changed. A page that draws
    // a toggle it does not honour is the same bug wearing a control.
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));

    await openPreviewShell(page);

    const char = twoStateCharacter();
    await loadRevision(page, { live: char, pending: char, rev: { id: 'rev-3', page_id: 'testchar', is_delta: false } });

    await page.evaluate(async () => { await window.switchVersionView('pending'); });
    await expect(page.locator('#tab-skills')).toContainText('BASE SKILL NAME');

    await page.click('#preview-mode-bar [data-mode-id="shrine"]');
    await page.waitForFunction(() => window.activePreviewMode === 'shrine');

    await expect(page.locator('#tab-skills')).toContainText('SHRINE SKILL NAME');
    await expect(page.locator('#tab-skills'), 'the base kit must not still be on screen').not.toContainText('BASE SKILL NAME');
    await expect(page.locator('#tab-overview')).toContainText('SHRINE OVERVIEW');

    // ...and back, because a one-way toggle strands the reviewer.
    await page.click('#preview-mode-bar [data-mode-id="base"]');
    await page.waitForFunction(() => window.activePreviewMode === null);
    await expect(page.locator('#tab-skills')).toContainText('BASE SKILL NAME');

    expect(pageErrors).toEqual([]);
});

test('a state-scoped delta opens on the state it edits and marks it', async ({ page }) => {
    await openPreviewShell(page);

    const char = twoStateCharacter();
    const pending = JSON.parse(JSON.stringify(char));
    pending.desc.modeData.shrine.overview = [para('DELTA OVERVIEW')];

    await loadRevision(page, {
        live: char, pending,
        rev: {
            id: 'rev-4', page_id: 'testchar', is_delta: true,
            target_scope: 'mode', target_key: 'shrine::overview::full',
            delta_payload: [para('DELTA OVERVIEW')],
        },
    });

    const state = await page.evaluate(() => ({
        activeMode: window.activePreviewMode,
        changedModes: window.changedModes,
        changedTabs: window.changedTabs,
        markedChips: Array.from(document.querySelectorAll('#preview-mode-bar .tab-changed')).map(c => c.dataset.modeId),
    }));

    expect(state.activeMode).toBe('shrine');
    expect(state.changedModes).toEqual(['shrine']);
    expect(state.changedTabs).toEqual(['overview']);
    expect(state.markedChips).toEqual(['shrine']);
});

test('a batched ticket marks only the tabs changed in the state on screen', async ({ page }) => {
    // Marking the union across states would point a reviewer at tabs that are
    // identical in front of them. The states carry their own markers instead.
    await openPreviewShell(page);

    const char = twoStateCharacter();
    await loadRevision(page, {
        live: char, pending: char,
        rev: {
            id: 'rev-5', page_id: 'testchar', is_delta: true,
            target_scope: 'multi', target_key: 'batch',
            delta_payload: [
                { scope: 'overview', key: null, payload: [para('x')] },
                { scope: 'mode', key: 'shrine::move::skills::skill-shrine', payload: {} },
            ],
        },
    });

    const onShrine = await page.evaluate(() => ({
        activeMode: window.activePreviewMode,
        changedModes: window.changedModes.slice().sort(),
        changedTabs: window.changedTabs,
        marked: Array.from(document.querySelectorAll('#preview-tab-nav .tab-changed')).map(b => b.id),
    }));

    expect(onShrine.changedModes).toEqual(['base', 'shrine']);
    expect(onShrine.activeMode, 'a batch containing a state edit opens on that state').toBe('shrine');
    expect(onShrine.changedTabs).toEqual(['skills']);
    expect(onShrine.marked).toEqual(['nav-skills']);

    await page.click('#preview-mode-bar [data-mode-id="base"]');
    await page.waitForFunction(() => window.activePreviewMode === null);

    const onBase = await page.evaluate(() => ({
        changedTabs: window.changedTabs,
        marked: Array.from(document.querySelectorAll('#preview-tab-nav .tab-changed')).map(b => b.id),
    }));

    expect(onBase.changedTabs).toEqual(['overview']);
    expect(onBase.marked).toEqual(['nav-overview']);
});

test('a base-only character\'s Ultimate tab renders in the preview', async ({ page }) => {
    // The second half of the same blindness: ultimateAtk is a real frame-data
    // category and admin.html's static strip has no button for it, so the
    // whole tab was missing from every review.
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));

    await openPreviewShell(page);

    const live = {
        frame: { m1s: [move('m1', 'Jab')], skills: [], specials: [], ultimateAtk: [] },
        desc: { profile: { name: 'Locust', image: '' }, overview: [], strategy: [], extras: [], matchups: [], counterplay: [], moveStrategies: {} },
    };
    const pending = JSON.parse(JSON.stringify(live));
    pending.frame.ultimateAtk = [move('swarm', 'LOCUST SWARM')];

    await loadRevision(page, { live, pending, rev: { id: 'rev-6', page_id: 'testchar', is_delta: false } });
    await page.evaluate(async () => { await window.switchVersionView('pending'); });

    await expect(page.locator('#nav-ultimateAtk')).toBeVisible();
    await expect(page.locator('#preview-mode-bar'), 'no states declared, so no toggle').toBeHidden();

    const marked = await page.evaluate(() => ({
        changedTabs: window.changedTabs,
        marked: Array.from(document.querySelectorAll('#preview-tab-nav .tab-changed')).map(b => b.id),
    }));
    expect(marked.changedTabs).toEqual(['ultimateAtk']);
    expect(marked.marked).toEqual(['nav-ultimateAtk']);

    await page.click('#nav-ultimateAtk');
    await expect(page.locator('#tab-ultimateAtk')).toBeVisible();
    await expect(page.locator('#tab-ultimateAtk')).toContainText('LOCUST SWARM');

    expect(pageErrors).toEqual([]);
});

test('a revision with no ultimate gets no Ultimate tab', async ({ page }) => {
    // The tab is injected from the data, so it has to disappear again when the
    // next revision reviewed has nothing in it - a leftover button pointing at
    // a removed pane is its own small lie.
    await openPreviewShell(page);

    const withUlt = {
        frame: { m1s: [], skills: [], specials: [], ultimateAtk: [move('swarm', 'Locust Swarm')] },
        desc: { profile: { name: 'Locust', image: '' }, overview: [], strategy: [], extras: [], matchups: [], counterplay: [], moveStrategies: {} },
    };
    await loadRevision(page, { live: withUlt, pending: withUlt, rev: { id: 'rev-7', page_id: 'testchar', is_delta: false } });
    await expect(page.locator('#nav-ultimateAtk')).toHaveCount(1);

    const plain = {
        frame: { m1s: [move('m1', 'Jab')], skills: [], specials: [] },
        desc: { profile: { name: 'Plain', image: '' }, overview: [], strategy: [], extras: [], matchups: [], counterplay: [], moveStrategies: {} },
    };
    await loadRevision(page, { live: plain, pending: plain, rev: { id: 'rev-8', page_id: 'testchar', is_delta: false } });

    await expect(page.locator('#nav-ultimateAtk')).toHaveCount(0);
    await expect(page.locator('#tab-ultimateAtk')).toHaveCount(0);
});

test('a state label cannot inject markup into the toggle or the popup', async ({ page }) => {
    // State ids and labels are contributor-authored and both reach innerHTML.
    await openPreviewShell(page);

    const char = twoStateCharacter();
    char.frame.modes[1].label = '<img src=x onerror="window.__pwned=1">Shrine';

    const pending = JSON.parse(JSON.stringify(char));
    pending.desc.overview = [para('changed')];
    pending.desc.modeData.shrine.overview = [para('also changed')];

    await loadRevision(page, { live: char, pending, rev: { id: 'rev-9', page_id: 'testchar', is_delta: false } });

    const result = await page.evaluate(() => ({
        pwned: !!window.__pwned,
        barImages: document.querySelectorAll('#preview-mode-bar img').length,
        popupImages: document.querySelectorAll('#changed-tabs-popup img').length,
        chipText: document.querySelector('#preview-mode-bar [data-mode-id="shrine"]').textContent,
        popupText: (document.getElementById('changed-tabs-popup') || {}).textContent || '',
    }));

    expect(result.pwned).toBe(false);
    expect(result.barImages).toBe(0);
    expect(result.popupImages).toBe(0);
    expect(result.chipText, 'rendered as text, not parsed').toContain('<img');
    expect(result.popupText).toContain('<img');
});
