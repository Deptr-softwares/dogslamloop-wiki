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

test('prose diffs render as a diff, not as visible <ins> tags', async ({ page }) => {
  // v0.15 item 1 closed a stored-XSS hole by escaping at every innerHTML
  // interpolation in the block renderer - and that escaped diffTextLCS's own
  // <ins>/<del> a second time. Every prose diff in the review screen rendered
  // as literal `<ins class="diff-add">` and `&quot;`. Two correct fixes that
  // cancelled each other out, and no test asserted the pair.
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const out = await renderScope(page, 'overview', 'full', [
    { type: 'heading', size: 'h3', content: 'A brand new heading' },
    { type: 'paragraph', content: 'He said "hello" and it\'s fine.' },
  ]);
  expect(out.err).toBe('');
  await page.waitForTimeout(300);

  const rendered = await page.evaluate(() => {
    const c = document.getElementById('admin-diff-container');
    return {
      insCount: c.querySelectorAll('ins.diff-add').length,
      delCount: c.querySelectorAll('del.diff-del').length,
      text: c.innerText,
    };
  });

  expect(rendered.insCount, 'the added text should be real <ins> elements').toBeGreaterThan(0);
  // The exact symptom from the screenshots: tags and entities as visible text.
  expect(rendered.text, 'diff markup must not be readable as text').not.toContain('<ins class=');
  expect(rendered.text).not.toContain('<del class=');
  expect(rendered.text, 'text must be escaped exactly once').not.toContain('&quot;');
  expect(rendered.text).not.toContain('&#39;');
  // And the contributor's actual words survive, correctly decoded.
  expect(rendered.text).toContain('He said "hello"');
  expect(rendered.text).toContain("it's fine");
});

test('a mixed diff renders both sides as markup', async ({ page }) => {
  // The early-return paths and the main loop are different code. Fixing only
  // the wholly-added case would leave every ordinary edit still broken.
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const out = await renderScope(page, 'overview', 'full', [
    { type: 'paragraph', content: 'live CHANGED' },
  ]);
  expect(out.err).toBe('');
  await page.waitForTimeout(300);

  const counts = await page.evaluate(() => {
    const c = document.getElementById('admin-diff-container');
    return { ins: c.querySelectorAll('ins.diff-add').length, del: c.querySelectorAll('del.diff-del').length };
  });
  expect(counts.ins).toBeGreaterThan(0);
  expect(counts.del).toBeGreaterThan(0);
});

test('a submission cannot forge diff markers', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const safe = await page.evaluate(() => {
    // The markers are control characters. If a contributor could smuggle one
    // through, they could open a tag the differ never opened.
    const forged = window.DIFF_MARKERS.addOpen + 'forged' + window.DIFF_MARKERS.addClose;
    const out = window.diffTextLCS('', forged + '<img src=x onerror=alert(1)>');
    const host = document.createElement('div');
    host.textContent = out;                 // as the block renderer would escape it
    window.resolveDiffMarkers(host);
    return { html: host.innerHTML, imgs: host.querySelectorAll('img').length };
  });

  expect(safe.imgs, 'no element may be created from submitted text').toBe(0);
  // Asserted as "still escaped", not as "the substring is absent" - the text
  // is allowed to CONTAIN onerror=alert(1), it just must not be markup. An
  // absence assertion here would pass for the wrong reason the moment the
  // wording changed, which is the trap two tests in admin-structured-diff
  // fell into this same session.
  expect(safe.html, 'the tag must survive only in escaped form').toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(safe.html, 'a forged marker must not become a tag').not.toContain('>forged<');
});

// --- THE OTHER PAGE TYPES ---
//
// A system page took a different route through this renderer and kept the old
// "[Tab] ➔ Section" wording baked into each block title, so the same reviewer
// read two different vocabularies depending on which queue item they opened -
// and only one of them named a place.

async function renderSystemDiff(page, pageType, liveDesc, payload) {
  return page.evaluate(async ({ pageType, liveDesc, payload }) => {
    document.body.innerHTML = `<div class="main-content-area"></div>`;
    const rev = {
      id: 'sys', page_id: 'basic-fundamentals', page_type: pageType, is_delta: true,
      target_scope: 'system_data', target_key: 'full', delta_payload: payload,
    };
    window.currentQueueData = [rev];
    window.activePreviewRevId = 'sys';
    window.activePreviewCharId = 'basic-fundamentals';
    window.activePreviewPageType = pageType;
    window.activePreviewMode = null;
    window.currentLiveDescData = JSON.parse(JSON.stringify(liveDesc));
    window.currentLiveFrameData = {};
    window.currentPendingDescData = JSON.parse(JSON.stringify(payload));
    window.currentPendingFrameData = {};

    let err = '';
    try { await switchVersionView('diff'); } catch (e) { err = String(e.message || e); }
    await new Promise(r => setTimeout(r, 250));

    const c = document.getElementById('admin-diff-container');
    return {
      err,
      blocks: c ? c.querySelectorAll('.diff-container').length : 0,
      locations: c ? [...c.querySelectorAll('.diff-location-label')].map(n => n.innerText.trim()) : [],
      titles: c ? [...c.querySelectorAll('.diff-section-title')].map(n => n.innerText.trim()) : [],
      ins: c ? c.querySelectorAll('ins.diff-add').length : 0,
      text: c ? c.innerText : '',
    };
  }, { pageType, liveDesc, payload });
}

const SYS_LIVE = {
  tabs: [{
    tabId: 'basic-fundamentals', tabLabel: 'Basic Fundamentals',
    sections: [{ sectionTitle: 'Introduction', layout: 'full', width: 100, alignment: 'left',
                 blocks: [{ type: 'paragraph', content: 'live system text' }] }],
  }],
};

test('a system page names its location the same way a character page does', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const payload = JSON.parse(JSON.stringify(SYS_LIVE));
  payload.tabs[0].sections[0].blocks[0].content = 'CHANGED system text';

  const out = await renderSystemDiff(page, 'system', SYS_LIVE, payload);

  expect(out.err).toBe('');
  expect(out.blocks).toBeGreaterThan(0);
  expect(out.locations.length, 'a system page should say where the change is').toBeGreaterThan(0);

  // "Changed:" is CSS-uppercased, and innerText reflects that.
  const joined = out.locations.join(' | ');
  expect(joined.toLowerCase()).toContain('changed:');
  expect(joined).toContain('Basic Fundamentals');
  expect(joined).toContain('Introduction');
  // The old form put the location inside the block heading, in brackets.
  expect(out.titles.join(' | '), 'the location belongs in the breadcrumb, not the heading')
    .not.toContain('[Basic Fundamentals]');
});

test('a system page renders its prose as a diff too', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const payload = JSON.parse(JSON.stringify(SYS_LIVE));
  payload.tabs[0].sections[0].blocks[0].content = 'CHANGED system text';

  const out = await renderSystemDiff(page, 'system', SYS_LIVE, payload);
  expect(out.ins, 'system prose should diff as markup, not visible tags').toBeGreaterThan(0);
  expect(out.text).not.toContain('<ins class=');
});

test('an unchanged system section is not announced as changed', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  // Two sections, one edited. The old code emitted a heading for every section
  // of every tab whether or not it changed, so a one-word edit to a long page
  // produced a wall of headings with nothing under most of them.
  const live = JSON.parse(JSON.stringify(SYS_LIVE));
  live.tabs[0].sections.push({ sectionTitle: 'Untouched', layout: 'full', width: 100, alignment: 'left',
                               blocks: [{ type: 'paragraph', content: 'same either way' }] });
  const payload = JSON.parse(JSON.stringify(live));
  payload.tabs[0].sections[0].blocks[0].content = 'CHANGED system text';

  const out = await renderSystemDiff(page, 'system', live, payload);
  expect(out.locations.join(' | ')).toContain('Introduction');
  expect(out.locations.join(' | '), 'an unchanged section should not be listed').not.toContain('Untouched');
});

test('a tier list page also names its location', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const live = { tabs: [{ tabId: 'main', tabLabel: 'Season 1', tiers: [{ name: 'S', characters: ['Vessel'] }], changelog: [] }] };
  const payload = JSON.parse(JSON.stringify(live));
  payload.tabs[0].tiers[0].characters.push('Boomcat');

  const out = await renderSystemDiff(page, 'tierlist', live, payload);
  expect(out.err).toBe('');
  expect(out.locations.join(' | ')).toContain('Season 1');
  expect(out.locations.join(' | ')).toContain('Tiers');
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
