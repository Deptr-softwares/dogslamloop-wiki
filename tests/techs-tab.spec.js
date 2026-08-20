// The Techs tab: an OPTIONAL character tab, off unless the owner turns it on.
//
// Two claims, and they fail in opposite directions:
//
//   1. Off by default, and invisible EVERYWHERE when off - the character page,
//      the editor and the reviewer's preview. The owner asked for that
//      explicitly. The failure mode is an empty Techs tab on all 22 characters.
//   2. On when the flag says so, and then actually usable - the button
//      switches, the tab renders, and it renders the TECHS vocabulary rather
//      than Combos' words.
//
// The vocabulary lives in js/character_tabs.js and the flag in
// page_data.tab_settings, so this file derives what it can from the module
// rather than restating the list - see tests/character-tab-vocabulary.spec.js
// for why restating it is the bug this project has already paid for twice.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadVocabulary() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'character_tabs.js'), 'utf8');
  const fakeWindow = {};
  new Function('window', src)(fakeWindow);
  return fakeWindow;
}

const vocab = loadVocabulary();

// Mocks the page_data row a character page boots from. `tabSettings` is the
// only thing that varies, which is the point: everything else is held still so
// a difference in the strip can only have come from the flag.
function mockPageData(page, tabSettings, descData) {
  return page.addInitScript(({ settings, desc }) => {
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
                    desc_data: desc,
                    frame_data: { m1s: [], skills: [], specials: [] },
                    tab_settings: settings,
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
  }, { settings: tabSettings, desc: descData || {} });
}

// --- THE REGISTRY ---

test('techs is optional, and sits between Combos and Starter Guide', () => {
  const techs = vocab.CHARACTER_TABS.find(t => t.id === 'techs');
  expect(techs, 'the vocabulary must declare a techs tab').toBeTruthy();
  expect(techs.optional, 'techs is the optional one').toBe(true);
  expect(techs.documentTab, 'techs is Combos shape').toBe(true);

  // Position is part of the owner's spec, so it is asserted against the full
  // vocabulary rather than the filtered list - the filtered list does not
  // contain techs at all until the flag is on, which is the next test.
  const ids = vocab.CHARACTER_TABS.map(t => t.id);
  const at = ids.indexOf('techs');
  expect(ids[at - 1]).toBe('combos');
  expect(ids[at + 1]).toBe('starterGuide');
});

test('an optional tab is absent from every derived list until it is switched on', () => {
  // The default, with nothing set. This is what every one of the fourteen
  // consumers sees, which is the whole mechanism.
  expect(vocab.getCharacterTabIds()).not.toContain('techs');
  expect(vocab.getCharacterTabIds({ includeInjected: true, editableOnly: true })).not.toContain('techs');

  // ...but it IS in the list the markup is built from, or page_router would
  // never draw a button for applyOptionalTabVisibility to un-hide.
  expect(vocab.getCharacterTabIds({ includeOptional: true })).toContain('techs');

  vocab.setOptionalCharacterTabs({ techs: true });
  expect(vocab.getCharacterTabIds()).toContain('techs');
  expect(vocab.getCharacterTabIds({ includeInjected: true, editableOnly: true })).toContain('techs');

  // And ordering survives the filter - the tab has to arrive in its declared
  // position, not appended to the end.
  const on = vocab.getCharacterTabIds();
  expect(on[on.indexOf('techs') - 1]).toBe('combos');
  expect(on[on.indexOf('techs') + 1]).toBe('starterGuide');

  vocab.setOptionalCharacterTabs(null);
  expect(vocab.getCharacterTabIds()).not.toContain('techs');
});

test('a junk tab_settings value fails closed rather than throwing', () => {
  // The column has a CHECK constraint keeping it an object, but a cached page
  // or a failed fetch can still hand any of these over, and a character page
  // must not die on one.
  for (const junk of [null, undefined, 'techs', 42, [], { techs: 'yes' }, { techs: false }]) {
    expect(() => vocab.setOptionalCharacterTabs(junk)).not.toThrow();
    expect(vocab.getCharacterTabIds(), `${JSON.stringify(junk)} must not enable techs`).not.toContain('techs');
  }

  // An array IS accepted - the admin preview reasons in ids - and a key naming
  // a tab that is not optional cannot smuggle anything in.
  vocab.setOptionalCharacterTabs(['techs']);
  expect(vocab.getCharacterTabIds()).toContain('techs');
  vocab.setOptionalCharacterTabs({ techs: true, combos: true, notATab: true });
  expect(vocab.getEnabledOptionalTabs()).toEqual(['techs']);
  vocab.setOptionalCharacterTabs(null);
});

test('the techs sections are the combos sections with the owner vocabulary', () => {
  const combos = vocab.getDocumentSections('combos');
  const techs = vocab.getDocumentSections('techs');

  // Same shape...
  expect(Object.keys(combos).sort()).toEqual(Object.keys(techs).sort());

  // ...different words, per the owner 2026-08-18.
  expect(combos.intro.label).toBe('Read First');
  expect(techs.intro.label).toBe('Technical Overview');
  expect(combos.groups.entryLabel).toBe('Combo Group');
  expect(techs.groups.entryLabel).toBe('Tech Group');
  expect(combos.list.label).toBe('Combo List');
  expect(techs.list.label).toBe('Tech List');
  expect(combos.list.entryNoun).toBe('Starter');
  expect(techs.list.entryNoun).toBe('Theory');

  // ...and different FIELDS and SCOPES. This is the claim that matters most:
  // if either were shared, a tech delta could overwrite a combo of the same
  // name, and a reviewer approving one would silently change the other.
  const fields = [combos.intro.field, combos.groups.field, combos.list.field,
    techs.intro.field, techs.groups.field, techs.list.field];
  expect(new Set(fields).size, 'every document field is distinct').toBe(6);

  const scopes = [combos.intro.scope, combos.groups.scope, combos.list.scope,
    techs.intro.scope, techs.groups.scope, techs.list.scope];
  expect(new Set(scopes).size, 'every document scope is distinct').toBe(6);

  // The Tech List is keyed by theory, not by starter.
  expect(techs.list.keyField).toBe('theory');
});

test('every techs section is in the pipeline the reviewer and merge compiler read', () => {
  // The failure this guards is bug 4's shape, and it is silent: a section that
  // renders and edits but is missing from the vocabulary lists gets submitted,
  // approved, and never applied.
  const keyedScopes = vocab.getKeyedSections().map(s => s.scope);
  expect(keyedScopes).toContain('techGroup');
  expect(keyedScopes).toContain('techTable');

  const fixedScopes = vocab.FIXED_BLOCK_SECTIONS.map(s => s.scope);
  expect(fixedScopes).toContain('techIntro');

  // Lookups both ways, because applyDeltaToData resolves by scope and the
  // editor resolves by field.
  expect(vocab.getKeyedSectionByScope('techGroup').field).toBe('techGroups');
  expect(vocab.getKeyedSectionByField('techList').scope).toBe('techTable');
});

test('the pipeline keeps working for a page whose flag was turned OFF after a ticket was raised', () => {
  // Deliberate asymmetry, and the reason the flag filters getCharacterTabs and
  // NOT getKeyedSections. A reviewer approving a queued tech edit on a
  // character the owner has since switched Techs off for must still WRITE that
  // edit - dropping it would be a success modal over a no-op.
  vocab.setOptionalCharacterTabs(null);
  expect(vocab.getCharacterTabIds()).not.toContain('techs');

  expect(vocab.getKeyedSectionByScope('techGroup'), 'the scope must still resolve').toBeTruthy();
  expect(vocab.getDocumentSections('techs'), 'the shape must still resolve').toBeTruthy();
});

// --- THE READER PAGE ---

test('a character with no flag shows no Techs tab, and one with it does', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await mockPageData(page, {});
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  // The button EXISTS - page_router draws it for every character - and is not
  // visible. Asserting absence from the DOM would pass for the wrong reason if
  // the router simply stopped drawing it, which would break the un-hide path.
  await expect(page.locator('#nav-techs')).toHaveCount(1);
  await expect(page.locator('#nav-techs')).toBeHidden();
  expect(errors).toEqual([]);
});

test('the Techs tab appears, switches, and renders its own vocabulary when on', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await mockPageData(page, { techs: true }, {
    techIntro: [{ type: 'paragraph', content: 'Read this before the techs.' }],
    techGroups: [{ title: 'Wall Techs', content: [] }],
    techList: [{ theory: 'Momentum', rows: [{ sequence: ['5H', '2M'], damage: '20' }] }],
  });
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  await expect(page.locator('#nav-techs')).toBeVisible();

  // Drive the control, not just assert it rendered: the Combos and Starter
  // Guide tabs once shipped drawn and completely inert because setupTabs never
  // heard about them, and that is exactly the risk a tab bound before its flag
  // is known re-introduces.
  await page.locator('#nav-techs').click();
  await expect(page.locator('#tab-techs')).not.toHaveClass(/\bhidden\b/);
  await expect(page.locator('#tab-combos')).toHaveClass(/\bhidden\b/);

  // The owner's words, not Combos'.
  const text = await page.locator('#tab-techs').innerText();
  // Case-insensitive: .combo-group-title is uppercased in CSS, so the rendered
  // text is "WALL TECHS". Asserting the styled casing would pin this to a
  // stylesheet rule that has nothing to do with the claim.
  const said = (needle) => expect(text.toLowerCase()).toContain(needle.toLowerCase());
  const neverSaid = (needle) => expect(text.toLowerCase()).not.toContain(needle.toLowerCase());
  said('Technical Overview');
  said('Read this before the techs.');
  said('Wall Techs');
  said('Tech List');
  said('Momentum');
  neverSaid('Read First');
  neverSaid('Combo List');

  expect(errors, 'opening the Techs tab must not throw').toEqual([]);
});

test('Techs and Combos render into their own containers, not each other', async ({ page }) => {
  // Both tabs use the same composer and the same CSS classes, and the ids it
  // mints used to be literals ('combo-intro-content'). With two document tabs
  // on one page that put the second tab's prose inside the first one's.
  await mockPageData(page, { techs: true }, {
    comboIntro: [{ type: 'paragraph', content: 'COMBO PROSE MARKER' }],
    techIntro: [{ type: 'paragraph', content: 'TECH PROSE MARKER' }],
  });
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  const combos = await page.locator('#tab-combos').innerText();
  const techs = await page.locator('#tab-techs').innerText();

  expect(combos).toContain('COMBO PROSE MARKER');
  expect(combos).not.toContain('TECH PROSE MARKER');
  expect(techs).toContain('TECH PROSE MARKER');
  expect(techs).not.toContain('COMBO PROSE MARKER');
});

// --- THE EDITOR AND REVIEWER SURFACES ---

test('admin.html and edit.html ship the Techs button and panel, hidden', () => {
  // The vocabulary spec checks markup exists for every tab it can SEE, and it
  // cannot see an optional tab that is off - so that check walks straight past
  // Techs and this one has to make it instead.
  const adminHtml = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  const editHtml = fs.readFileSync(path.join(ROOT, 'edit.html'), 'utf8');

  expect(adminHtml).toContain('id="nav-techs"');
  expect(adminHtml).toContain('id="tab-techs"');
  expect(editHtml).toContain('id="edit-nav-techs"');
  expect(editHtml).toContain('id="tab-techs"');

  // Shipped HIDDEN. A button that ships visible is a Techs tab on every
  // character in the editor, which is the half of the feature that was
  // explicitly asked for.
  const adminBtn = adminHtml.match(/<button id="nav-techs"[^>]*>/)[0];
  const editBtn = editHtml.match(/<button id="edit-nav-techs"[^>]*>/)[0];
  expect(adminBtn).toContain('hidden');
  expect(editBtn).toContain('hidden');
});
