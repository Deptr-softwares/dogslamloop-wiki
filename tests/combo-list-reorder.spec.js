// v0.18 F3 - a Combo List can be reordered.
//
// Combo groups got reordering in v0.15 item 8; the list beside them never did,
// so three Combo Lists could only be read in the order they were created in.
// The owner reported it as "I created 3 Combo Lists, I can't change their
// ordering".
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

// --- WHAT ACTUALLY REACHES THE DATABASE ---
//
// This is the falsification. If reordering alone produces no delta, the strip
// above is a control that appears to work and silently discards the change -
// which is exactly the bug filed as B2 against the system-page tab strip, and
// the one v0.15 fixed for character pages. Asserting that comboList appears in
// getKeyedSections() would assert the setup; this asserts the consequence.
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
