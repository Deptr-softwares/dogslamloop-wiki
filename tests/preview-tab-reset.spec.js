// v0.16 bug 3: switching the reviewer's view throws away which tab they were on.
//
// Two owner reports, one defect. The list filed them separately - "you can't
// preview a Techs Tab in the Admin panel" and "switching views always lands on
// Overview" - and they are the same code path seen through two different tabs.
//
// What the owner saw: a merged ticket opens in Diff View on Skills, correctly,
// because Skills is one of the tabs it changed. Clicking PENDING SUBMISSION to
// see the real content leaves the strip highlighting Skills while the pane
// renders the Character Overview. The two halves of the UI disagree about where
// the reviewer is.
//
// The cause is the reset at the top of switchVersionView's pending/live branch
// (js/admin-preview.js). It hides every tab and un-hides the default, which its
// own comment describes as "restoring the same default a fresh revision load
// already starts with" - and never tells the strip. Techs is caught by the same
// loop, being `editable` in the registry, which is why it can never be
// previewed at all.
//
// EVERY TEST HERE DRIVES THE REAL switchVersionView. Asserting that some helper
// was called would prove the wiring and not the symptom, and the symptom is the
// entire report.
const { test, expect } = require('@playwright/test');

// Read from the vocabulary rather than restated, so a new tab does not silently
// fall out of coverage. Techs is optional, so it is asked for explicitly - it
// is half of what this bug broke.
const VOCAB = (() => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'js', 'character_tabs.js'), 'utf8');
  const w = {};
  new Function('window', src)(w);
  return w;
})();
VOCAB.setOptionalCharacterTabs(['techs']);
const TABS = VOCAB.getCharacterTabIds({ editableOnly: true });
const DEFAULT_TAB = VOCAB.getDefaultCharacterTabId();

const para = (text) => ({ type: 'paragraph', content: text });

function seedCharacter(marker) {
  return {
    frame: { modes: [], m1s: [], skills: [], specials: [], modeData: {} },
    desc: {
      profile: { name: 'Testchar', archetype: 'Rushdown', image: '' },
      playstyle: {}, overview: [para(`${marker} OVERVIEW`)], strategy: [], extras: [],
      matchups: [], counterplay: [], starterGuide: [],
      comboIntro: [], comboGroups: [], comboList: [],
      techIntro: [], techGroups: [], techList: [],
      moveStrategies: {}, modeData: {},
    },
  };
}

// admin.html's RBAC gate replaces the body for a logged-out visitor, so the
// preview markup is rebuilt after it runs, with the ids the real page uses.
// Same approach as tests/admin-preview-states.spec.js.
async function openPreviewShell(page) {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.access-denied-screen');

  await page.evaluate(({ tabs, defaultTab }) => {
    document.body.innerHTML = `
      <div class="admin-main-pane">
        <div id="preview-action-buttons"></div>
        <div id="page-history-container" class="hidden"></div>
        <button id="btn-view-history" class="btn-sys btn-sys-regular version-toggle-btn">PAGE HISTORY</button>
        <button id="btn-view-pending" class="btn-sys btn-sys-blue version-toggle-btn">PENDING SUBMISSION</button>
        <button id="btn-view-live" class="btn-sys btn-sys-regular version-toggle-btn">LIVE VERSION</button>
        <button id="btn-view-diff" class="btn-sys btn-sys-regular version-toggle-btn">DIFF VIEW</button>
        <div id="preview-mode-bar" class="character-mode-bar hidden" role="tablist"></div>
        <nav id="preview-tab-nav" class="admin-preview-tab-nav">
          ${tabs.map(t => `<button id="nav-${t}" class="btn-manga btn-manga-slanted${t === defaultTab ? ' active' : ''}"><div class="btn-manga-content"><span class="btn-manga-text">${t}</span></div></button>`).join('')}
        </nav>
        <div class="main-content-area" id="preview-content-area">
          ${tabs.map(t => `<div id="tab-${t}" class="tab-content${t === defaultTab ? '' : ' hidden'}"></div>`).join('')}
        </div>
      </div>
    `;
    window.setupTabs('nav', 'tab', tabs, 'major');
  }, { tabs: TABS, defaultTab: DEFAULT_TAB });
}

async function seedRevision(page) {
  await page.evaluate(({ live, pending }) => {
    window.activePreviewPageType = 'character';
    window.activePreviewCharId = 'testchar';
    window.activePreviewRevId = 'rev-1';
    window.activePreviewMode = null;
    window.currentQueueData = [{ id: 'rev-1', page_id: 'testchar', is_delta: false }];
    window.changedTabs = [];

    window.currentLiveDescData = live.desc;
    window.currentLiveFrameData = live.frame;
    window.currentPendingDescData = pending.desc;
    window.currentPendingFrameData = pending.frame;

    // The optional-tab flag the reader page gets from page_data. Without it
    // Techs is not in the vocabulary at all and the Techs case below would
    // pass for the wrong reason.
    if (window.setOptionalCharacterTabs) window.setOptionalCharacterTabs(['techs']);
  }, { live: seedCharacter('LIVE'), pending: seedCharacter('PENDING') });
}

// The single question every test here asks: does the strip agree with the pane?
async function readWhereTheReviewerIs(page) {
  return page.evaluate(() => {
    const active = document.querySelector('#preview-tab-nav .btn-manga.active');
    const shown = Array.from(document.querySelectorAll('#preview-content-area > div[id^="tab-"]'))
      .filter(el => !el.classList.contains('hidden'))
      .map(el => el.id.replace(/^tab-/, ''));
    return {
      stripSaysTab: active ? active.id.replace(/^nav-/, '') : null,
      panesShown: shown,
    };
  });
}

for (const view of ['pending', 'live']) {
  test(`switching to ${view} keeps the reviewer on the tab they were reading`, async ({ page }) => {
    await openPreviewShell(page);
    await seedRevision(page);

    // Land on Skills the way previewRevision does for a ticket that touched it.
    await page.evaluate(() => window.setActiveRevisionTab('skills'));

    const before = await readWhereTheReviewerIs(page);
    expect(before.stripSaysTab, 'setup: the strip starts on Skills').toBe('skills');
    expect(before.panesShown, 'setup: so does the pane').toEqual(['skills']);

    await page.evaluate(async (v) => { await window.switchVersionView(v); }, view);
    await page.waitForTimeout(400);

    const after = await readWhereTheReviewerIs(page);

    // The bug, stated as the reviewer experiences it. Before the fix the strip
    // still reads "skills" and the pane reads "overview".
    expect(after.panesShown, `exactly one tab is on screen after switching to ${view}`)
      .toHaveLength(1);
    expect(after.panesShown[0],
      `the strip says "${after.stripSaysTab}" but the pane is showing "${after.panesShown[0]}"`)
      .toBe(after.stripSaysTab);
    expect(after.stripSaysTab, 'and it is still the tab the reviewer chose').toBe('skills');
  });
}

test('a Techs tab can actually be previewed', async ({ page }) => {
  // The other half of the same report. Techs is `editable` in the registry, so
  // the reset loop hides it exactly like Skills - select it, switch to Pending
  // Submission, and the reviewer is looking at Overview with the strip still
  // claiming Techs.
  await openPreviewShell(page);
  await seedRevision(page);

  const known = await page.evaluate(() => !!document.getElementById('tab-techs'));
  expect(known, 'the shell has a Techs tab to preview at all').toBe(true);

  await page.evaluate(() => window.setActiveRevisionTab('techs'));
  await page.evaluate(async () => { await window.switchVersionView('pending'); });
  await page.waitForTimeout(400);

  const where = await readWhereTheReviewerIs(page);
  expect(where.panesShown).toEqual(['techs']);
  expect(where.stripSaysTab).toBe('techs');
});

test('leaving Diff View returns to the tab it was opened on', async ({ page }) => {
  // The owner's exact route: open on a changed tab in Diff View, then click
  // PENDING SUBMISSION to read the content.
  await openPreviewShell(page);
  await seedRevision(page);

  await page.evaluate(() => window.setActiveRevisionTab('skills'));
  await page.evaluate(async () => { await window.switchVersionView('diff'); });
  await page.waitForTimeout(300);

  // Diff View deliberately hides every tab and shows its own container, so the
  // strip is the only record of where the reviewer was. That is the state the
  // fix has to read.
  const inDiff = await page.evaluate(() => {
    const active = document.querySelector('#preview-tab-nav .btn-manga.active');
    const diff = document.getElementById('admin-diff-container');
    return {
      stripSaysTab: active ? active.id.replace(/^nav-/, '') : null,
      diffVisible: !!diff && !diff.classList.contains('hidden'),
    };
  });
  expect(inDiff.stripSaysTab, 'the strip remembers the tab while in Diff View').toBe('skills');
  expect(inDiff.diffVisible, 'Diff View is actually showing').toBe(true);

  await page.evaluate(async () => { await window.switchVersionView('pending'); });
  await page.waitForTimeout(400);

  const after = await readWhereTheReviewerIs(page);
  expect(after.panesShown).toEqual(['skills']);
  expect(after.stripSaysTab).toBe('skills');

  const diffGone = await page.evaluate(() => {
    const d = document.getElementById('admin-diff-container');
    return !d || d.classList.contains('hidden');
  });
  expect(diffGone, 'and the diff pane is put away').toBe(true);
});

test('a reviewer who never left the default tab still lands on it', async ({ page }) => {
  // The fix restores the tab the strip names. If the strip names the default -
  // which it does on a fresh non-delta revision - nothing should change, and
  // this is what stops the fix from being written as "never reset anything".
  await openPreviewShell(page);
  await seedRevision(page);

  await page.evaluate(async () => { await window.switchVersionView('pending'); });
  await page.waitForTimeout(400);

  const after = await readWhereTheReviewerIs(page);
  expect(after.panesShown).toEqual([DEFAULT_TAB]);
  expect(after.stripSaysTab).toBe(DEFAULT_TAB);
});
