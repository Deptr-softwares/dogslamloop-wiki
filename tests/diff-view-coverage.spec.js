// Diff View must render every edit type - v0.15 item 6.
//
// SEVEN SCOPES RENDERED NOTHING. comboIntro, comboTable, gallery_item,
// gallery_intro, intro, notes and tool_config each produced a location label
// and no diff underneath it, which a reviewer cannot tell apart from "nothing
// changed here". The ticket applied perfectly; only the review was blind.
//
// That is the same shape as the merged-ticket bug (tests/merged-ticket-diff)
// and worse, because it was the steady state rather than an edge case. The
// structural cause was that renderDeltaDiff had no final else, so a scope
// without a branch fell out silently.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const LIVE_DESC = {
  overview: [{ type: 'paragraph', content: 'live overview' }],
  strategy: [{ type: 'paragraph', content: 'live strategy' }],
  playstyle: { archetype: 'Rushdown' },
  profile: { name: 'Boomcat' },
  comboIntro: [{ type: 'paragraph', content: 'live intro' }],
  comboGroups: [{ title: 'True Combos', content: [{ type: 'paragraph', content: 'live group' }] }],
  comboList: [{ starter: 'M1 Starters', rows: [{ combo: 'M1 M1 Explosion', damage: '10', worksOn: 'All' }] }],
  counterplay: [{ topic: 'Spacing', content: [] }],
  starterGuide: [{ topic: 'Basics', content: [] }],
  matchups: [{ opponent: 'Vessel', tier: 'even', content: [] }],
  extras: [{ title: 'Tech', content: [] }],
  items: [{ name: 'Emote A', media: 'x' }],
  intro: [{ type: 'paragraph', content: 'live gallery intro' }],
  notes: [{ type: 'paragraph', content: 'live notes' }],
  tool: { url: 'https://example.com' },
  moveStrategies: { explosion: [] },
};
const LIVE_FRAME = {
  m1s: [], specials: [],
  skills: [{ id: 'explosion', name: 'Explosion', input: '1', stats: [{ label: 'Damage', value: '10' }] }],
};

// A payload that genuinely differs from LIVE_DESC, per scope.
const PAYLOADS = {
  profile: { name: 'Boomcat', title: 'CHANGED' },
  playstyle: { archetype: 'Zoner' },
  overview: [{ type: 'paragraph', content: 'CHANGED overview' }],
  strategy: [{ type: 'paragraph', content: 'CHANGED strategy' }],
  extra: { title: 'Tech', content: [{ type: 'paragraph', content: 'CHANGED' }] },
  matchup: { opponent: 'Vessel', tier: 'good', content: [] },
  counterplay: { topic: 'Spacing', content: [{ type: 'paragraph', content: 'CHANGED' }] },
  starterGuide: { topic: 'Basics', content: [{ type: 'paragraph', content: 'CHANGED' }] },
  comboGroup: { title: 'True Combos', content: [{ type: 'paragraph', content: 'CHANGED' }] },
  comboTable: { starter: 'M1 Starters', rows: [{ combo: 'M1 M1 Explosion', damage: '99', worksOn: 'All' }] },
  comboIntro: [{ type: 'paragraph', content: 'CHANGED intro' }],
  gallery_item: { name: 'Emote A', media: 'CHANGED' },
  gallery_intro: [{ type: 'paragraph', content: 'CHANGED gallery intro' }],
  intro: [{ type: 'paragraph', content: 'CHANGED intro' }],
  notes: [{ type: 'paragraph', content: 'CHANGED notes' }],
  tool_config: { url: 'https://changed.example.com' },
  move: { frame_data: { id: 'explosion', name: 'Explosion', input: '1', stats: [{ label: 'Damage', value: '99' }] }, desc_data: [] },
};
const KEYS = {
  extra: 'Tech', matchup: 'Vessel', counterplay: 'Spacing', starterGuide: 'Basics',
  comboGroup: 'True Combos', comboTable: 'M1 Starters', gallery_item: 'Emote A',
  move: 'skills::explosion',
};

async function renderScope(page, scope, key, payload) {
  return page.evaluate(async ({ scope, key, payload, liveDesc, liveFrame }) => {
    document.body.innerHTML = `<div class="main-content-area"></div>`;
    const rev = {
      id: 'cov', page_id: 'boomcat', page_type: 'character', is_delta: true,
      target_scope: scope, target_key: key, delta_payload: payload,
    };
    window.currentQueueData = [rev];
    window.activePreviewRevId = 'cov';
    window.activePreviewCharId = 'boomcat';
    window.activePreviewPageType = 'character';
    window.activePreviewMode = null;
    window.currentLiveDescData = JSON.parse(JSON.stringify(liveDesc));
    window.currentLiveFrameData = JSON.parse(JSON.stringify(liveFrame));
    window.currentPendingDescData = JSON.parse(JSON.stringify(liveDesc));
    window.currentPendingFrameData = JSON.parse(JSON.stringify(liveFrame));

    let err = '';
    try { await switchVersionView('diff'); } catch (e) { err = String(e.message || e); }
    await new Promise(r => setTimeout(r, 250));

    const c = document.getElementById('admin-diff-container');
    return {
      blocks: c ? c.querySelectorAll('.diff-container').length : 0,
      label: c ? (c.querySelector('.diff-location-label')?.innerText.trim() || '') : '',
      text: c ? c.innerText : '',
      html: c ? c.innerHTML : '',
      err,
    };
  }, { scope, key, payload, liveDesc: LIVE_DESC, liveFrame: LIVE_FRAME });
}

// Derived from the code that APPLIES deltas, not restated here. A scope added
// to applyDeltaToData without a diff branch is exactly the bug this catches,
// and a list written out by hand would have to be remembered to be updated -
// which is how all seven went missing in the first place.
function scopesThatCanBeApplied() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'site_utils.js'), 'utf8');
  const body = src.slice(src.indexOf('applyDeltaToData'));
  const literal = [...body.matchAll(/scope === '([a-zA-Z_]+)'/g)].map(m => m[1]);
  const fixedInline = ['profile', 'playstyle', 'overview', 'strategy'];
  // Structural wrappers, not editable content - they carry other scopes.
  const wrappers = ['multi', 'mode', 'modes', 'system_data'];
  return [...new Set([...literal, ...fixedInline])].filter(s => !wrappers.includes(s));
}

test('every scope a ticket can carry renders something a reviewer can see', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  // The registry's scopes too - keyed sections and fixed block sections reach
  // applyDeltaToData through a lookup rather than a literal, so they do not
  // appear in the scan above.
  const registryScopes = await page.evaluate(() => [
    ...window.getKeyedSections().map(s => s.scope),
    ...(window.FIXED_BLOCK_SECTIONS || []).map(s => s.scope),
  ]);

  const scopes = [...new Set([...scopesThatCanBeApplied(), ...registryScopes])];
  expect(scopes.length, 'the scan should find real scopes').toBeGreaterThan(8);

  const silent = [];
  for (const scope of scopes) {
    const payload = PAYLOADS[scope];
    // A scope with no fixture here is a scope this test does not know how to
    // exercise - fail loudly rather than skip it into a false pass.
    expect(payload, `no test payload defined for scope "${scope}"`).toBeTruthy();

    const out = await renderScope(page, scope, KEYS[scope] || 'full', payload);
    if (out.blocks === 0 || out.err) silent.push(`${scope} (blocks=${out.blocks}${out.err ? ', err=' + out.err : ''})`);
  }

  expect(silent, 'these scopes show a reviewer a heading and nothing underneath it').toEqual([]);
});

test('a scope with no purpose-built view still shows the change, and says so', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  const out = await renderScope(page, 'some_future_scope', 'full', { field: 'a value' });

  expect(out.blocks, 'an unknown scope must never render as an empty panel').toBeGreaterThan(0);
  expect(out.text).toContain('a value');
  // And it must be honest that this is the fallback, so the reviewer knows the
  // odd-looking dump is a real change rather than a broken screen.
  expect(out.html).toContain('diff-unknown-scope');
  expect(out.text.toLowerCase()).toContain('will be applied if you approve');
});

test('a combo table edit shows the combos, not two empty panels', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  const out = await renderScope(page, 'comboTable', 'M1 Starters', PAYLOADS.comboTable);

  // The entries hold `rows`, not `content`. Diffing `.content` compared two
  // empty arrays and returned before rendering, so this reviewed as no change.
  expect(out.blocks).toBeGreaterThan(0);
  // Section titles are upper-cased by the renderer, so match without case.
  expect(out.text.toLowerCase(), 'the row should be named by its route').toContain('m1 m1 explosion');
  expect(out.text, 'the changed damage should be visible').toContain('99');
});

test('the location reads as a place on the wiki, not a delta scope', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  const out = await renderScope(page, 'comboIntro', 'full', PAYLOADS.comboIntro);

  // Was: "Suggested Edit Location: [ COMBOINTRO ➔ FULL ]" - a scope name and an
  // internal placeholder, neither of which appears anywhere on the wiki.
  expect(out.label).toContain('Combos');
  expect(out.label).toContain('Read First');
  expect(out.label).not.toContain('COMBOINTRO');
  expect(out.label, '"full" is an internal placeholder, not a place').not.toMatch(/\bFULL\b/);
});

test('field names are words, not schema keys', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  const out = await renderScope(page, 'comboTable', 'M1 Starters', PAYLOADS.comboTable);

  expect(out.text).toContain('Damage');
  expect(out.text, 'worksOn should read as Works On').not.toContain('worksOn');
});

test('a list of objects is not dumped as JSON', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  const out = await renderScope(page, 'move', 'skills::explosion', PAYLOADS.move);

  expect(out.text).toContain('99');
  // The tell of a stringified object reaching the reviewer.
  expect(out.text, 'a stat list should not arrive as JSON').not.toContain('{"label"');
  expect(out.text).not.toContain('[{');
});

test('notation is coloured in Diff View, the same as a reader sees it', async ({ page }) => {
  // The reader saw colours and the person APPROVING them saw plain text -
  // and the reviewer is the half that has to spot a wrong input.
  //
  // currentPageMoveSlots read cachedMasterFrameData and currentEditorFrameData.
  // admin.html has neither: it loads a revision into currentLive*/currentPending*,
  // so the slot map came back empty and nothing was coloured at all.
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const out = await renderScope(page, 'comboGroup', 'True Combos', {
    title: 'True Combos',
    content: [{ type: 'combo', sequence: ['M1', 'Explosion'], damage: '42', note: '' }],
  });
  expect(out.err).toBe('');

  await page.waitForTimeout(400);

  const chips = await page.evaluate(() => {
    // Computed colour, not the class. A class that is set while the colour is
    // overridden is exactly what shipped broken once already.
    const nodes = [...document.querySelectorAll('#admin-diff-container .combo-node')];
    return nodes.map(n => {
      const slotted = n.querySelector('.sc-auto') || n;
      return { text: n.innerText.trim(), color: getComputedStyle(slotted).color };
    });
  });

  expect(chips.length, 'the combo block should render its steps').toBeGreaterThan(0);

  const plain = 'rgb(255, 255, 255)';
  const coloured = chips.filter(c => c.color && c.color !== plain && c.color !== 'rgba(0, 0, 0, 0)');
  expect(coloured.length, `no step took an input colour: ${JSON.stringify(chips)}`).toBeGreaterThan(0);

  // M1 and a named skill resolve to DIFFERENT slots, so a single colour applied
  // to everything would pass the check above while still being wrong.
  const distinct = new Set(chips.map(c => c.color));
  expect(distinct.size, `every step came out the same colour: ${JSON.stringify(chips)}`).toBeGreaterThan(1);
});

test('editing Read First marks the Combos tab, not Overview', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const tabs = await page.evaluate(async ({ liveDesc, liveFrame }) => {
    document.body.innerHTML = `<div class="main-content-area"></div>`;
    const rev = {
      id: 'ct', page_id: 'boomcat', page_type: 'character', is_delta: true,
      target_scope: 'comboIntro', target_key: 'full',
      delta_payload: [{ type: 'paragraph', content: 'CHANGED' }],
    };
    window.currentQueueData = [rev];
    window.activePreviewRevId = 'ct';
    window.activePreviewCharId = 'boomcat';
    window.activePreviewPageType = 'character';
    window.activePreviewMode = null;
    window.currentLiveDescData = JSON.parse(JSON.stringify(liveDesc));
    window.currentLiveFrameData = JSON.parse(JSON.stringify(liveFrame));
    window.currentPendingDescData = JSON.parse(JSON.stringify(liveDesc));
    window.currentPendingFrameData = JSON.parse(JSON.stringify(liveFrame));
    window.changedTabs = [];
    calculateTabDiffs(rev, false);
    return window.changedTabs;
  }, { liveDesc: LIVE_DESC, liveFrame: LIVE_FRAME });

  // Pointing at a tab that did not change is worse than pointing at none: the
  // reviewer looks at Overview, sees nothing, and stops looking.
  expect(tabs).toContain('combos');
  expect(tabs).not.toContain('overview');
});
