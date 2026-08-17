// Per-section deltas for system and tier list pages - v0.15 item 6b.
//
// Every system submission used to ship the whole desc_data as one
// `system_data / full` payload, so approving two tickets for one page silently
// reverted the first: each payload was a snapshot of the page as its author
// found it, and the second wrote that snapshot over the first's approved
// change. Nothing warned anyone.
//
// Gallery and tool pages were already scoped. Only system and tierlist were not.
const { test, expect } = require('@playwright/test');

// buildSystemDeltas ships with the editor, beside buildToolDeltas and
// buildGalleryDeltas. Only edit.html loads it.
const EDITOR = '/edit.html?char=m1-trading&type=system';

const LIVE = {
  tabs: [{
    tabId: 'basics', tabLabel: 'Basics',
    sections: [
      { sectionTitle: 'Intro', layout: 'full', blocks: [{ type: 'paragraph', content: 'ORIGINAL intro' }] },
      { sectionTitle: 'Advanced', layout: 'full', blocks: [{ type: 'paragraph', content: 'ORIGINAL advanced' }] },
    ],
  }],
};

const clone = (o) => JSON.parse(JSON.stringify(o));

// Applies a contributor's deltas the way the reviewer's approval does.
async function submitAndApply(page, live, edit, pageType = 'system') {
  return page.evaluate(({ live, editStr, pageType }) => {
    const local = JSON.parse(JSON.stringify(live));
    // eslint-disable-next-line no-new-func
    new Function('desc', editStr)(local);

    const deltas = window.buildSystemDeltas(local, live, pageType);
    return { deltas, local };
  }, { live, editStr: edit, pageType });
}

test('two contributors editing different sections both survive', async ({ page }) => {
  await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.buildSystemDeltas === 'function', { timeout: 15000 });

  const out = await page.evaluate((live) => {
    const alice = JSON.parse(JSON.stringify(live));
    alice.tabs[0].sections[0].blocks[0].content = 'ALICE edited the intro';

    const bob = JSON.parse(JSON.stringify(live));
    bob.tabs[0].sections[1].blocks[0].content = 'BOB edited the advanced section';

    // Each builds deltas against the page AS THEY FOUND IT - neither knows
    // about the other, which is the whole point.
    const aDeltas = window.buildSystemDeltas(alice, live, 'system');
    const bDeltas = window.buildSystemDeltas(bob, live, 'system');

    const applyAll = (state, deltas) => {
      deltas.forEach(d => { state = window.applyDeltaToData(state, {}, d.scope, d.key, d.payload).newDesc; });
      return state;
    };

    let state = JSON.parse(JSON.stringify(live));
    state = applyAll(state, aDeltas);
    const afterAlice = state.tabs[0].sections.map(s => s.blocks[0].content);
    state = applyAll(state, bDeltas);
    const afterBob = state.tabs[0].sections.map(s => s.blocks[0].content);

    return { aDeltas, bDeltas, afterAlice, afterBob };
  }, LIVE);

  // Each contributor ships only what they touched.
  expect(out.aDeltas.length, `Alice shipped: ${JSON.stringify(out.aDeltas.map(d => d.scope + ':' + d.key))}`).toBe(1);
  expect(out.aDeltas[0].scope).toBe('system_section');
  expect(out.aDeltas[0].key).toBe('basics::intro');
  expect(out.bDeltas[0].key).toBe('basics::advanced');

  expect(out.afterAlice[0]).toContain('ALICE');
  // THE BUG: this used to read "ORIGINAL intro" - Alice's approved edit gone.
  expect(out.afterBob[0], "Bob's approval must not revert Alice's approved edit").toContain('ALICE');
  expect(out.afterBob[1]).toContain('BOB');
});

test('an untouched page produces no deltas at all', async ({ page }) => {
  await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.buildSystemDeltas === 'function', { timeout: 15000 });
  const deltas = await page.evaluate((live) =>
    window.buildSystemDeltas(JSON.parse(JSON.stringify(live)), live, 'system'), LIVE);
  expect(deltas).toEqual([]);
});

test('adding and removing a section ships only that section', async ({ page }) => {
  await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.buildSystemDeltas === 'function', { timeout: 15000 });

  const out = await page.evaluate((live) => {
    const added = JSON.parse(JSON.stringify(live));
    added.tabs[0].sections.push({ sectionTitle: 'Extras', layout: 'full', blocks: [{ type: 'paragraph', content: 'new' }] });

    const removed = JSON.parse(JSON.stringify(live));
    removed.tabs[0].sections.splice(1, 1);

    const applyAll = (state, deltas) => {
      deltas.forEach(d => { state = window.applyDeltaToData(state, {}, d.scope, d.key, d.payload).newDesc; });
      return state;
    };

    const addDeltas = window.buildSystemDeltas(added, live, 'system');
    const remDeltas = window.buildSystemDeltas(removed, live, 'system');

    return {
      addDeltas,
      remDeltas,
      afterAdd: applyAll(JSON.parse(JSON.stringify(live)), addDeltas).tabs[0].sections.map(s => s.sectionTitle),
      afterRemove: applyAll(JSON.parse(JSON.stringify(live)), remDeltas).tabs[0].sections.map(s => s.sectionTitle),
    };
  }, LIVE);

  expect(out.afterAdd).toEqual(['Intro', 'Advanced', 'Extras']);
  expect(out.afterRemove).toEqual(['Intro']);
  // The removal is an explicit null payload, not an absence - an absence is
  // indistinguishable from "this contributor did not touch it".
  const removal = out.remDeltas.find(d => d.scope === 'system_section' && d.payload === null);
  expect(removal, 'a deleted section must ship as an explicit null').toBeTruthy();
  expect(removal.key).toBe('basics::advanced');
});

test('two sections with the same title stay distinct', async ({ page }) => {
  await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.buildSystemDeltas === 'function', { timeout: 15000 });

  const out = await page.evaluate(() => {
    const live = { tabs: [{ tabId: 'notes', tabLabel: 'Notes', sections: [
      { sectionTitle: 'Notes', blocks: [{ type: 'paragraph', content: 'first' }] },
      { sectionTitle: 'Notes', blocks: [{ type: 'paragraph', content: 'second' }] },
    ] }] };

    const edited = JSON.parse(JSON.stringify(live));
    edited.tabs[0].sections[1].blocks[0].content = 'SECOND EDITED';

    const deltas = window.buildSystemDeltas(edited, live, 'system');
    let state = JSON.parse(JSON.stringify(live));
    deltas.forEach(d => { state = window.applyDeltaToData(state, {}, d.scope, d.key, d.payload).newDesc; });

    return { keys: deltas.map(d => d.key), result: state.tabs[0].sections.map(s => s.blocks[0].content) };
  });

  // Editing the second must not overwrite the first.
  expect(out.result).toEqual(['first', 'SECOND EDITED']);
  expect(out.keys).toEqual(['notes::notes-2']);
});

test('renaming a tab does not resend its sections', async ({ page }) => {
  await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.buildSystemDeltas === 'function', { timeout: 15000 });

  const deltas = await page.evaluate((live) => {
    // Renaming through the real editor path, so the test exercises whatever
    // updateSystemMeta actually does to tabId rather than a guess about it.
    window.currentEditorDescData = JSON.parse(JSON.stringify(live));
    window.originalCloudDescData = JSON.parse(JSON.stringify(live));
    window.currentSystemTabIdx = 0;
    window.currentSystemSecIdx = 0;
    window.updateSystemMeta('tabLabel', 'The Basics');

    return {
      deltas: window.buildSystemDeltas(window.currentEditorDescData, live, 'system'),
      tabId: window.currentEditorDescData.tabs[0].tabId,
    };
  }, LIVE);

  // A tab that already exists keeps its id, so a rename is one metadata delta
  // and nothing else. Re-slugging the id on rename changed the tab's identity,
  // which forced every section underneath it to be re-sent - and a re-sent
  // section carries the contributor's copy of prose somebody else may have
  // edited since. That is the whole-document bug one level down.
  expect(deltas.tabId, 'an established tab keeps its id through a rename').toBe('basics');

  const sectionDeltas = deltas.deltas.filter(d => d.scope === 'system_section');
  expect(sectionDeltas.map(d => d.key), 'a tab rename must not touch section content')
    .toEqual([]);

  const tabDeltas = deltas.deltas.filter(d => d.scope === 'system_tab');
  expect(tabDeltas.length, 'exactly one metadata delta').toBe(1);
  expect(tabDeltas[0].payload.tabLabel).toBe('The Basics');
});

test('a tier list ships its tiers per tab, not per tier', async ({ page }) => {
  await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.buildSystemDeltas === 'function', { timeout: 15000 });

  const out = await page.evaluate(() => {
    const live = { tabs: [
      { tabId: 's1', tabLabel: 'Season 1', tiers: [{ name: 'S', characters: ['Vessel'] }, { name: 'A', characters: ['Boomcat'] }], changelog: [] },
      { tabId: 's2', tabLabel: 'Season 2', tiers: [{ name: 'S', characters: [] }], changelog: [] },
    ] };

    // Moving a character between tiers touches two tiers at once. Split per
    // tier, that one ordinary edit would look like two conflicting changes.
    const edited = JSON.parse(JSON.stringify(live));
    edited.tabs[0].tiers[0].characters.push('Boomcat');
    edited.tabs[0].tiers[1].characters = [];

    const deltas = window.buildSystemDeltas(edited, live, 'tierlist');
    let state = JSON.parse(JSON.stringify(live));
    deltas.forEach(d => { state = window.applyDeltaToData(state, {}, d.scope, d.key, d.payload).newDesc; });

    return { deltas, tiers: state.tabs[0].tiers, untouched: state.tabs[1].tiers };
  });

  const tierDeltas = out.deltas.filter(d => d.scope === 'tierlist_tiers');
  expect(tierDeltas.length, 'one delta for the edited tab only').toBe(1);
  expect(tierDeltas[0].key).toBe('s1');
  expect(out.tiers[0].characters).toEqual(['Vessel', 'Boomcat']);
  expect(out.tiers[1].characters).toEqual([]);
  expect(out.untouched[0].characters).toEqual([]);
});

test('old system_data tickets still apply', async ({ page }) => {
  await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.buildSystemDeltas === 'function', { timeout: 15000 });

  // Tickets submitted before these scopes existed are still in the queue and
  // have to stay reviewable and applicable.
  const out = await page.evaluate((live) => {
    const legacy = JSON.parse(JSON.stringify(live));
    legacy.tabs[0].sections[0].blocks[0].content = 'LEGACY TICKET';
    return window.applyDeltaToData(live, {}, 'system_data', 'full', legacy).newDesc;
  }, LIVE);

  expect(out.tabs[0].sections[0].blocks[0].content).toBe('LEGACY TICKET');
});

// --- THE REVIEWER SIDE ---

async function renderSystemScope(page, scope, key, payload, live) {
  return page.evaluate(async ({ scope, key, payload, live }) => {
    document.body.innerHTML = `<div class="main-content-area"></div>`;
    const rev = {
      id: 'sd', page_id: 'm1-trading', page_type: 'system', is_delta: true,
      target_scope: scope, target_key: key, delta_payload: payload,
    };
    window.currentQueueData = [rev];
    window.activePreviewRevId = 'sd';
    window.activePreviewCharId = 'm1-trading';
    window.activePreviewPageType = 'system';
    window.activePreviewMode = null;
    window.currentLiveDescData = JSON.parse(JSON.stringify(live));
    window.currentLiveFrameData = {};
    // Pending is live WITH the delta applied, which is what admin.html does
    // when it loads a revision. Setting it equal to live would make every
    // changed-tab assertion below vacuous.
    window.currentPendingDescData = window.applyDeltaToData(
        JSON.parse(JSON.stringify(live)), {}, scope, key, payload).newDesc;
    window.currentPendingFrameData = {};
    window.changedTabs = [];

    let err = '';
    try { await switchVersionView('diff'); } catch (e) { err = String(e.message || e); }
    await new Promise(r => setTimeout(r, 250));

    calculateTabDiffs(rev, false);

    const c = document.getElementById('admin-diff-container');
    return {
      err,
      blocks: c ? c.querySelectorAll('.diff-container').length : 0,
      location: c ? (c.querySelector('.diff-location-label')?.innerText.trim() || '') : '',
      text: c ? c.innerText : '',
      html: c ? c.innerHTML : '',
      changedTabs: window.changedTabs.slice(),
    };
  }, { scope, key, payload, live });
}

test('a section edit is reviewable, and named by its place on the page', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const edited = clone(LIVE.tabs[0].sections[0]);
  edited.blocks[0].content = 'CHANGED intro';

  const out = await renderSystemScope(page, 'system_section', 'basics::intro', edited, LIVE);

  expect(out.err).toBe('');
  expect(out.blocks, 'a section edit must not review as an empty panel').toBeGreaterThan(0);
  // The page's own tab name and section name - not a delta scope, and not a key.
  expect(out.location).toContain('Basics');
  expect(out.location).toContain('Intro');
  expect(out.location).not.toContain('system_section');
  expect(out.location).not.toContain('basics::intro');
  // Prose diffs as prose, so this is not the raw-JSON fallback.
  expect(out.html, 'this should not be the unknown-scope fallback').not.toContain('diff-unknown-scope');
  expect(out.text).toContain('CHANGED intro');
});

test('a section edit marks the tab it is actually in', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const edited = clone(LIVE.tabs[0].sections[0]);
  edited.blocks[0].content = 'CHANGED intro';
  const out = await renderSystemScope(page, 'system_section', 'basics::intro', edited, LIVE);

  // Every system edit used to mark 'overview' - a tab most system pages do not
  // even have, so the reviewer was pointed at nothing.
  expect(out.changedTabs).toContain('basics');
  expect(out.changedTabs).not.toContain('overview');
});

test('a tab rename reviews as a rename, not as its sections changing', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const out = await renderSystemScope(page, 'system_tab', 'basics',
    { tabId: 'basics', tabLabel: 'The Basics', order: ['intro', 'advanced'] }, LIVE);

  expect(out.err).toBe('');
  expect(out.blocks).toBeGreaterThan(0);
  expect(out.text).toContain('The Basics');
  // The section prose must not appear - nothing about it changed.
  expect(out.text).not.toContain('ORIGINAL advanced');
});
