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

// Boots admin.html as a real admin, so the REAL tab registration in
// js/admin-core.js runs. Same shape as tests/moderator-access.spec.js.
async function mockAdmin(page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (!lib || !lib.createClient || lib.__patched) return;
        lib.__patched = true;
        const orig = lib.createClient.bind(lib);
        lib.createClient = (...args) => {
          const client = orig(...args);
          client.auth.getSession = async () => ({
            data: { session: { user: { id: 'u1', email: 'admin@site.test' }, access_token: 't' } },
          });
          const origFrom = client.from.bind(client);
          client.from = (table) => {
            if (table === 'user_roles') {
              const row = { role: 'admin' };
              const chain = {
                select() { return chain; },
                eq() { return chain; },
                single: () => Promise.resolve({ data: row, error: null }),
                then(res) { return Promise.resolve({ data: [row], error: null }).then(res); },
              };
              return chain;
            }
            return origFrom(table);
          };
          return client;
        };
      },
    });
  });
}

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

test('a strip pointing at a tab this page does not have falls back, and the strip follows', async ({ page }) => {
  // The real case: a reviewer works a queue, reads a Techs tab on one
  // character, opens the next ticket for a character with Techs switched off.
  // The strip still says "techs" and there is no pane to restore, so the fix
  // falls back to the default - and has to MOVE THE STRIP, or it has recreated
  // the very disagreement it exists to prevent, just pointing the other way.
  //
  // Added after falsifying: deleting the setActiveRevisionTab call left every
  // other test in this file green, because in all of them the strip was
  // already on the right tab and never needed moving. This is the path that
  // makes that call load-bearing.
  await openPreviewShell(page);
  await seedRevision(page);

  await page.evaluate(() => window.setActiveRevisionTab('techs'));
  // The next character has no Techs tab - drop the pane, leave the strip.
  await page.evaluate(() => document.getElementById('tab-techs').remove());

  await page.evaluate(async () => { await window.switchVersionView('pending'); });
  await page.waitForTimeout(400);

  const after = await readWhereTheReviewerIs(page);
  expect(after.panesShown, 'falls back to the default pane').toEqual([DEFAULT_TAB]);
  expect(after.stripSaysTab, 'and the strip is moved to match it').toBe(DEFAULT_TAB);
});

test('the panes end up sane even when there is no strip to read', async ({ page }) => {
  // setActiveRevisionTab returns early without a strip, so the explicit sweep
  // in switchVersionView is the only thing left holding the panes together.
  //
  // Also added after falsifying: replacing that sweep with a no-op left every
  // other test green, because setActiveRevisionTab was quietly doing the same
  // work. With the strip gone it cannot, and a reviewer must not be shown two
  // tabs stacked on top of each other.
  await openPreviewShell(page);
  await seedRevision(page);

  await page.evaluate(() => {
    document.querySelectorAll('#preview-content-area > div[id^="tab-"]')
      .forEach(el => el.classList.remove('hidden'));
    document.getElementById('preview-tab-nav').remove();
  });

  await page.evaluate(async () => { await window.switchVersionView('pending'); });
  await page.waitForTimeout(400);

  const shown = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#preview-content-area > div[id^="tab-"]'))
      .filter(el => !el.classList.contains('hidden'))
      .map(el => el.id.replace(/^tab-/, '')));

  expect(shown, 'exactly one pane, and it is the default').toEqual([DEFAULT_TAB]);
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

// --- THE SECOND HALF OF THE SAME REPORT (owner, 2026-08-24) ---
//
// "It appears that the whole thing is always on? Like it is always white, and
// it always render alongside whatever changes it detected. And when the Live
// Version view is up, I can't click on Techs and see 'no techs has been
// written yet'."
//
// Different cause from everything above, same surface. The admin strip binds
// its buttons through setupTabs at BOOT, from
// `getCharacterTabIds({ editableOnly: true })` - which filters optional tabs
// by a flag that has not been fetched yet, because the flag arrives per
// revision in previewRevision. So nav-techs was never registered:
//
//   - clicking it did nothing at all,
//   - clicking any OTHER tab could not hide tab-techs, because setupTabs only
//     hides ids in its own group - hence "renders alongside", and
//   - nothing ever removed .active from it - hence "always white".
//
// js/page_boot.js already fixed exactly this on the reader page and its
// comment says so ("setupTabs never heard about them, so clicking did nothing
// at all"). The admin surface was missed.
async function bootAdminWithTechsOn(page) {
  await mockAdmin(page);
  await page.goto('/admin.html', { waitUntil: 'domcontentloaded' });

  // The real registration having run is the precondition, not the claim. Read
  // as a property rather than an attribute selector - the groupKey contains a
  // "|", which is asking for trouble inside a CSS selector for no benefit.
  await page.waitForFunction(() => {
    const b = document.getElementById('nav-overview');
    return !!b && b.dataset.tabBound === 'nav|tab';
  }, null, { timeout: 20000 });

  // What previewRevision does once it has the page row. The strip itself ships
  // hidden and is revealed when a revision opens - without that the Techs
  // button is present, un-hidden and still 0x0, so a click times out for a
  // reason that has nothing to do with the bug.
  await page.evaluate(() => {
    document.getElementById('preview-nav-sidebar').classList.remove('hidden');
    document.getElementById('preview-tab-nav').classList.remove('hidden');
    window.applyOptionalTabsFromPageRow({ tab_settings: { techs: true } });
    window.applyOptionalTabVisibility();
  });
}

const paneState = (page) => page.evaluate(() => ({
  shown: Array.from(document.querySelectorAll('#preview-content-area > div[id^="tab-"]'))
    .filter(el => !el.classList.contains('hidden')).map(el => el.id.replace(/^tab-/, '')),
  active: Array.from(document.querySelectorAll('#preview-tab-nav .btn-manga.active'))
    .map(el => el.id.replace(/^nav-/, '')),
}));

test('the Techs button in the admin strip is actually wired up', async ({ page }) => {
  await bootAdminWithTechsOn(page);

  await page.click('#nav-techs');
  await page.waitForTimeout(200);

  const after = await paneState(page);
  expect(after.shown, 'clicking Techs shows Techs and only Techs').toEqual(['techs']);
  expect(after.active, 'and marks only Techs active').toEqual(['techs']);
});

test('leaving Techs actually hides it', async ({ page }) => {
  // "It always renders alongside whatever changes it detected." An unregistered
  // tab is invisible to every other button's hide sweep, so its panel stayed on
  // screen underneath the next tab's content.
  await bootAdminWithTechsOn(page);

  await page.click('#nav-techs');
  await page.waitForTimeout(150);

  // PRECONDITION, and it is load-bearing. Without it this test passed against
  // the broken code for the worst possible reason: the first click did nothing,
  // so Techs was never on screen, so "Techs got hidden" was trivially true.
  const opened = await paneState(page);
  expect(opened.shown, 'setup: Techs is actually on screen before we leave it')
    .toEqual(['techs']);

  await page.click('#nav-combos');
  await page.waitForTimeout(200);

  const after = await paneState(page);
  expect(after.shown, 'Techs is put away when another tab is chosen').toEqual(['combos']);
  expect(after.active, 'and stops being white').toEqual(['combos']);
});
