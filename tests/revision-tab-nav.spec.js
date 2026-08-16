// The reviewer workflow's navigation, on both surfaces it exists on.
//
// admin.html used to navigate a revision through a vertical list in the left
// sidebar; edit.html had no major-tab navigation at all - currentEditorTabId
// was read from ?tab= once at boot and never moved. Between them that made
// intercepting a skill revision impossible: routing dropped you on Overview
// and there was no control to leave it.
//
// Both now use the same top strip the live character page uses.
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
const CHARACTER_TABS = VOCAB.getCharacterTabIds({ editableOnly: true });

// --- admin.html ---------------------------------------------------------

test('admin: the revision tabs sit above the content, not inside the sidebar', async ({ page, request }) => {
  // Asserted against the served markup rather than the live DOM: admin.html's
  // RBAC gate replaces document.body for a logged-out visitor, so reading the
  // static structure from a loaded page is a race against it - one this test
  // lost under parallel load while passing in isolation.
  const html = await (await request.get('/admin.html')).text();
  await page.goto('about:blank');

  const layout = await page.evaluate(({ html, tabs }) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const nav = doc.getElementById('preview-tab-nav');
    const content = doc.getElementById('preview-content-area');
    const sidebar = doc.getElementById('preview-nav-sidebar');
    return {
      navExists: !!nav,
      // Structural, not pixel geometry: the strip must precede the content
      // in document order and share its parent, the way the live page's nav
      // does. An exact getBoundingClientRect comparison would be OS-dependent.
      navPrecedesContent: !!(nav && content &&
        (nav.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING)),
      navSharesParentWithContent: !!(nav && content && nav.parentElement === content.parentElement),
      navInsideSidebar: !!(nav && sidebar && sidebar.contains(nav)),
      buttonIds: tabs.map(t => !!doc.getElementById(`nav-${t}`)),
      // Same shape as the live page's nav (js/description.js, page_router.js).
      allManga: tabs.every(t => doc.getElementById(`nav-${t}`)?.classList.contains('btn-manga')),
      sidebarKeepsToc: !!(sidebar && sidebar.querySelector('#dynamic-toc')),
    };
  }, { html, tabs: CHARACTER_TABS });

  expect(layout.navExists).toBe(true);
  expect(layout.navInsideSidebar, 'the strip must not be back in the sidebar').toBe(false);
  expect(layout.navPrecedesContent).toBe(true);
  expect(layout.navSharesParentWithContent).toBe(true);
  expect(layout.buttonIds).toEqual(CHARACTER_TABS.map(() => true));
  expect(layout.allManga, 'same button shape as the live character page').toBe(true);
  expect(layout.sidebarKeepsToc, '"On This Page" is a different thing and stays').toBe(true);
});

test('admin: clicking a revision tab switches which content pane is shown', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  // admin.html's RBAC gate wipes the body for a logged-out visitor, so the
  // real click path is exercised on a rebuilt copy of the same markup with
  // the same wiring (setupTabs, js/pagebuilder.js) applied. Wait for the
  // gate to land first - it wipes asynchronously, and rebuilding before it
  // runs means clicking into a body it is about to replace.
  await page.waitForSelector('.access-denied-screen');

  await page.evaluate((tabs) => {
    document.body.innerHTML = `
      <nav id="preview-tab-nav" class="admin-preview-tab-nav">
        ${tabs.map((t, i) => `<button id="nav-${t}" class="btn-manga btn-manga-slanted${i === 0 ? ' active' : ''}"><div class="btn-manga-content"><span class="btn-manga-text">${t}</span></div></button>`).join('')}
      </nav>
      <div class="main-content-area" id="preview-content-area">
        ${tabs.map((t, i) => `<div id="tab-${t}"${i === 0 ? '' : ' class="hidden"'}>content of ${t}</div>`).join('')}
      </div>
    `;
    window.setupTabs('nav', 'tab', tabs, 'major');
  }, CHARACTER_TABS);

  // Drive the actual control the reviewer uses.
  await page.click('#nav-skills');

  const afterSkills = await page.evaluate(() => ({
    visible: Array.from(document.querySelectorAll('#preview-content-area > div'))
      .filter(d => !d.classList.contains('hidden')).map(d => d.id),
    active: Array.from(document.querySelectorAll('#preview-tab-nav .btn-manga.active')).map(b => b.id),
  }));

  expect(afterSkills.visible, 'exactly one pane visible, and it is the one clicked').toEqual(['tab-skills']);
  expect(afterSkills.active).toEqual(['nav-skills']);

  await page.click('#nav-matchups');
  const afterMatchups = await page.evaluate(() => ({
    visible: Array.from(document.querySelectorAll('#preview-content-area > div'))
      .filter(d => !d.classList.contains('hidden')).map(d => d.id),
    active: Array.from(document.querySelectorAll('#preview-tab-nav .btn-manga.active')).map(b => b.id),
  }));

  expect(afterMatchups.visible).toEqual(['tab-matchups']);
  expect(afterMatchups.active).toEqual(['nav-matchups']);
  expect(pageErrors).toEqual([]);
});

test('admin: a merged ticket marks every tab it touched, not just one', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const marked = await page.evaluate((tabs) => {
    document.body.innerHTML = `
      <nav id="preview-tab-nav" class="admin-preview-tab-nav">
        ${tabs.map(t => `<button id="nav-${t}" class="btn-manga btn-manga-slanted"><div class="btn-manga-content"><span class="btn-manga-text">${t}</span></div></button>`).join('')}
      </nav>
      <div class="main-content-area" id="preview-content-area"></div>
    `;

    // A merged ticket: one contributor's overview, one matchup, one skill.
    // Under the single-target routing this replaced there was no way to see
    // that three different tabs were involved.
    window.activePreviewPageType = 'character';
    window.currentLiveDescData = {};
    window.currentPendingDescData = {};
    calculateTabDiffs({
      is_delta: true,
      target_scope: 'multi',
      target_key: 'batch',
      delta_payload: [
        { scope: 'overview', key: null, payload: ['x'] },
        { scope: 'matchup', key: 'Sukuna', payload: { opponent: 'Sukuna' } },
        { scope: 'move', key: 'skills::skill-one', payload: {} },
      ],
    });

    return {
      changedTabs: window.changedTabs,
      markedButtons: Array.from(document.querySelectorAll('#preview-tab-nav .tab-changed')).map(b => b.id),
    };
  }, CHARACTER_TABS);

  expect(marked.changedTabs.sort()).toEqual(['matchups', 'overview', 'skills']);
  expect(marked.markedButtons.sort()).toEqual(['nav-matchups', 'nav-overview', 'nav-skills']);
});

test('admin: intercept opens the editor on the tab the reviewer is reading', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const opened = await page.evaluate(async (tabs) => {
    document.body.innerHTML = `
      <nav id="preview-tab-nav" class="admin-preview-tab-nav">
        ${tabs.map(t => `<button id="nav-${t}" class="btn-manga btn-manga-slanted"><div class="btn-manga-content"><span class="btn-manga-text">${t}</span></div></button>`).join('')}
      </nav>
    `;
    // The reviewer has navigated to Skills.
    document.getElementById('nav-skills').classList.add('active');

    let openedUrl = null;
    window.open = (url) => { openedUrl = url; return null; };
    window.adminConfirm = async () => true;

    // A merged ticket - is_delta true, but spanning several scopes, so there
    // is no single target to derive a tab from. Previously the guard was on
    // is_delta alone and a full-overwrite ticket appended no &tab= at all.
    window.activePreviewRevId = 'rev-1';
    window.currentQueueData = [{
      id: 'rev-1', page_id: 'testchar',
      is_delta: true, target_scope: 'multi', target_key: 'batch',
      delta_payload: [{ scope: 'overview', key: null, payload: [] }],
    }];

    await window.editCurrentTicket();
    return openedUrl;
  }, CHARACTER_TABS);

  expect(opened, 'lands on Skills because that is what the reviewer was reading').toContain('tab=skills');
  expect(opened).toContain('editTicket=rev-1');
  expect(opened, 'no stale move deep-link from another tab').not.toContain('move=');
});

// --- edit.html ----------------------------------------------------------

test('editor: the tab strip drives a real major-tab switch', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  await page.goto('/edit.html?char=testchar&tab=overview', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    // Establish editor state directly - the boot path needs a live session
    // and a database, neither of which this is testing.
    window.currentEditorPageType = 'character';
    window.currentEditorCharId = 'testchar';
    // The page's own boot ran first and failed to load data (no session),
    // leaving currentOverviewSection set with an empty block buffer. Clear
    // it, or the first loadOverviewSectionIntoEditor call flushes that empty
    // buffer over the seeded content before the test starts.
    window.currentOverviewSection = null;
    window.currentMatchupIndex = undefined;
    window.currentCounterplayIndex = undefined;
    window.currentEditorDescData = {
      overview: [{ type: 'text', content: 'overview block' }],
      strategy: [{ type: 'text', content: 'strategy block' }],
      extras: [],
      matchups: [{ opponent: 'Sukuna', tier: 'even', content: [{ type: 'text', content: 'matchup block' }] }],
      counterplay: [],
      moveStrategies: {},
    };
    window.currentEditorFrameData = { m1s: [], skills: [], specials: [] };

    initFullTabEditor('testchar', 'overview', window.currentEditorDescData, window.currentEditorFrameData);

    const navVisible = !document.getElementById('editor-tab-nav').classList.contains('hidden');
    const startTab = window.currentEditorTabId;
    const startActive = document.querySelector('#editor-tab-nav .btn-manga.active')?.id;

    // Drive the control.
    document.getElementById('edit-nav-matchups').click();
    await new Promise(r => setTimeout(r, 250));

    return {
      navVisible,
      startTab,
      startActive,
      endTab: window.currentEditorTabId,
      endActive: document.querySelector('#editor-tab-nav .btn-manga.active')?.id,
      // The builder pane must actually be showing the matchup editor now.
      builderHasMatchupEditor: !!document.getElementById('matchup-editor-container'),
      urlTab: new URLSearchParams(window.location.search).get('tab'),
      // Content the switch must not have damaged.
      strategy: window.currentEditorDescData.strategy,
      overview: window.currentEditorDescData.overview,
    };
  });

  expect(result.navVisible, 'character pages get the strip').toBe(true);
  expect(result.startTab).toBe('overview');
  expect(result.startActive).toBe('edit-nav-overview');

  expect(result.endTab, 'the editor actually moved tab, which it previously could not do').toBe('matchups');
  expect(result.endActive).toBe('edit-nav-matchups');
  expect(result.builderHasMatchupEditor, 'the builder rebuilt for the destination tab').toBe(true);

  // The editor boots from ?tab=, so a reload has to land where the strip says.
  expect(result.urlTab).toBe('matchups');

  expect(pageErrors).toEqual([]);
});

test('editor: switching tabs does not write one tab\'s blocks into another\'s section', async ({ page }) => {
  await page.goto('/edit.html?char=testchar&tab=overview', { waitUntil: 'networkidle' });

  // Each sub-tab loader flushes the *previous* selection's blocks into
  // desc_data on entry. Crossing a major-tab boundary with stale sub-state
  // meant arriving at Overview with currentOverviewSection still set to
  // 'strategy' and writing the matchup's blocks into descData.strategy.
  const result = await page.evaluate(async () => {
    window.currentEditorPageType = 'character';
    window.currentEditorCharId = 'testchar';
    // The page's own boot ran first and failed to load data (no session),
    // leaving currentOverviewSection set with an empty block buffer. Clear
    // it, or the first loadOverviewSectionIntoEditor call flushes that empty
    // buffer over the seeded content before the test starts.
    window.currentOverviewSection = null;
    window.currentMatchupIndex = undefined;
    window.currentCounterplayIndex = undefined;
    window.currentEditorDescData = {
      overview: [{ type: 'text', content: 'ORIGINAL OVERVIEW' }],
      strategy: [{ type: 'text', content: 'ORIGINAL STRATEGY' }],
      extras: [],
      matchups: [{ opponent: 'Sukuna', tier: 'even', content: [{ type: 'text', content: 'MATCHUP CONTENT' }] }],
      counterplay: [],
      moveStrategies: {},
    };
    window.currentEditorFrameData = { m1s: [], skills: [], specials: [] };

    // Start on Overview, select General Strategy, then leave for Matchups.
    initFullTabEditor('testchar', 'overview', window.currentEditorDescData, window.currentEditorFrameData);
    window.loadOverviewSectionIntoEditor('strategy');
    await new Promise(r => setTimeout(r, 100));

    document.getElementById('edit-nav-matchups').click();
    await new Promise(r => setTimeout(r, 250));

    // ...and come back.
    document.getElementById('edit-nav-overview').click();
    await new Promise(r => setTimeout(r, 250));

    return {
      strategy: window.currentEditorDescData.strategy,
      overview: window.currentEditorDescData.overview,
      matchupContent: window.currentEditorDescData.matchups[0].content,
    };
  });

  expect(result.strategy, 'General Strategy must not receive the matchup buffer')
    .toEqual([{ type: 'text', content: 'ORIGINAL STRATEGY' }]);
  expect(result.overview).toEqual([{ type: 'text', content: 'ORIGINAL OVERVIEW' }]);
  expect(result.matchupContent).toEqual([{ type: 'text', content: 'MATCHUP CONTENT' }]);
});

test('editor: system pages do not get a character tab strip', async ({ page }) => {
  await page.goto('/edit.html?char=testsystem&type=system', { waitUntil: 'networkidle' });

  const hidden = await page.evaluate(() => {
    window.currentEditorPageType = 'system';
    window.renderEditorTabNav('overview');
    return document.getElementById('editor-tab-nav').classList.contains('hidden');
  });

  expect(hidden, 'system builders manage their own tabs; character tabs would not exist there').toBe(true);
});
