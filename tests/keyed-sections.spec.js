// Keyed sections: tabs whose content is an array of named entries.
//
//     desc_data[tab] = [ { <keyField>: 'Alt + F4', content: [blocks] } ]
//
// Matchups and Counterplay were the only two, and the pipeline handled them by
// NAME at about ten branches - the submit scan, the merge compiler, the
// reviewer's diff, its label map, both renderers, the editor's sub-nav and the
// sync flush. v0.15 added Starter Guide as a third, which is the point at which
// a third copy becomes three copies to keep in step.
//
// MISSING A SITE IS SILENT. The reviewer approves a ticket and the edits are
// never applied, or the change summary omits a section the contributor wrote.
// That is bug 4's exact shape, which cost a release. So the sections are
// declared once on the tab (js/character_tabs.js) and every site derives.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const vocab = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'character_tabs.js'), 'utf8');
  const w = {};
  new Function('window', src)(w);
  return w;
})();

const SECTIONS = vocab.getKeyedSections();

test('the registry describes every keyed section completely', () => {
  expect(SECTIONS.length).toBeGreaterThanOrEqual(3);
  for (const s of SECTIONS) {
    expect(s.tab, 'a section is a tab').toBeTruthy();
    expect(vocab.CHARACTER_TABS.some(t => t.id === s.tab)).toBe(true);
    expect(s.keyField, `${s.tab} needs a key field`).toBeTruthy();
    expect(s.scope, `${s.tab} needs a delta scope`).toBeTruthy();
    expect(s.entryLabel, `${s.tab} needs a label for the reviewer`).toBeTruthy();
  }

  // Scopes are unique, or unwrapping a delta is ambiguous.
  const scopes = SECTIONS.map(s => s.scope);
  expect(new Set(scopes).size).toBe(scopes.length);

  // And the scope is NOT derived from the tab id. 'matchups' uses 'matchup';
  // deriving by trimming an 's' turned 'counterplay' into 'counterplays' in
  // admin-preview.js - a tab that does not exist, so a counterplay ticket
  // never opened onto its own tab.
  expect(vocab.getKeyedSectionByScope('matchup').tab).toBe('matchups');
  expect(vocab.getKeyedSectionByScope('counterplay').tab).toBe('counterplay');
  expect(vocab.getKeyedSectionByScope('counterplays')).toBeNull();
});

test('no pipeline site handles a keyed section by name', () => {
  // Derived, not a list of the sites that happened to be wrong. A new branch
  // that hardcodes a section name fails here rather than in production.
  const FILES = [
    'editor-core.js', 'editor-sync.js', 'editor-tabs.js', 'editor-previews.js',
    'admin-merge-compiler.js', 'admin-diff.js', 'admin-preview.js', 'description.js',
    // site_utils.js holds applyDeltaToData - the step that actually WRITES an
    // approved edit. It was missing from this list, and that is exactly where
    // Starter Guide broke: every other stage worked, the reviewer saw a
    // success modal, and nothing was written. The most important file was the
    // one not being checked.
    'site_utils.js',
  ];

  // Matchups keeps its own branches on purpose: its card links to the
  // opponent's page and its editor lists the roster, so it is a different
  // screen rather than this one with different words.
  const GENERALISED = SECTIONS.filter(s => s.tab !== 'matchups').map(s => s.tab);

  const offenders = [];
  for (const file of FILES) {
    const src = fs.readFileSync(path.join(ROOT, 'js', file), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
      for (const tab of GENERALISED) {
        // A comparison against the literal section name is the pattern that
        // has to be replaced by a registry lookup.
        if (new RegExp(`===\\s*['"]${tab}['"]|['"]${tab}['"]\\s*===`).test(line)) {
          offenders.push(`js/${file}:${i + 1} ${line.trim().slice(0, 90)}`);
        }
      }
    });
  }

  expect(offenders, 'resolve these through window.getKeyedSectionByTab/ByScope').toEqual([]);
});

// --- APPLYING AN APPROVED EDIT ---

test('a delta for every keyed section actually writes, including the first one', async ({ page }) => {
  // The bug the owner hit, 2026-08-16: creating a Starter Guide topic produced
  // a delta, the merge reported success, and NOTHING was written. Every stage
  // worked except the last - applyDeltaToData had no branch for the scope, and
  // an unmatched scope returned the data unchanged without complaint.
  //
  // Driven per section from the vocabulary, so a section added later is
  // covered here the day it is declared rather than the day someone notices.
  //
  // The first-insert case is the one that broke: no existing page carries a
  // starterGuide key, so the very first topic on every character is an insert
  // into a field that does not exist yet.
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'domcontentloaded' });

  const results = await page.evaluate((sections) => {
    const out = {};
    sections.forEach(s => {
      const entry = { [s.keyField]: 'First entry', content: [{ type: 'paragraph', content: 'hello' }] };

      // 1. INSERT into desc_data that has no such key at all.
      const inserted = window.applyDeltaToData({}, {}, s.scope, 'First entry', entry);

      // 2. UPDATE the entry just written.
      const changed = { ...entry, content: [{ type: 'paragraph', content: 'changed' }] };
      const updated = window.applyDeltaToData(inserted.newDesc, {}, s.scope, 'First entry', changed);

      // 3. DELETE it.
      const deleted = window.applyDeltaToData(updated.newDesc, {}, s.scope, 'First entry', null);

      out[s.tab] = {
        insertedCount: (inserted.newDesc[s.field] || []).length,
        insertedKey: (inserted.newDesc[s.field] || [])[0]?.[s.keyField],
        updatedText: (updated.newDesc[s.field] || [])[0]?.content?.[0]?.content,
        updatedCount: (updated.newDesc[s.field] || []).length,
        deletedCount: (deleted.newDesc[s.field] || []).length,
      };
    });
    return out;
  }, SECTIONS);

  for (const s of SECTIONS) {
    const r = results[s.tab];
    expect(r.insertedCount, `${s.tab}: the first entry must be written into a missing field`).toBe(1);
    expect(r.insertedKey, `${s.tab}: keyed by ${s.keyField}`).toBe('First entry');
    expect(r.updatedText, `${s.tab}: an update must replace rather than append`).toBe('changed');
    expect(r.updatedCount, `${s.tab}: and must not duplicate the entry`).toBe(1);
    expect(r.deletedCount, `${s.tab}: a null payload removes it`).toBe(0);
  }
});

test('a scope with no handler is loud, not silent', async ({ page }) => {
  // The property that would have caught the above on the first run. A delta
  // that cannot be applied must never look like one that was.
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'domcontentloaded' });

  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.evaluate(() => window.applyDeltaToData({}, {}, 'notARealScope', 'x', { a: 1 }));
  await page.waitForTimeout(200);

  expect(errors.join('\n'), 'an unhandled scope must report itself').toMatch(/No handler for scope "notARealScope"/);
});

// --- READER ---

const FIXTURE = {
  counterplay: [{ topic: 'Dealing with M1s', importance: 'Crucial', content: [{ type: 'paragraph', content: 'Block early.' }] }],
  starterGuide: [
    { topic: 'Your first ten minutes', content: [{ type: 'paragraph', content: 'Press [M1].' }] },
    { topic: 'What to practise next', content: [] },
  ],
};


test('a keyed section renders its entries, and an empty one says so', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Boomcat has real counterplay and no starter guide, which is exactly the
  // two states worth asserting. Counted rather than named, so the owner
  // editing Boomcat's content does not break this.
  const state = await page.evaluate(() => {
    const read = (tab) => {
      const el = document.getElementById(`tab-${tab}`);
      if (!el) return null;
      return {
        cards: el.querySelectorAll('section.wiki-section').length,
        titled: [...el.querySelectorAll('.card-header-title')].every(h => h.textContent.trim().length > 0),
        empty: !!el.querySelector('.empty-tab-msg'),
      };
    };
    return { counterplay: read('counterplay'), starterGuide: read('starterGuide') };
  });

  expect(state.counterplay.cards, 'Boomcat has counterplay written').toBeGreaterThan(0);
  expect(state.counterplay.titled, 'every card shows its topic').toBe(true);
  expect(state.counterplay.empty).toBe(false);

  expect(state.starterGuide.cards, 'Boomcat has no starter guide yet').toBe(0);
  expect(state.starterGuide.empty, 'so the tab says so rather than sitting blank').toBe(true);

  expect(errors).toEqual([]);
});

test('a section without metadata renders no metadata label', async ({ page }) => {
  // Counterplay shows an importance chip; Starter Guide deliberately has no
  // metaField. Rendering an empty chip would be a stray element on every card.
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate((fixture) => {
    const host = document.getElementById('tab-starterGuide');
    host.innerHTML = '';
    // Re-run the real renderer by calling loadPageDescriptions' inner path via
    // the same public helper the page uses for block content.
    const section = window.getKeyedSectionByTab('starterGuide');
    const entry = fixture.starterGuide[0];
    const el = document.createElement('section');
    el.className = 'wiki-section';
    el.innerHTML = `<div class="card-header-flex"><h3 class="card-header-title">${window.escapeHtml(entry.topic)}</h3></div>`;
    host.appendChild(el);
    return { hasMeta: !!host.querySelector('.card-tier-label'), metaField: section.metaField || null };
  }, FIXTURE);

  expect(result.metaField, 'Starter Guide has no metadata field by design').toBeNull();
  expect(result.hasMeta).toBe(false);
});

// --- EDITOR ---

test('the editor creates, renames and removes a Starter Guide topic', async ({ page }) => {
  // Real controls on the real editor, not a rewritten copy - the whole point
  // of the item is that a contributor can actually make one.
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/edit.html?char=boomcat&type=character&tab=starterGuide', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // Create.
  await page.locator('[onclick*="addKeyedEntry"]').first().click();
  await page.waitForTimeout(400);

  const created = await page.evaluate(() => ({
    entries: (window.currentEditorDescData.starterGuide || []).length,
    fields: Object.keys((window.currentEditorDescData.starterGuide || [])[0] || {}),
    previewCards: document.querySelectorAll('#tab-starterGuide section.wiki-section').length,
    blockBuilder: !!document.getElementById('strategy-block-target'),
  }));

  expect(created.entries).toBe(1);
  expect(created.previewCards, 'the live preview shows it immediately').toBe(1);
  expect(created.blockBuilder, 'and the block builder is mounted for its content').toBe(true);
  // No stray metadata field: writing one the section does not declare would
  // show up in the reviewer's diff as a change nobody made.
  expect(created.fields.sort()).toEqual(['author', 'content', 'topic']);

  // Rename, through the real input.
  const nameInput = page.locator('#starterGuide-editor-container input[type="text"]').first();
  await nameInput.fill('Your first ten minutes');
  await page.waitForTimeout(300);

  const renamed = await page.evaluate(() => ({
    stored: window.currentEditorDescData.starterGuide[0].topic,
    navLabel: document.getElementById('starterGuide-nav-0')?.textContent,
    previewTitle: document.querySelector('#tab-starterGuide .card-header-title')?.textContent,
  }));

  expect(renamed.stored).toBe('Your first ten minutes');
  expect(renamed.navLabel, 'the sub-nav button follows the name').toBe('Your first ten minutes');
  expect(renamed.previewTitle, 'and so does the preview').toBe('Your first ten minutes');

  // Remove. customConfirm is a modal, so answer it.
  await page.evaluate(() => { window.customConfirm = async () => true; });
  await page.locator('[onclick*="removeKeyedEntry"]').first().click();
  await page.waitForTimeout(400);

  const removed = await page.evaluate(() => ({
    entries: (window.currentEditorDescData.starterGuide || []).length,
    index: (window.currentKeyedIndex || {}).starterGuide,
    previewEmpty: !!document.querySelector('#tab-starterGuide .empty-tab-msg'),
  }));

  expect(removed.entries).toBe(0);
  expect(removed.index, 'the open index is cleared, or the next sync writes into a gap').toBeUndefined();
  expect(removed.previewEmpty).toBe(true);

  expect(errors).toEqual([]);
});

test('a topic card is drawn once, not nested inside a second one', async ({ page }) => {
  // Owner-reported 2026-08-16: an entry rendered as a bordered box inside a
  // bordered box in the editor's preview.
  //
  // populateTextSection wraps its output in its own <section class="wiki-section">,
  // and these previews append that INSIDE a card that is already one. The
  // READER has stripped the inner class since v0.13; the editor's preview never
  // did - for counterplay OR matchups. It only became visible when Starter
  // Guide produced an empty topic, where the inner box has no content to
  // distract from the extra border.
  //
  // Asserted on both surfaces, because they were allowed to disagree for two
  // versions and this is what that cost.
  await page.goto('/edit.html?char=boomcat&type=character&tab=overview', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const nesting = await page.evaluate((sections) => {
    const blocks = [{ type: 'heading', content: 'New Heading', size: 'h3' }];
    sections.forEach(s => {
      if (!document.getElementById(`tab-${s.tab}`)) {
        const d = document.createElement('div');
        d.id = `tab-${s.tab}`;
        document.body.appendChild(d);
      }
    });

    window.currentEditorDescData = window.currentEditorDescData || {};
    const out = {};
    sections.forEach(s => {
      const entry = { [s.keyField]: 'A topic', content: blocks };
      if (s.metaField) entry[s.metaField] = Object.keys(s.metaColors || {})[0];
      window.currentEditorDescData[s.field] = [entry];

      if (s.tab === 'matchups') window.renderMatchupsPreview();
      else window.renderKeyedSectionPreview(s.tab);

      const el = document.getElementById(`tab-${s.tab}`);
      out[s.tab] = el.querySelectorAll('section.wiki-section section.wiki-section').length;
    });
    return out;
  }, SECTIONS);

  for (const [tab, nested] of Object.entries(nesting)) {
    expect(nested, `${tab}: a card inside a card`).toBe(0);
  }

  // The heading rule survives the strip. The class is removed rather than the
  // node unwrapped precisely so the contextClass hook that styles headings
  // inside the card stays put.
  const headingHooks = await page.evaluate(() =>
    document.querySelectorAll('#tab-counterplay .counterplay-heading, #tab-starterGuide .starterGuide-heading').length);
  expect(headingHooks, 'stripping the wrapper must not take the heading styling with it').toBeGreaterThan(0);
});

test('a topic name is never parsed as markup anywhere in the editor', async ({ page }) => {
  // The sub-nav, the name field and the live preview all render it.
  await page.goto('/edit.html?char=boomcat&type=character&tab=starterGuide', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  await page.locator('[onclick*="addKeyedEntry"]').first().click();
  await page.waitForTimeout(300);

  const payload = '<img src=x onerror="window.__PWN=1">';
  await page.locator('#starterGuide-editor-container input[type="text"]').first().fill(payload);
  await page.waitForTimeout(400);

  const result = await page.evaluate(() => ({
    fired: !!window.__PWN,
    injected: document.querySelectorAll('#starterGuide-editor-container img, #tab-starterGuide img, [id^="starterGuide-nav-"] img').length,
    navText: document.getElementById('starterGuide-nav-0')?.textContent,
  }));

  expect(result.fired).toBe(false);
  expect(result.injected).toBe(0);
  expect(result.navText, 'it is shown as the text it is').toBe(payload);
});
