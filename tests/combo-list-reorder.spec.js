// v0.18 F3 and F4 - a Combo List can be reordered, and so can the rows in one.
//
// Combo groups got reordering in v0.15 item 8; the list beside them never did,
// so three Combo Lists could only be read in the order they were created in.
// The owner reported it as "I created 3 Combo Lists, I can't change their
// ordering", and separately that the rows inside one could not be moved either.
//
// TWO ITEMS IN ONE FILE, because they are one screen and they share this
// file's Supabase capture harness. They are NOT one mechanism, and the section
// divider below says why: a list entry is a strip entry with a selected state,
// and a row is neither.
//
// TWO HALVES, AND ONLY ONE OF THEM WAS BUILT FOR THIS ITEM.
//
// The strip control is new. The submit and apply halves were supposed to be
// free, because desc.comboList is already an EXTRA_KEYED_SECTION
// (js/character_tabs.js:410) keyed by `starter`, and scanEveryOrder walks every
// keyed section. That is an ASSUMPTION about code nobody changed, which is
// exactly the kind that turns out to be wrong after the feature ships - so the
// second test here drives a real submit and reads what reached the insert,
// rather than asserting that the wiring looks right.
//
// The `Zzq` prefix is deliberate: these tests run against boomcat's real page
// data, and a fixture that could collide with the owner's own starters would be
// a test reading their content instead of its own.
const { test, expect } = require('@playwright/test');

const COMBOS = '/edit.html?char=boomcat&type=character&tab=combos';

const THREE_LISTS = [
  { starter: 'Zzq 5H', rows: [] },
  { starter: 'Zzq 2M', rows: [] },
  { starter: 'Zzq j.H', rows: [] },
];

// F4's fixture. comboRowSummary renders `sequence.join(' > ')`, so the sequence
// is what a row is identified by on screen.
const LIST_WITH_ROWS = [
  {
    starter: 'Zzq 5H',
    rows: [
      { sequence: ['Zzq Aaa'], damage: '10', difficulty: '', notes: '' },
      { sequence: ['Zzq Bbb'], damage: '20', difficulty: '', notes: '' },
      { sequence: ['Zzq Ccc'], damage: '30', difficulty: '', notes: '' },
    ],
  },
];

async function openComboList(page, lists) {
  await page.goto(COMBOS, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.moveListItem === 'function', { timeout: 15000 });
  await page.waitForTimeout(1500);

  await page.evaluate((seed) => {
    window.currentEditorDescData.comboList = JSON.parse(JSON.stringify(seed));
    initFullTabEditor('boomcat', 'combos', window.currentEditorDescData, window.currentEditorFrameData);
  }, lists);
  await page.waitForTimeout(500);

  await page.evaluate(() => window.loadDocumentSectionIntoEditor('combos', 'list'));
  await page.waitForTimeout(400);
}

// Scoped by the spec, not by position: the Combos tab draws TWO reorder bars -
// one for the groups strip and one for the list - and `.first()` would silently
// test the group strip that already worked.
const LIST_BAR = '.daw-reorder-group[data-reorder-list="desc.comboList"]';

test('the Combo List strip offers the reorder controls', async ({ page }) => {
  await openComboList(page, THREE_LISTS);

  await expect(page.locator(LIST_BAR)).toHaveCount(1);
  // Left, right, and insert-after.
  await expect(page.locator(`${LIST_BAR} .daw-tab-move-btn`)).toHaveCount(2);
  await expect(page.locator(`${LIST_BAR} .daw-tab-insert-btn`)).toHaveCount(1);
});

test('moving the selected Combo List reorders the underlying array', async ({ page }) => {
  await openComboList(page, THREE_LISTS);

  // Select the middle one. The controls read the active entry out of the DOM,
  // so nothing is movable until a starter is open.
  await page.locator('#combo-rows-panel [data-table="1"]').click();
  await page.waitForTimeout(300);

  await page.locator(`${LIST_BAR} .daw-tab-move-btn[data-reorder-dir="-1"]`).click();
  await page.waitForTimeout(500);

  const order = await page.evaluate(() =>
    window.currentEditorDescData.comboList.map(t => t.starter));
  expect(order).toEqual(['Zzq 2M', 'Zzq 5H', 'Zzq j.H']);

  // The entry that moved stays open. Losing the selection means the second
  // nudge of a two-step move acts on whatever slid into the slot instead -
  // the fault the fixed control bar was introduced to remove.
  const stillOpen = await page.evaluate(() =>
    window.currentEditorDescData.comboList[window.currentDocTableIndex].starter);
  expect(stillOpen).toBe('Zzq 2M');
});

test('a Combo List cannot be moved off either end', async ({ page }) => {
  await openComboList(page, THREE_LISTS);

  await page.locator('#combo-rows-panel [data-table="0"]').click();
  await page.waitForTimeout(300);
  await page.locator(`${LIST_BAR} .daw-tab-move-btn[data-reorder-dir="-1"]`).click();
  await page.waitForTimeout(400);

  const order = await page.evaluate(() =>
    window.currentEditorDescData.comboList.map(t => t.starter));
  expect(order, 'the first entry has nowhere to go left').toEqual(
    ['Zzq 5H', 'Zzq 2M', 'Zzq j.H']);
});

// --- v0.18 F4: THE ROWS INSIDE ONE COMBO LIST ---
//
// A different mechanism from everything above, and the file says so rather than
// leaving the next reader to wonder why. Rows are not `.daw-tab-item` entries
// and have no selected state - opening one opens a modal - so the fixed
// reorder bar, which acts on "the selected entry", has nothing to act on. The
// controls are per row, and vertical, because the list is.

async function openRows(page) {
  await openComboList(page, LIST_WITH_ROWS);
  await page.locator('#combo-rows-panel [data-table="0"]').click();
  await page.waitForTimeout(400);
}

const rowLabels = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.combo-row-open')].map(b => b.textContent.trim()));

test('a row can be moved down, and the list follows', async ({ page }) => {
  await openRows(page);

  await page.locator('.combo-row-item .combo-row-down[data-row="0"]').click();
  await page.waitForTimeout(400);

  // The rendered list, not just the array - a reorder the editor does not
  // redraw is one the contributor cannot see they made.
  expect(await rowLabels(page)).toEqual(['Zzq Bbb', 'Zzq Aaa', 'Zzq Ccc']);

  const order = await page.evaluate(() =>
    window.currentEditorDescData.comboList[0].rows.map(r => r.sequence[0]));
  expect(order).toEqual(['Zzq Bbb', 'Zzq Aaa', 'Zzq Ccc']);
});

test('the ends offer no move off the list', async ({ page }) => {
  await openRows(page);

  // Disabled rather than absent: the controls staying in the same place on
  // every row is what makes a two-step move one gesture repeated, and a button
  // that vanishes at the end moves everything below it.
  await expect(page.locator('.combo-row-up[data-row="0"]')).toBeDisabled();
  await expect(page.locator('.combo-row-down[data-row="2"]')).toBeDisabled();
  await expect(page.locator('.combo-row-down[data-row="0"]')).toBeEnabled();
  await expect(page.locator('.combo-row-up[data-row="2"]')).toBeEnabled();
});

test('the row summary belongs to the row, not to the slot', async ({ page }) => {
  await openRows(page);

  // The bug this guards: re-rendering by index while the array moved underneath
  // leaves each label attached to a position instead of to its content, so the
  // list looks unchanged and the data is reordered - or the reverse.
  await page.locator('.combo-row-item .combo-row-up[data-row="2"]').click();
  await page.waitForTimeout(400);

  const [labels, damages] = await Promise.all([
    rowLabels(page),
    page.evaluate(() => window.currentEditorDescData.comboList[0].rows.map(r => r.damage)),
  ]);
  expect(labels).toEqual(['Zzq Aaa', 'Zzq Ccc', 'Zzq Bbb']);
  expect(damages, 'each row carried its own fields along').toEqual(['10', '30', '20']);
});

// --- WHAT ACTUALLY REACHES THE DATABASE ---
//
// This is the falsification. If reordering alone produces no delta, the strip
// above is a control that appears to work and silently discards the change -
// which is exactly the bug filed as B2 against the system-page tab strip, and
// the one v0.15 fixed for character pages. Asserting that comboList appears in
// getKeyedSections() would assert the setup; this asserts the consequence.
//
// IT PASSES WITHOUT THE STRIP CONTROL, AND THAT IS THE POINT. The three tests
// above fail against the pre-F3 code; this one does not, because it is not a
// regression test for the control - it is a guard on the pipeline the control
// depends on. It goes red if desc.comboList ever leaves EXTRA_KEYED_SECTIONS,
// loses its keyField, or stops being walked by scanEveryOrder, any of which
// would turn the working control into B2 without touching this file.
// Do not "simplify" it away as passing-either-way.
async function bootWithCapture(page, desc) {
  await page.addInitScript((seedDesc) => {
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          const orig = lib.createClient.bind(lib);
          lib.createClient = (...args) => {
            const client = orig(...args);
            window.__inserted = [];

            client.auth.getSession = async () => ({
              data: { session: { user: { id: 'u1', email: 'editor@example.test' }, access_token: 'tok' } },
            });

            client.from = (table) => {
              if (table === 'page_data') {
                return {
                  select() { return this; }, eq() { return this; },
                  // A fresh copy per read: the editor mutates what it is handed,
                  // so one shared reference would make the submit-time collision
                  // check compare this session's edit against itself.
                  single: async () => ({
                    data: { desc_data: JSON.parse(JSON.stringify(seedDesc)), frame_data: {} },
                    error: null,
                  }),
                };
              }
              if (table === 'user_roles') {
                return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { role: 'admin' }, error: null }) };
              }
              if (table === 'page_permissions') {
                return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: null, error: null }) };
              }
              if (table === 'site_settings') {
                return { select() { return this; }, maybeSingle: async () => ({ data: { staff_bypass_submission_cooldown: true }, error: null }) };
              }
              if (table === 'pending_revisions') {
                return {
                  select() { return this; }, eq() { return this; },
                  single: async () => ({ data: null, error: { code: 'PGRST116' } }),
                  insert: async (rows) => { window.__inserted.push(...[].concat(rows)); return { error: null }; },
                };
              }
              return {
                select() { return this; }, eq() { return this; },
                order() { return this; }, limit: async () => ({ data: [], error: null }),
                maybeSingle: async () => ({ data: null, error: null }),
                single: async () => ({ data: null, error: { code: 'PGRST116' } }),
              };
            };
            return client;
          };
          lib.__patched = true;
        }
      },
    });
  }, desc);

  await page.goto(COMBOS, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.removeItem('wiki_last_submit_time');
    window.openQAModal = async () => ({ changelog: 'Reordered the starters.', confidence: 'high', evidence: '' });
  });
}

test('reordering Combo Lists and nothing else still submits', async ({ page }) => {
  const desc = { comboIntro: [], comboGroups: [], comboList: THREE_LISTS };
  await bootWithCapture(page, desc);

  // Order-only. No entry's content differs, so every identity-paired scan finds
  // a byte-identical partner and produces nothing - which is precisely why the
  // order scope exists.
  await page.evaluate(() => {
    const list = window.currentEditorDescData.comboList;
    const [first] = list.splice(0, 1);
    list.push(first);
  });

  await page.locator('#submit-payload-btn').click();
  await expect.poll(() => page.evaluate(() => (window.__inserted || []).length)).toBeGreaterThan(0);

  const ticket = await page.evaluate(() => window.__inserted[0]);

  // A LONE DELTA IS NOT WRAPPED. buildPayload emits a full row, and only a
  // submission carrying more than one delta is folded into a `multi` envelope
  // whose delta_payload is the list of them. Reordering and nothing else
  // produces exactly one, so it arrives as target_scope/target_key with the new
  // sequence as its payload - and reading it as a multi batch gave three
  // `undefined` scopes that looked like a code fault and were three strings.
  const deltas = ticket.target_scope === 'multi'
    ? ticket.delta_payload.map(d => `${d.scope}:${d.key ?? ''}`)
    : [`${ticket.target_scope}:${ticket.target_key ?? ''}`];

  expect(deltas, 'an order-only change must not be reported as "no changes detected"')
    .toContain('order:desc.comboList');

  const payload = ticket.target_scope === 'multi'
    ? ticket.delta_payload.find(d => d.scope === 'order' && d.key === 'desc.comboList').payload
    : ticket.delta_payload;
  expect(payload).toEqual(['Zzq 2M', 'Zzq j.H', 'Zzq 5H']);
});

test('reordering rows and nothing else still submits', async ({ page }) => {
  // F4's version of the assumption above, and it is a DIFFERENT assumption: a
  // row is not a keyed entry and has no order scope of its own. The claim is
  // that moving a row mutates the table object, so the `comboTable` delta keyed
  // by `starter` ships whole and carries the new row order inside it.
  //
  // B2 is what makes this worth driving rather than reasoning about: there, the
  // identical-looking assumption ("the scans already cover it") was false,
  // because every scan paired by a key the move did not change.
  const desc = { comboIntro: [], comboGroups: [], comboList: LIST_WITH_ROWS };
  await bootWithCapture(page, desc);

  await page.evaluate(() => {
    const rows = window.currentEditorDescData.comboList[0].rows;
    const [first] = rows.splice(0, 1);
    rows.push(first);
  });

  await page.locator('#submit-payload-btn').click();
  await expect.poll(() => page.evaluate(() => (window.__inserted || []).length)).toBeGreaterThan(0);

  const ticket = await page.evaluate(() => window.__inserted[0]);
  const scopes = ticket.target_scope === 'multi'
    ? ticket.delta_payload.map(d => `${d.scope}:${d.key ?? ''}`)
    : [`${ticket.target_scope}:${ticket.target_key ?? ''}`];
  expect(scopes, 'a row reorder must not be reported as "no changes detected"')
    .toContain('comboTable:Zzq 5H');

  const payload = ticket.target_scope === 'multi'
    ? ticket.delta_payload.find(d => d.scope === 'comboTable').payload
    : ticket.delta_payload;
  expect(payload.rows.map(r => r.sequence[0])).toEqual(['Zzq Bbb', 'Zzq Ccc', 'Zzq Aaa']);
});
