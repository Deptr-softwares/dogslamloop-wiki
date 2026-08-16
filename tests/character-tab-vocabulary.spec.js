// The character tab vocabulary has exactly one definition.
//
// js/character_tabs.js owns the list of character tabs. Before it existed, the
// list was written out by hand at ~20 sites across 13 files - ten JS modules
// and three HTML pages. Crucially, none of those copies were wrong: each was a
// deliberately different subset (admin.html has no Ultimate button because
// admin-modes.js injects it; gallery is absent everywhere in the editor because
// it has no editor). That is what made adding a tab dangerous - the correct
// answer differed per site, and nothing checked it.
//
// This project has already paid for that once, with page types: see
// scripts/page-types.js's header. Its lesson is the one applied here - derive
// the expectation, never restate the list, because restating it is how the
// drift happened.
//
// The test that matters most is the last one: it fails if a tab is added to the
// vocabulary but its button is missing from admin.html or edit.html, which is
// precisely the mistake adding Combos and Starter Guide by hand would have made.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VOCAB_FILE = path.join(ROOT, 'js', 'character_tabs.js');

// Loaded by evaluating the real module against a stand-in window, so this file
// never holds a second copy of the list it is policing.
function loadVocabulary() {
  const src = fs.readFileSync(VOCAB_FILE, 'utf8');
  const fakeWindow = {};
  new Function('window', src)(fakeWindow);
  return fakeWindow;
}

const vocab = loadVocabulary();
const ALL_IDS = vocab.CHARACTER_TABS.map(t => t.id);
const ALL_LABELS = vocab.CHARACTER_TABS.map(t => t.label);

test('the vocabulary module loads and describes every tab', () => {
  expect(ALL_IDS.length).toBeGreaterThan(0);
  for (const tab of vocab.CHARACTER_TABS) {
    expect(tab.id, 'every tab needs an id').toBeTruthy();
    expect(tab.label, `${tab.id} needs a label`).toBeTruthy();
    expect(tab.panelClass, `${tab.id} needs a panel class`).toBeTruthy();
  }
  // Exactly one tab starts visible, or page_router and admin-preview disagree
  // about what a freshly loaded page looks like.
  expect(vocab.CHARACTER_TABS.filter(t => t.isDefault)).toHaveLength(1);
});

test('no other JS file restates the tab list', () => {
  // Finds array literals whose quoted contents are all tab ids. Three is the
  // threshold: `['skills', 'specials']` is plausibly an unrelated pair, but
  // three known tab ids in a row is a copy of the vocabulary.
  //
  // Covers tests/ as well as js/. The first copy this missed lived in
  // tests/page-skeleton-parity.spec.js, and a spec holding its own copy is
  // worse than a module holding one - it turns a real regression into a green
  // suite, or a vocabulary change into a spurious failure.
  const offenders = [];
  const jsFiles = fs.readdirSync(path.join(ROOT, 'js'))
    .filter(f => f.endsWith('.js') && f !== 'character_tabs.js')
    .map(f => ['js', f]);
  const testFiles = fs.readdirSync(path.join(ROOT, 'tests'))
    .filter(f => f.endsWith('.spec.js') && f !== path.basename(__filename))
    .map(f => ['tests', f]);

  for (const [dir, name] of jsFiles.concat(testFiles)) {
    const src = fs.readFileSync(path.join(ROOT, dir, name), 'utf8');
    const arrays = src.match(/\[[^[\]{}()]*\]/g) || [];

    for (const literal of arrays) {
      const quoted = (literal.match(/'[^']*'|"[^"]*"/g) || [])
        .map(s => s.slice(1, -1));
      if (quoted.length < 3) continue;

      // Ids or labels. Labels matter as much: three specs restated the strip
      // as ['Overview & Strategy', 'M1s', ...] and an id-only scan walked
      // straight past them.
      const vocabulary = quoted.every(s => ALL_IDS.includes(s)) ? ALL_IDS
        : quoted.every(s => ALL_LABELS.includes(s)) ? ALL_LABELS
          : null;
      if (!vocabulary) continue;

      // In vocabulary order, or it is not a copy of the vocabulary. A spec
      // asserting which tabs one fixture happens to touch legitimately lists
      // tab ids - tests/revision-tab-nav.spec.js has ['matchups', 'overview',
      // 'skills'] - and that is data, not a restatement. A copy of the list
      // keeps the list's order; unordered data almost never does.
      const positions = quoted.map(s => vocabulary.indexOf(s));
      const inOrder = positions.every((p, i) => i === 0 || p > positions[i - 1]);
      if (!inOrder) continue;

      offenders.push(`${dir}/${name}: ${literal.replace(/\s+/g, ' ')}`);
    }
  }

  expect(
    offenders,
    'derive these from window.getCharacterTabIds() instead - see js/character_tabs.js'
  ).toEqual([]);
});

test('the reader page builds exactly the static tabs, in vocabulary order', async ({ page }) => {
  // Boomcat declares no modes and is not base-only, so it gets the plain strip.
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  const expected = vocab.getCharacterTabIds();
  const rendered = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.character-nav button[id^="nav-"]')).map(b => b.id.slice(4))
  );

  expect(rendered).toEqual(expected);

  // And every one has the panel it switches to. A button with no panel is a
  // tab that looks present and does nothing when clicked.
  for (const id of expected) {
    await expect(page.locator(`#tab-${id}`)).toHaveCount(1);
  }
});

test('clicking a tab actually switches to it', async ({ page }) => {
  // The strip rendering is not the claim; the strip working is. Drives the
  // last static tab, which is the one a broken setupTabs id list drops first.
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  const ids = vocab.getCharacterTabIds();
  const target = ids[ids.length - 1];

  await page.locator(`#nav-${target}`).click();

  // Asserts the `hidden` class rather than toBeVisible(): the last tab is
  // Gallery, which has no handler and renders an empty div. An empty div has
  // zero height, so it is never "visible" to Playwright even when the switch
  // worked perfectly. The structural claim is which panel is hidden.
  await expect(page.locator(`#tab-${target}`)).not.toHaveClass(/\bhidden\b/);
  await expect(page.locator(`#tab-${vocab.getDefaultCharacterTabId()}`)).toHaveClass(/\bhidden\b/);
  await expect(page.locator(`#nav-${target}`)).toHaveClass(/\bactive\b/);
  expect(errors, 'switching tabs must not throw').toEqual([]);
});

test('a base-only character gets Ultimate between Counterplay and Gallery', async ({ page }) => {
  // The owner's stated vocabulary, 2026-08-16: base-only characters carry one
  // extra tab, and its position is part of the contract - Gallery reads as the
  // end of the page, so an Ultimate tab past it is the one nobody scrolls to.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          const orig = lib.createClient.bind(lib);
          lib.createClient = (...args) => {
            const client = orig(...args);
            const origFrom = client.from.bind(client);
            client.from = (table) => {
              if (table !== 'page_data') return origFrom(table);
              const chain = {
                select() { return chain; },
                eq() { return chain; },
                single: async () => ({
                  data: {
                    desc_data: {},
                    frame_data: {
                      m1s: [], skills: [], specials: [],
                      ultimateAtk: [{ id: 'u', name: 'Locust Swarm', stats: [] }],
                    },
                  },
                  error: null,
                }),
              };
              return chain;
            };
            client.auth.getSession = async () => ({ data: { session: null } });
            return client;
          };
          lib.__patched = true;
        }
      },
    });
  });

  // locust_guy is flagged is_base_only in the real registry.
  await page.goto('/characters/Locust_guy/index.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#nav-ultimateAtk')).toBeVisible();

  const rendered = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.character-nav button[id^="nav-"]')).map(b => b.id.slice(4))
  );

  // Derived from the vocabulary's own ordering, so moving the entry in
  // character_tabs.js is what moves this expectation.
  expect(rendered).toEqual(vocab.getCharacterTabIds({ includeInjected: true }));

  const ultimateAt = rendered.indexOf('ultimateAtk');
  expect(rendered[ultimateAt - 1]).toBe('counterplay');
  expect(rendered[ultimateAt + 1]).toBe('gallery');
});

test('admin.html and edit.html ship a button and a panel for every tab they own', () => {
  // THE point of this file. Adding a tab to the vocabulary without adding its
  // markup here gives a tab that exists for readers and is invisible to the
  // reviewer approving it - the same class of bug as v0.15's merged-ticket
  // diff, where a reviewer approved five edits while seeing two.
  //
  // The two surfaces genuinely differ, and the difference is data:
  //   admin.html - static editable tabs. Ultimate is injected by admin-modes.js.
  //   edit.html  - the same plus Ultimate, which it ships hidden and
  //                editor-modes.js un-hides for a base-only character.
  const adminHtml = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  const editHtml = fs.readFileSync(path.join(ROOT, 'edit.html'), 'utf8');

  const missing = [];

  for (const id of vocab.getCharacterTabIds({ editableOnly: true })) {
    if (!adminHtml.includes(`id="nav-${id}"`)) missing.push(`admin.html is missing button nav-${id}`);
    if (!adminHtml.includes(`id="tab-${id}"`)) missing.push(`admin.html is missing panel tab-${id}`);
  }

  for (const id of vocab.getCharacterTabIds({ includeInjected: true, editableOnly: true })) {
    if (!editHtml.includes(`id="edit-nav-${id}"`)) missing.push(`edit.html is missing button edit-nav-${id}`);
    // The PANEL as well as the button. Checking only the button was this
    // test's own blind spot: edit.html got its Starter Guide button and no
    // #tab-starterGuide, so the editor's live preview silently rendered
    // nothing while every other part of the tab worked.
    if (!editHtml.includes(`id="tab-${id}"`)) missing.push(`edit.html is missing panel tab-${id}`);
  }

  // Gallery has no editor at all; if that ever changes it should change here
  // deliberately rather than by a tab quietly appearing.
  const galleryTab = vocab.CHARACTER_TABS.find(t => t.id === 'gallery');
  expect(galleryTab && galleryTab.editable, 'gallery is deliberately not editable').toBe(false);

  expect(missing).toEqual([]);
});
