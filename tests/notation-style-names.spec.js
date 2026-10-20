// The style names a page already uses (v1.1). Owner, 2026-10-20: the helper
// "was meant to detect the current style name being used on the page itself,
// and suggest the editor to name the style like that for sync purpose". A
// reader's style choice follows the name, so a second name for the same style
// splits it. Scoped the same day: while a style name field has focus, the
// page's names sit under it, most used first, and a click uses one; a name no
// other combo uses gets a yellow note.
//
// Counted from the page's data: every tab, every character state, the Combo
// Card's sections, and the four editors that write styles.
const { test, expect } = require('@playwright/test');

const style = (label) => ({ label, sequence: ['LMB'] });
const combo = (...labels) => ({ type: 'combo', sequence: ['M1'], damage: '', notations: labels.map(style) });

const DESC = {
  overview: [
    combo('Keyboard', 'Controller'),
    combo('keyboard  '),
    // Multiple Sections: the sections count, and the card's own copy of the
    // one on screen does not.
    { type: 'theorybox', title: 'Card', multiSections: true, content: [], notations: [style('Mirror')],
      sections: [{ label: 'A', title: 'A', sequence: ['M1'], content: [], notations: [style('Controller')] },
                 { label: 'B', title: 'B', sequence: ['M1'], content: [], notations: [style('Controller')] }] },
    // Switched off: the card counts, and the sections it left behind do not.
    { type: 'theorybox', title: 'Plain', multiSections: false, sequence: ['M1'], content: [], notations: [style('Mobile')],
      sections: [{ label: 'Old', title: 'Old', sequence: ['M1'], content: [], notations: [style('Ghost')] }] },
  ],
  strategy: [combo('KEYBOARD')],
  comboGroups: [{ title: 'Bread and Butter', content: [
    { type: 'theorybox', title: 'Corner', sequence: ['M1', 'Q'], content: [], notations: [style('Keyboard')] },
  ] }],
  modeData: { awakened: { overview: [combo('Keyboard')] } },
  profile: { stats: [], image: '' }, extras: [], matchups: [],
};

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

async function bootEditor(page, desc, tab = 'overview') {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 900 });
  await mockEditor(page, desc);
  await page.goto(`/edit.html?char=boomcat&type=character&tab=${tab}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.editorMasterDescData, null, { timeout: 45000 });
  return errors;
}

async function openBlocks(page) {
  await expect(page.locator('#block-list .block-card').first()).toBeVisible({ timeout: 45000 });
  await page.evaluate(() => {
    (window.getActiveBlocks() || []).forEach(b => window.setEditorBlockExpanded(b, true));
    window.renderBlockList();
  });
}

const nameField = (page, block, at = 0) =>
  page.locator(`#block-list .block-card[data-index="${block}"] [data-nstyle-label="${at}"]`);

// The chips under `scope`'s focused name, as [label, count].
const chips = (page, scope = '#block-list') => page.locator(`${scope} [data-nstyle-names] .nstyle-name-chip`)
  .evaluateAll(cs => cs.map(c => [c.firstChild.textContent, c.querySelector('.nstyle-name-count').textContent]));
const note = (page, scope = '#block-list') => page.locator(`${scope} [data-nstyle-names] [data-nstyle-note]`);

test('a focused style name lists the page\'s names, most used first, from every tab and state', async ({ page }) => {
  const errors = await bootEditor(page, DESC);
  await openBlocks(page);

  await expect(page.locator('[data-nstyle-names]'), 'nothing until a name has focus').toHaveCount(0);
  await nameField(page, 0).focus();
  // Keyboard: overview twice (case and spaces ignored), General Strategy, the
  // Combos tab and the awakened state, less this field's own. Controller:
  // this block and both card sections. Mobile: the plain card.
  expect(await chips(page)).toEqual([['Keyboard', '4'], ['Controller', '3'], ['Mobile', '1']]);
  await expect(note(page), 'its own name matches').toBeHidden();

  await nameField(page, 0).fill('kbm');
  await expect(note(page)).toHaveText('No other combo on this page uses "kbm". Readers who picked Keyboard won\'t see it.');
  await expect(note(page)).toBeVisible();
  const yellow = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent-yellow)';
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  expect(await note(page).evaluate(el => getComputedStyle(el).color)).toBe(yellow);

  await nameField(page, 0).fill(' KEYBOARD ');
  await expect(note(page), 'a match ignores case and spaces, as the sync does').toBeHidden();

  // A chip writes the name through the field, which keeps the focus.
  await page.locator('#block-list .nstyle-name-chip', { hasText: 'Controller' }).click();
  await expect(nameField(page, 0)).toHaveValue('Controller');
  await expect(nameField(page, 0)).toBeFocused();
  expect(await page.evaluate(() => window.getActiveBlocks()[0].notations[0].label)).toBe('Controller');
  await expect(note(page)).toBeHidden();

  // Put away once focus leaves the name.
  await page.locator('#block-list .block-card[data-index="0"] [data-nstyle-route="0"]').focus();
  await expect(page.locator('[data-nstyle-names]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a name typed a moment ago in another combo is already counted', async ({ page }) => {
  const errors = await bootEditor(page, DESC);
  await openBlocks(page);

  await nameField(page, 0, 1).fill('Pad');
  await nameField(page, 1).focus();
  expect(await chips(page)).toEqual([['Keyboard', '4'], ['Controller', '2'], ['Mobile', '1'], ['Pad', '1']]);
  expect(errors).toEqual([]);
});

test('the chips are reachable from the keyboard, and only the name\'s own row keeps them open', async ({ page }) => {
  await bootEditor(page, DESC);
  await openBlocks(page);

  await nameField(page, 0).focus();
  await page.keyboard.press('Tab');   // the style's remove button
  await expect(page.locator('#block-list [data-nstyle-names]')).toHaveCount(1);
  await page.keyboard.press('Tab');   // the first chip
  await expect(page.locator('#block-list .nstyle-name-chip').first()).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');  // the second, Controller
  await expect(nameField(page, 0)).toHaveValue('Controller');
  await expect(nameField(page, 0)).toBeFocused();
});

test('the page\'s only style name is not offered to itself, and a new style is offered it', async ({ page }) => {
  const errors = await bootEditor(page, { overview: [combo('Keyboard')], profile: { stats: [], image: '' }, extras: [], matchups: [] });
  await openBlocks(page);

  await nameField(page, 0).focus();
  await expect(page.locator('[data-nstyle-names]'), 'nothing else to match').toHaveCount(0);
  await nameField(page, 0).fill('Anything');
  await expect(page.locator('[data-nstyle-names]')).toHaveCount(0);
  await nameField(page, 0).fill('Keyboard');

  await page.locator('#block-list [data-nstyle-add]').click();
  await expect(nameField(page, 0, 1)).toBeFocused();
  expect(await chips(page)).toEqual([['Keyboard', '1']]);
  await page.keyboard.type('Keybaord');
  await expect(note(page)).toHaveText('No other combo on this page uses "Keybaord". Readers who picked Keyboard won\'t see it.');
  expect(errors).toEqual([]);
});

test('a hostile style name is shown as text', async ({ page }) => {
  const desc = { overview: [combo('<img src=x onerror="window.__PWN=1">'), combo('Keyboard')], profile: { stats: [], image: '' }, extras: [], matchups: [] };
  await bootEditor(page, desc);
  await openBlocks(page);
  await nameField(page, 1).focus();
  expect(await chips(page)).toEqual([['<img src=x onerror="window.__PWN=1">', '1']]);
  await expect(page.locator('[data-nstyle-names] img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__PWN)).toBeUndefined();
});

test('the Combos tab card editor gets the names too', async ({ page }) => {
  const errors = await bootEditor(page, DESC, 'combos');
  await page.locator('#combos-nav-group-0').click();
  await page.locator('[data-card="0"]').click();
  const field = page.locator('#combo-card-body [data-nstyle-label="0"]');
  await field.focus();
  expect(await chips(page, '#combo-card-body')).toEqual([['Keyboard', '4'], ['Controller', '3'], ['Mobile', '1']]);

  await page.locator('#combo-card-body .nstyle-name-chip', { hasText: 'Controller' }).click();
  await expect(field).toHaveValue('Controller');
  expect(await page.evaluate(() => window.currentEditorDescData.comboGroups[0].content[0].notations[0].label)).toBe('Controller');
  expect(errors).toEqual([]);
});
