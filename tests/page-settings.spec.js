// Page settings (v1.1): the editor's Config > Page.
//
// Owner, 2026-10-18: "Allow for auto-coloring custom words in a page: this list
// is to help editor quickly color custom keywords JUST FOR THAT PAGE. This
// should stay exclusive to page and do not bleed into other pages", and "Page
// house style document ... would also appear as a red-colored button next to
// MoS". Scoped with the owner 2026-10-19: a colour or a gradient per word,
// exact case, whole words, up to fifty, built-in colours win, [noauto] opts
// out; anyone may change either, through review.
//
// Both live in desc_data.pageConfig and travel as the pageConfig scope. The
// file follows them end to end: what a reader sees, what the editor does,
// what Submit sends, what the reviewer sees, and what a merge keeps.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const CROW = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'crow-charmer-page-data.json'), 'utf8'));

// --- WHAT A READER SEES --------------------------------------------------------
//
// Through the real path: the page row arrives from page_data, the page records
// its settings while fetching it, and the styling pass reads them back.

async function openCrow(page, pageConfig) {
  const row = JSON.parse(JSON.stringify(CROW));
  if (pageConfig) row.desc_data.pageConfig = pageConfig;
  await page.route('**/rest/v1/page_data**', route => {
    if (!route.request().url().includes('page_id=eq.crow_charmer')) return route.continue();
    const one = /vnd.pgrst.object/.test(route.request().headers()['accept'] || '');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(one ? row : [row]) });
  });
  await page.goto('/characters/Crow_charmer/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
}

// A paragraph outside the Combos and Techs tabs, styled, and what it painted.
async function paint(page, text) {
  return page.evaluate((text) => {
    const host = document.createElement('p');
    host.className = 'strategy-paragraph';
    host.textContent = text;
    document.querySelector('main').appendChild(host);
    window.applyInternalStyling();
    return {
      text: host.textContent,
      words: [...host.querySelectorAll('.sc-page-word')].map(s => ({
        text: s.textContent,
        color: getComputedStyle(s).color,
        gradient: s.classList.contains('sc-page-gradient'),
        letters: [...s.querySelectorAll('.sc-mc')].map(l => getComputedStyle(l).color),
      })),
    };
  }, text);
}

const DOMAIN = { word: 'Domain', colors: ['#123456'] };

test('a page word is coloured whole and in its exact case, and nothing else is', async ({ page }) => {
  await openCrow(page, { words: [DOMAIN], houseStyle: '' });
  const out = await paint(page, 'Domain is not domain, DOMAIN or Domains.');

  expect(out.text, 'the words are untouched').toBe('Domain is not domain, DOMAIN or Domains.');
  expect(out.words).toEqual([{ text: 'Domain', color: 'rgb(18, 52, 86)', gradient: false, letters: [] }]);
});

test('a gradient word sweeps its stops across the letters', async ({ page }) => {
  await openCrow(page, { words: [{ word: 'Black Flash', colors: ['#ff0000', '#0000ff'] }], houseStyle: '' });
  const out = await paint(page, 'Land a Black Flash here.');

  expect(out.words).toHaveLength(1);
  expect(out.words[0].text).toBe('Black Flash');
  expect(out.words[0].gradient).toBe(true);
  expect(out.words[0].letters).toHaveLength('BlackFlash'.length);
  expect(out.words[0].letters[0]).toBe('rgb(255, 0, 0)');
  expect(out.words[0].letters.at(-1)).toBe('rgb(0, 0, 255)');
});

test('[noauto] stops a page word too', async ({ page }) => {
  await openCrow(page, { words: [DOMAIN], houseStyle: '' });
  const out = await paint(page, '[noauto]Domain[/noauto] then Domain');

  expect(out.text).toBe('Domain then Domain');
  expect(out.words.map(w => w.text), 'only the unprotected one').toEqual(['Domain']);
});

test('built-in colours win: a character name and a frame term keep their own', async ({ page }) => {
  await openCrow(page, {
    words: [{ word: 'Vessel', colors: ['#123456'] }, { word: 'Startup', colors: ['#123456'] }, DOMAIN],
    houseStyle: '',
  });
  const out = await paint(page, 'Vessel has Startup, and a Domain.');

  // Domain is the control: page words are on, so the other two losing is the
  // built-ins winning and not the feature being off.
  expect(out.words.map(w => w.text)).toEqual(['Domain']);
  const builtIn = await page.evaluate(() => {
    const p = [...document.querySelectorAll('main .strategy-paragraph')].at(-1);
    return [...p.querySelectorAll('.sc-auto')].map(s => ({ text: s.textContent, color: getComputedStyle(s).color }));
  });
  const vessel = builtIn.find(s => s.text === 'Vessel');
  const startup = builtIn.find(s => s.text === 'Startup');
  expect(vessel && startup, 'both are still auto-coloured').toBeTruthy();
  expect(vessel.color).not.toBe('rgb(18, 52, 86)');
  expect(startup.color).not.toBe('rgb(18, 52, 86)');
});

test('in the Combos tab a move name keeps its move colour; elsewhere the page colour applies', async ({ page }) => {
  // Circling is Crow Charmer's Skill 2. A gradient, because one span per
  // letter is the shape the move pass could never match a name across.
  await openCrow(page, { words: [{ word: 'Circling', colors: ['#ff0000', '#0000ff'] }], houseStyle: '' });

  const combos = await page.evaluate(() => {
    window.renderCombosTab({
      comboGroups: [{ title: 'T', content: [{ type: 'paragraph', content: 'Open with Circling here.' }] }],
    });
    window.applyInternalStyling();
    const para = [...document.querySelectorAll('#tab-combos .is-styled')]
      .find(el => el.textContent.includes('Open with Circling here.'));
    return {
      slotted: [...para.querySelectorAll('.is-2')].map(s => s.textContent),
      pageWords: para.querySelectorAll('.sc-page-word').length,
    };
  });
  expect(combos.slotted, 'the move keeps Skill 2\'s colour').toEqual(['Circling']);
  expect(combos.pageWords).toBe(0);

  const prose = await paint(page, 'Circling is the safe opener.');
  expect(prose.words.map(w => w.text), 'outside the Combos tab nothing else colours it').toEqual(['Circling']);
});

test('another page\'s words never colour this page', async ({ page }) => {
  await openCrow(page, null);
  const settings = { pageConfig: { words: [DOMAIN], houseStyle: '' } };

  await page.evaluate((s) => window.rememberPageConfig('vessel', s), settings);
  const before = await paint(page, 'A Domain.');
  expect(before.words, 'Vessel\'s words stay on Vessel').toEqual([]);

  // The control: the same words recorded for THIS page do paint.
  await page.evaluate((s) => {
    window.rememberPageConfig(window.PAGE_ROUTE.pageId, s);
    window.refreshPageWords();
  }, settings);
  const after = await page.evaluate(() =>
    [...document.querySelectorAll('main .sc-page-word')].map(s => s.textContent));
  expect(after).toEqual(['Domain']);
});

test('a hand-written list is capped at fifty, and a bad colour is refused whole', async ({ page }) => {
  // The editor stops at fifty; the data can still be written by hand.
  const words = Array.from({ length: 60 }, (_, i) => ({ word: `Word${i}`, colors: ['#123456'] }));
  words.push({ word: 'Broken', colors: ['#123456', 'red;x:y'] });
  await openCrow(page, { words, houseStyle: '' });

  const out = await paint(page, 'Word0 Word49 Word50 Word59 Broken');
  expect(out.words.map(w => w.text)).toEqual(['Word0', 'Word49']);
});

// --- THE EDITOR -----------------------------------------------------------------

const para = (text) => ({ type: 'paragraph', content: [text], align: 'left' });
const DESC = {
  overview: [para('The Domain opens wide.')],
  profile: { stats: [], image: '' }, extras: [], matchups: [],
};
const FRAME = { m1s: [], specials: [], skills: [] };

function mockEditor(page, desc) {
  return page.addInitScript((desc) => {
    try {
      localStorage.setItem('dsl_editor_tutorial_seen', '1');
      localStorage.setItem('dsl_notice_seen_editor', '1');
    } catch (e) { /* ignore */ }
    const rowsFor = (table) => {
      if (table === 'page_data') return { data: { page_id: 'boomcat', desc_data: JSON.parse(JSON.stringify(desc)), frame_data: { m1s: [], specials: [], skills: [] } }, error: null };
      if (['user_roles', 'site_settings', 'page_permissions', 'pending_revisions'].includes(table)) return { data: null, error: null };
      return { data: [], error: null };
    };
    const builder = (table) => {
      const result = rowsFor(table);
      const chain = {
        select() { return chain; }, eq() { return chain; }, in() { return chain; }, neq() { return chain; },
        order() { return chain; }, limit() { return chain; },
        single: async () => result, maybeSingle: async () => result,
        then: (res) => Promise.resolve(result).then(res),
      };
      return chain;
    };
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          lib.createClient = () => ({
            auth: {
              getSession: async () => ({ data: { session: { user: { id: 'c-1', email: 'c@b.c' }, access_token: 't' } } }),
              onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
              signOut: async () => ({}),
            },
            from: builder,
            rpc: async () => ({ data: null, error: null }),
            storage: { from: () => ({ list: async () => ({ data: [], error: null }) }) },
          });
          lib.__patched = true;
        }
      },
    });
  }, desc);
}

async function bootEditor(page, desc = DESC) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 900 });
  await mockEditor(page, desc);
  await page.goto('/edit.html?char=boomcat&type=character&tab=overview', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#block-list .block-card').first()).toBeVisible({ timeout: 45000 });
  return errors;
}

async function openPageTab(page) {
  await page.click('#btn-editor-config');
  await page.click('#editor-config-modal [data-config-tab="page"]');
  await expect(page.locator('[data-config-panel="page"]')).toBeVisible();
}

// Resolved by the browser, so the test follows the palette rather than a hex.
const resolved = (page, color) => page.evaluate((c) => {
  const probe = document.createElement('span');
  probe.style.color = c;
  document.body.appendChild(probe);
  const out = getComputedStyle(probe).color;
  probe.remove();
  return out;
}, color);

test('Config > Page: a new word colours the preview, a swatch recolours it, and deleting it asks first', async ({ page }) => {
  const errors = await bootEditor(page);
  await openPageTab(page);
  await expect(page.locator('#editor-config-modal [data-config-tab]')).toHaveText(['Editor', 'Actions', 'Page']);

  await page.click('[data-word-add]');
  await page.locator('[data-word-text]').fill('Domain');

  const word = page.locator('.live-preview-pane .sc-page-word');
  await expect(word).toHaveText('Domain');
  const firstSwatch = await page.evaluate(() => colorPresetGroups()[0].swatches[0].color);
  expect(await word.evaluate(el => getComputedStyle(el).color)).toBe(await resolved(page, firstSwatch));

  // A gradient from the same presets the toolbar offers.
  await page.click('[data-word-swatch]');
  await page.locator('.config-word-popup .gradient-preset-btn').first().click();
  await expect(page.locator('.config-word-popup')).toBeHidden();
  await expect(page.locator('.live-preview-pane .sc-page-gradient')).toHaveText('Domain');
  expect(await page.evaluate(() => window.editorMasterDescData.pageConfig.words))
    .toEqual([{ word: 'Domain', colors: ['#a855f7', '#22d3ee'] }]);

  // A plain swatch turns it back into one colour.
  await page.click('[data-word-swatch]');
  const basic = page.locator('.config-word-popup .color-preset-btn').nth(1);
  const basicColor = await basic.getAttribute('data-color');
  await basic.click();
  await expect(page.locator('.live-preview-pane .sc-page-gradient')).toHaveCount(0);
  expect(await word.evaluate(el => getComputedStyle(el).color)).toBe(await resolved(page, basicColor));

  // Delete asks, on top of the Config window, and CANCEL keeps the word.
  await page.click('[data-word-remove]');
  await expect(page.locator('#editor-modal-text')).toHaveText('Delete this word?');
  await page.click('#editor-modal-cancel');
  await expect(word).toHaveText('Domain');

  await page.click('[data-word-remove]');
  await page.click('#editor-modal-confirm');
  await expect(page.locator('.live-preview-pane .sc-page-word')).toHaveCount(0);
  await expect(page.locator('[data-word-text]')).toHaveCount(0);
  expect(await page.evaluate(() => window.editorMasterDescData.pageConfig), 'nothing left, nothing stored').toBeUndefined();
  expect(errors).toEqual([]);
});

test('a word that a built-in colour covers says so', async ({ page }) => {
  await bootEditor(page);
  await openPageTab(page);
  await page.click('[data-word-add]');
  await page.locator('[data-word-text]').fill('Startup');
  await expect(page.locator('[data-word-note]')).toContainText('already has a built-in color');

  await page.click('[data-word-add]');
  await page.locator('[data-word-text]').nth(1).fill('Startup');
  await expect(page.locator('[data-word-note]').nth(1)).toHaveText('Listed twice. The first one is used.');
});

test('a custom gradient needs two valid colours', async ({ page }) => {
  await bootEditor(page);
  await openPageTab(page);
  await page.click('[data-word-add]');
  await page.locator('[data-word-text]').fill('Domain');
  await page.click('[data-word-swatch]');

  const field = page.locator('[data-word-gradient]');
  const use = page.locator('[data-word-gradient-apply]');
  const error = page.locator('[data-word-gradient-error]');

  await field.fill('#ff0000');
  await use.click();
  await expect(error).toContainText('two or more colors');
  await field.fill('#ff0000, nope');
  await use.click();
  await expect(error).toContainText('two or more colors');
  expect(await page.evaluate(() => window.editorMasterDescData.pageConfig.words[0].colors)).toHaveLength(1);

  await field.fill('#ff0000, #00ff00, #0000ff');
  await use.click();
  expect(await page.evaluate(() => window.editorMasterDescData.pageConfig.words[0].colors))
    .toEqual(['#ff0000', '#00ff00', '#0000ff']);
  await expect(page.locator('.live-preview-pane .sc-page-gradient')).toHaveText('Domain');
});

test('ADD WORD stops at fifty', async ({ page }) => {
  const words = Array.from({ length: 49 }, (_, i) => ({ word: `Word${i}`, colors: ['#123456'] }));
  await bootEditor(page, { ...DESC, pageConfig: { words, houseStyle: '' } });
  await openPageTab(page);

  await expect(page.locator('[data-word-count]')).toHaveText('49 of 50');
  await page.click('[data-word-add]');
  await expect(page.locator('[data-word-count]')).toHaveText('50 of 50');
  await expect(page.locator('[data-word-add]')).toBeDisabled();
});

test('the House Style button shows only when the page has one, and opens it formatted', async ({ page }) => {
  await bootEditor(page);
  const button = page.locator('.header-actions #btn-house-style');
  await expect(button).toBeHidden();

  await openPageTab(page);
  await page.locator('[data-house-style]').fill('Move names go in [b]bold[/b].\nMatchups name the opponent first.');
  await page.click('#editor-config-modal [data-config-close]');
  await expect(button).toBeVisible();
  await expect(button).toHaveText('House Style');

  await button.click();
  const modal = page.locator('#editor-house-style-modal');
  await expect(modal.locator('.house-style-text .strategy-paragraph')).toHaveCount(2);
  await expect(modal.locator('strong.sc-b')).toHaveText('bold');
  await expect(modal).not.toContainText('[b]');
  await modal.locator('[data-house-style-ok]').click();
  await expect(modal).toHaveCount(0);

  // Emptied again, the button goes.
  await openPageTab(page);
  await page.locator('[data-house-style]').fill('   ');
  await expect(button).toBeHidden();
});

test('a page that already has a house style shows the button as the editor opens', async ({ page }) => {
  await bootEditor(page, { ...DESC, pageConfig: { words: [], houseStyle: 'Write [i]short[/i] sentences.' } });
  await expect(page.locator('#btn-house-style')).toBeVisible();
});

test('saved words colour the preview from the first paint', async ({ page }) => {
  await bootEditor(page, { ...DESC, pageConfig: { words: [DOMAIN], houseStyle: '' } });
  await expect(page.locator('.live-preview-pane .sc-page-word')).toHaveText('Domain');
  await expect(page.locator('#btn-house-style'), 'no house style, no button').toBeHidden();
});

// --- WHAT SUBMIT SENDS ------------------------------------------------------------
//
// The same harness as tests/multi-tab-submission.spec.js, capturing the rows
// the editor inserts into pending_revisions.

const CLOUD = {
  desc: {
    profile: { name: 'Testchar' }, playstyle: [],
    overview: [{ type: 'paragraph', content: 'Base overview.' }],
    strategy: [], extras: [], matchups: [], counterplay: [], moveStrategies: {},
  },
  frame: { m1s: [], skills: [{ id: 'sk-1', name: 'Dash' }], specials: [], ultimateAtk: [] },
};

async function openSubmittingEditor(page, cloud) {
  await page.addInitScript((cloud) => {
    window.__inserted = [];
    try {
      localStorage.setItem('dsl_editor_tutorial_seen', '1');
      localStorage.setItem('dsl_notice_seen_editor', '1');
    } catch (e) { /* ignore */ }
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          const orig = lib.createClient.bind(lib);
          lib.createClient = (...args) => {
            const client = orig(...args);
            client.auth.getSession = async () => ({
              data: { session: { user: { id: 'u-1', email: 'c@b.c' }, access_token: 't' } },
            });
            client.from = (table) => {
              if (table === 'pending_revisions') {
                return {
                  insert: (rows) => {
                    window.__inserted.push(...(Array.isArray(rows) ? rows : [rows]));
                    return { select: async () => ({ data: [].concat(rows).map((r, i) => ({ id: `new-${i}`, ...r })), error: null }) };
                  },
                  select() { return this; }, eq() { return this; }, in() { return this; },
                  order() { return this; },
                  limit: async () => ({ data: [], error: null }),
                };
              }
              if (table === 'page_data') {
                const row = { desc_data: cloud.desc, frame_data: cloud.frame };
                return {
                  select() { return this; }, eq() { return this; },
                  single: async () => ({ data: row, error: null }),
                  maybeSingle: async () => ({ data: row, error: null }),
                };
              }
              const chain = new Proxy({}, {
                get(_t, prop) {
                  if (prop === 'then') return (resolve) => resolve({ data: null, error: null });
                  if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null });
                  return () => chain;
                },
              });
              return chain;
            };
            return client;
          };
          lib.__patched = true;
        }
      },
    });
  }, cloud);

  await page.goto('/edit.html?char=testchar&tab=overview', { waitUntil: 'networkidle' });

  await page.evaluate(async (cloud) => {
    localStorage.removeItem('wiki_last_submit_time');
    window.openQAModal = async () => ({ changelog: 'test', confidence: 'high', evidence: '' });
    window.editorAlert = () => {};

    window.currentEditorPageType = 'character';
    window.currentEditorCharId = 'testchar';
    window.currentEditorTabId = 'overview';
    window.currentOverviewSection = null;
    window.currentMatchupIndex = undefined;

    const desc = JSON.parse(JSON.stringify(cloud.desc));
    const frame = JSON.parse(JSON.stringify(cloud.frame));
    window.originalCloudDescData = JSON.parse(JSON.stringify(cloud.desc));
    window.originalCloudFrameData = JSON.parse(JSON.stringify(cloud.frame));
    window.originalCloudMasterFrame = JSON.parse(JSON.stringify(cloud.frame));

    await window.initEditorModes('testchar', desc, frame);
    initFullTabEditor('testchar', 'overview', window.currentEditorDescData, window.currentEditorFrameData);
  }, cloud);
}

async function submitAndRead(page) {
  await page.evaluate(() => { window.triggerManualSync = async () => {}; });
  await page.click('#submit-payload-btn');
  await expect(page.locator('#submit-payload-btn')).toBeEnabled({ timeout: 15000 });
  await page.waitForTimeout(600);
  return page.evaluate(() => window.__inserted.flatMap(row => (
    row.target_scope === 'multi'
      ? (row.delta_payload || []).map(d => ({ scope: d.scope, key: d.key, payload: d.payload }))
      : [{ scope: row.target_scope, key: row.target_key, payload: row.delta_payload }]
  )));
}

test('a page setting ships as its own scope, never inside a character state', async ({ page }) => {
  const cloud = JSON.parse(JSON.stringify(CLOUD));
  cloud.frame.modes = [{ id: 'base', label: 'Base Kit' }, { id: 'ultimate', label: 'Ultimate' }];
  await openSubmittingEditor(page, cloud);

  // Editing the ULTIMATE state, which is where a state-wrapped delta would
  // come from if the page setting were treated like the content around it.
  await page.evaluate(() => {
    window.editorActiveMode = 'ultimate';
    window.applyEditorModeView();
  });

  await openPageTab(page);
  await page.click('[data-word-add]');
  await page.locator('[data-word-text]').fill('Domain');
  await page.locator('[data-house-style]').fill('Bold the move names.');
  await page.click('#editor-config-modal [data-config-close]');

  const sent = await submitAndRead(page);
  const config = sent.filter(d => d.scope === 'pageConfig');
  expect(config, 'one page settings delta').toHaveLength(1);
  expect(config[0].key).toBe('full');
  expect(config[0].payload.houseStyle).toBe('Bold the move names.');
  expect(config[0].payload.words.map(w => w.word)).toEqual(['Domain']);
  expect(sent.filter(d => d.scope === 'mode' && String(d.key).includes('pageConfig')),
    'never wrapped in a state').toEqual([]);

  // And it applies at the top of the page, beside modeData, not in it.
  const applied = await page.evaluate((d) =>
    window.applyDeltaToData({ modeData: { ultimate: {} } }, {}, d.scope, d.key, d.payload).newDesc, config[0]);
  expect(applied.pageConfig.houseStyle).toBe('Bold the move names.');
  expect(applied.modeData.ultimate.pageConfig).toBeUndefined();
});

test('page settings left alone send nothing; clearing them sends null, which removes them', async ({ page }) => {
  const cloud = JSON.parse(JSON.stringify(CLOUD));
  cloud.desc.pageConfig = { words: [{ word: 'Domain', colors: ['#123456'] }], houseStyle: 'Short sentences.' };
  await openSubmittingEditor(page, cloud);

  // Opened and closed without a change: still nothing to submit.
  await openPageTab(page);
  await page.click('#editor-config-modal [data-config-close]');
  expect(await submitAndRead(page)).toEqual([]);

  await openPageTab(page);
  await page.click('[data-word-remove]');
  await page.click('#editor-modal-confirm');
  await page.locator('[data-house-style]').fill('');
  await page.click('#editor-config-modal [data-config-close]');

  const sent = await submitAndRead(page);
  expect(sent).toEqual([{ scope: 'pageConfig', key: 'full', payload: null }]);
  const applied = await page.evaluate((d) =>
    window.applyDeltaToData({ pageConfig: { words: [], houseStyle: 'x' }, overview: [] }, {}, d.scope, d.key, d.payload).newDesc, sent[0]);
  expect(applied).toEqual({ overview: [] });
});

// --- WHAT THE REVIEWER SEES -------------------------------------------------------

test('the review diff paints a proposed word in its proposed colour and diffs the house style', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const out = await page.evaluate(async () => {
    document.body.innerHTML = `<div class="main-content-area"></div>`;
    const payload = {
      words: [{ word: 'Domain', colors: ['#123456'] }, { word: 'Black Flash', colors: ['#f00', '#00f'] }],
      houseStyle: 'Bold the move names.',
    };
    const rev = {
      id: 'pc', page_id: 'boomcat', page_type: 'character', is_delta: true,
      target_scope: 'pageConfig', target_key: 'full', delta_payload: payload,
    };
    const live = { overview: [{ type: 'paragraph', content: 'live' }], pageConfig: { words: [], houseStyle: 'Old rule.' } };
    window.currentQueueData = [rev];
    window.activePreviewRevId = 'pc';
    window.activePreviewCharId = 'boomcat';
    window.activePreviewPageType = 'character';
    window.activePreviewMode = null;
    window.currentLiveDescData = JSON.parse(JSON.stringify(live));
    window.currentLiveFrameData = {};
    // What previewRevision builds: live with the ticket applied.
    window.currentPendingDescData = window.applyDeltaToData(live, {}, 'pageConfig', 'full', payload).newDesc;
    window.currentPendingFrameData = {};

    await switchVersionView('diff');
    await new Promise(r => setTimeout(r, 400));

    window.changedTabs = [];
    calculateTabDiffs(rev, false);

    const c = document.getElementById('admin-diff-container');
    return {
      label: c.querySelector('.diff-location-label').innerText,
      titles: [...c.querySelectorAll('.diff-section-title')].map(t => t.innerText),
      painted: [...c.querySelectorAll('.sc-page-word')].map(s => ({ text: s.textContent, color: getComputedStyle(s).color })),
      text: c.innerText,
      ins: c.querySelectorAll('ins.diff-add').length,
      del: c.querySelectorAll('del.diff-del').length,
      changedTabs: window.changedTabs,
    };
  });

  expect(out.label).toContain('Page Settings');
  expect(out.titles).toEqual(['AUTO-COLOR WORDS', 'HOUSE STYLE']);
  expect(out.painted.find(p => p.text === 'Domain'), 'the reviewer sees the colour itself')
    .toEqual({ text: 'Domain', color: 'rgb(18, 52, 86)' });
  expect(out.painted.some(p => p.text === 'Black Flash')).toBe(true);
  expect(out.text).toContain('#f00 → #00f');
  expect(out.text, 'the [noauto] around the colours is not shown').not.toContain('[noauto]');
  expect(out.ins, 'the new rule is marked added').toBeGreaterThan(0);
  expect(out.del, 'the old rule is marked removed').toBeGreaterThan(0);
  expect(out.changedTabs, 'page settings belong to no tab').toEqual([]);
});

test('a merge keeps a page settings change alongside a system section edit', async ({ page }) => {
  // A system page is the case that could drop it: the compiler's system branch
  // returns before the character scan.
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    const liveDesc = {
      tabs: [{ tabId: 'basics', tabLabel: 'Basics',
        sections: [{ sectionTitle: 'Intro', layout: 'full', blocks: [{ type: 'paragraph', content: 'live' }] }] }],
    };
    document.body.innerHTML = `
      <div id="compiler-modal-overlay" class="hidden">
        <h3>SMART COMPILER: <span id="compiler-char-name"></span></h3>
        <div id="compiler-modal-body"></div>
        <button id="btn-compiler-confirm"></button>
      </div>`;
    const captured = { update: null };
    window.supabaseClient = {
      from(table) {
        if (table === 'page_data') {
          return { select() { return this; }, eq() { return this; },
            single: async () => ({ data: { desc_data: liveDesc, frame_data: {} }, error: null }) };
        }
        return {
          update(payload) { captured.update = payload; return this; },
          delete() { return this; },
          eq() { return Promise.resolve({ error: null }); },
          in() { return Promise.resolve({ error: null }); },
        };
      },
    };
    window.adminConfirm = async () => true;
    window.adminAlert = () => {};
    window.currentUserId = 'staff-user';
    window.resetPreviewState = () => {};
    window.loadQueue = () => {};

    const config = { words: [{ word: 'Domain', colors: ['#123456'] }], houseStyle: 'Short.' };
    window.currentQueueData = [
      { id: 't-alice', page_id: 'basics', author_name: 'Alice', created_at: '2026-10-01T00:00:00Z',
        is_delta: true, target_scope: 'system_section', target_key: 'basics::intro',
        delta_payload: { sectionTitle: 'Intro', layout: 'full', blocks: [{ type: 'paragraph', content: 'Alice' }] },
        desc_data: {}, frame_data: {}, qa_metadata: { changelog: 'a', confidence: 'high', evidence: '' } },
      { id: 't-bob', page_id: 'basics', author_name: 'Bob', created_at: '2026-10-02T00:00:00Z',
        is_delta: true, target_scope: 'pageConfig', target_key: 'full', delta_payload: config,
        desc_data: {}, frame_data: {}, qa_metadata: { changelog: 'b', confidence: 'high', evidence: '' } },
    ];

    await window.openMergeCompiler('basics');
    const cards = [...document.querySelectorAll('.compiler-conflict-title')].map(t => t.textContent);
    document.querySelectorAll('.compiler-conflict-card select').forEach(sel => {
      sel.value = sel.options[sel.options.length - 1].value;
    });
    await document.getElementById('btn-compiler-confirm').onclick();

    const merged = captured.update;
    const applied = window.applyDeltaToData(liveDesc, {}, merged.target_scope, merged.target_key, merged.delta_payload).newDesc;
    return { cards, deltas: merged.delta_payload, applied };
  });

  expect(result.cards.some(t => t.startsWith('Page Settings'))).toBe(true);
  expect(result.deltas).toContainEqual({ scope: 'pageConfig', key: 'full', payload: { words: [{ word: 'Domain', colors: ['#123456'] }], houseStyle: 'Short.' } });
  expect(result.applied.pageConfig.houseStyle).toBe('Short.');
  expect(result.applied.tabs[0].sections[0].blocks[0].content, 'Alice\'s edit survives too').toBe('Alice');
});
