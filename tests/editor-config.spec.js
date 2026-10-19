// The Config panel (v1.1): a gray button in the Workspace Header whose Editor
// and Actions sections change how the editor looks and works, saved per device
// (owner, 2026-10-18: "Settings saved per device").
//
// Every test drives the real checkbox or button in the panel and then asserts
// what the editor LOOKS like or DOES, never the body class the setting sets:
// a class proves the setting was stored, not that anyone can see the result.
const { test, expect } = require('@playwright/test');

const EDITOR = '/edit.html?char=boomcat&type=character&tab=overview';

const para = (text, extra = {}) => ({ type: 'paragraph', content: [text], align: 'left', ...extra });

const DESC = {
  overview: [para('one'), para('two'), para('three'), { type: 'table', headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']] }],
  profile: { stats: [{ label: 'Archetype', value: 'Rushdown' }], image: '' },
  extras: [], matchups: [],
};

const FRAME = {
  m1s: [], specials: [],
  skills: [{ id: 'one', name: 'Skill One', input: '1', type: 'Skill', damageType: 'Melee', variant: 'Standard', stats: [{ label: 'Startup', value: '10' }] }],
};

// A signed-in contributor with page_data answered from the fixture. `storage`
// is written before the page runs, the way a returning editor's browser has it.
function mockEditor(page, { desc = DESC, frame = FRAME, storage = {} } = {}) {
  return page.addInitScript(({ desc, frame, storage }) => {
    try {
      if (!sessionStorage.getItem('__seeded')) {
        localStorage.setItem('dsl_editor_tutorial_seen', '1');
        localStorage.setItem('dsl_notice_seen_editor', '1');
        Object.entries(storage).forEach(([k, v]) => localStorage.setItem(k, v));
        sessionStorage.setItem('__seeded', '1');
      }
    } catch (e) { /* ignore */ }
    const rowsFor = (table) => {
      if (table === 'page_data') return { data: { page_id: 'boomcat', desc_data: JSON.parse(JSON.stringify(desc)), frame_data: JSON.parse(JSON.stringify(frame)) }, error: null };
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
  }, { desc, frame, storage });
}

async function boot(page, opts = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: opts.height || 900 });
  await mockEditor(page, opts);
  await page.goto(opts.url || EDITOR, { waitUntil: 'domcontentloaded' });
  if (!opts.noWait) await expect(page.locator('#block-list .block-card').first()).toBeVisible({ timeout: 45000 });
  return errors;
}

const cards = (page) => page.locator('#block-list .block-card');
const contents = (page) => page.evaluate(() => window.getActiveBlocks().map(b => (Array.isArray(b.content) ? b.content.join('') : b.type)));

async function setOption(page, key, on) {
  await page.click('#btn-editor-config');
  await expect(page.locator('#editor-config-modal')).toBeVisible();
  await page.locator(`#editor-config-modal [data-config-key="${key}"]`).setChecked(on);
  await page.click('#editor-config-modal [data-config-close]');
  await expect(page.locator('#editor-config-modal')).toHaveCount(0);
}

const box = (loc) => loc.evaluate(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, width: r.width, height: r.height }; });

// --- THE PANEL ---

test('Config opens from the Workspace Header, closes, and a setting survives a reload', async ({ page }) => {
  const errors = await boot(page);

  const button = page.locator('.header-actions #btn-editor-config');
  await expect(button).toBeVisible();
  await expect(button).toHaveText('Config');

  await button.click();
  const modal = page.locator('#editor-config-modal');
  // Page is this page's own settings, tested in tests/page-settings.spec.js.
  await expect(modal.locator('[data-config-tab]')).toHaveText(['Editor', 'Actions', 'Page']);
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);

  await setOption(page, 'hideBlockType', true);
  await expect(cards(page).first().locator('.block-type-label')).toBeVisible();

  // Per device: the same browser, a fresh load.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(cards(page).first().locator('.block-type-label')).toBeVisible({ timeout: 45000 });
  await page.click('#btn-editor-config');
  await expect(page.locator('[data-config-key="hideBlockType"]')).toBeChecked();
  expect(errors).toEqual([]);
});

// --- EDITOR ---

// Owner, 2026-10-19: "The editor part of the Config should be splitted into 3
// parts: Workspace, Block, and Preview Panel."
test('the Editor tab is three sections, Workspace, Block and Preview Panel, each with its own settings', async ({ page }) => {
  await boot(page);
  await page.click('#btn-editor-config');
  await expect(page.locator('#editor-config-modal .config-section-title')).toHaveText(['Workspace', 'Block', 'Preview Panel']);

  const labels = (name) => page.locator(`[data-config-section="${name}"] .config-option-label`).allTextContents();
  expect(await labels('workspace')).toEqual(['Sticky top elements', 'Workspace Header', 'Page navigation buttons',
    'Sections navigation buttons', 'Workspace basic actions (Undo, Redo, Clear All, Create Folder)', 'Skip delete confirmations']);
  expect(await labels('block')).toEqual(['Hide Block Type dropdown', 'Hide Drag-and-drop area', 'Hide Block Folder dropdown',
    'Formatting on top', 'Compact Blocks', 'Open sections minimized']);
  expect(await labels('preview')).toEqual(['Disable Preview Panel', 'Preview follows the Block', 'Preview only on Sync']);

  // Every new one starts off.
  for (const key of ['compactBlocks', 'openMinimized', 'previewFollows', 'previewOnSync']) {
    await expect(page.locator(`[data-config-key="${key}"]`), key).not.toBeChecked();
  }
});

test('Hide Block Type dropdown shows the type instead of the dropdown', async ({ page }) => {
  await boot(page);
  const row = cards(page).first().locator('.block-type-row');
  // The dropdown a reader sees is drawn NEXT TO the real select, which the
  // site's dropdown engine hides.
  const dropdown = row.locator('.block-type-selector + .manga-select-wrapper');

  await expect(dropdown).toBeVisible();
  await expect(row.locator('.block-type-label')).toBeHidden();

  await setOption(page, 'hideBlockType', true);
  await expect(dropdown).toBeHidden();
  await expect(row.locator('.block-type-label')).toHaveText('Paragraph');
  await expect(cards(page).nth(3).locator('.block-type-label')).toHaveText('Table');
});

// Pressed 4px in from the first card's outer edge, dropped on the lower half
// of the third. Minimized first, so every card fits on screen: a drop point
// below the window is one no drag can reach, and the first version of this
// test passed its "nothing moves" half for exactly that reason.
async function dragByLeftEdge(page) {
  await page.evaluate(() => window.setAllEditorBlocksOpen(false));
  const from = await box(cards(page).nth(0));
  const to = await box(cards(page).nth(2));
  expect(to.bottom, 'the drop point is on screen').toBeLessThan(page.viewportSize().height);
  await page.mouse.move(from.left + 4, from.top + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.left + 40, from.top + 30, { steps: 5 });
  await page.mouse.move(to.left + 60, to.bottom - 4, { steps: 10 });
  await page.mouse.up();
}

test('Hide Drag-and-drop area: the handle goes, and only then does the left edge move a block', async ({ page }) => {
  await boot(page);

  // The control: with the handle showing, the edge is just an edge.
  await dragByLeftEdge(page);
  expect(await contents(page)).toEqual(['one', 'two', 'three', 'table']);

  await setOption(page, 'hideDragHandle', true);
  await expect(cards(page).first().locator('.drag-handle')).toBeHidden();
  await dragByLeftEdge(page);
  await expect.poll(() => contents(page)).toEqual(['two', 'three', 'one', 'table']);
});

test('Hide Block Folder dropdown: the dropdown goes, and CREATE FOLDER plus a drag still file a block', async ({ page }) => {
  await boot(page);
  await setOption(page, 'hideFolderPicker', true);
  await expect(cards(page).first().locator('.block-folder-picker')).toBeHidden();

  await page.click('#btn-create-folder');
  const folder = page.locator('#block-list .block-folder.is-empty');
  await expect(folder).toHaveCount(1);

  // Onto the empty folder's header, by the handle. Minimized so the folder,
  // drawn at the end of the list, is on screen.
  await page.evaluate(() => window.setAllEditorBlocksOpen(false));
  const handle = await box(cards(page).nth(1).locator('.drag-handle'));
  const head = await box(folder.locator('.block-folder-head'));
  expect(head.bottom, 'the folder is on screen').toBeLessThan(page.viewportSize().height);
  await page.mouse.move(handle.left + 3, handle.top + 3);
  await page.mouse.down();
  await page.mouse.move(handle.left + 30, handle.top + 30, { steps: 5 });
  await page.mouse.move(head.left + 80, head.top + head.height / 2, { steps: 10 });
  await page.mouse.up();

  await expect.poll(() => page.evaluate(() => window.getActiveBlocks().filter(b => b.folder).map(b => b.content.join('')))).toEqual(['two']);
});

test('Formatting on top moves the alignment row above the text, and the text still edits', async ({ page }) => {
  await boot(page);
  const card = cards(page).first();
  const order = async () => {
    const align = await box(card.locator('.align-group'));
    const text = await box(card.locator('textarea.editor-textarea'));
    return align.top < text.top ? 'align first' : 'text first';
  };

  expect(await order()).toBe('text first');
  await setOption(page, 'formattingOnTop', true);
  expect(await order()).toBe('align first');

  await card.locator('textarea.editor-textarea').fill('edited');
  await expect.poll(() => page.evaluate(() => window.getActiveBlocks()[0].content)).toEqual(['edited']);
});

test('Disable Preview Panel gives the workspace the whole width, and gives it back', async ({ page }) => {
  const errors = await boot(page);
  const workspace = page.locator('.editor-workspace');
  const before = (await box(workspace)).width;
  expect(before, 'the workspace starts at its usual share').toBeLessThan(700);

  await setOption(page, 'disablePreview', true);
  await expect(page.locator('.live-preview-pane')).toBeHidden();
  await expect(page.locator('#editor-splitter')).toBeHidden();
  expect((await box(workspace)).width).toBeGreaterThan(1390);

  // Still an editor: typing reaches the data with the preview gone.
  await cards(page).first().locator('textarea.editor-textarea').fill('no preview');
  await expect.poll(() => page.evaluate(() => window.getActiveBlocks()[0].content)).toEqual(['no preview']);

  await setOption(page, 'disablePreview', false);
  await expect(page.locator('.live-preview-pane')).toBeVisible();
  expect(Math.abs((await box(workspace)).width - before)).toBeLessThan(2);
  expect(errors).toEqual([]);
});

test('Disable Preview Panel takes SHOW PREVIEW away on a phone', async ({ page }) => {
  await boot(page);
  await setOption(page, 'disablePreview', true);
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.locator('#mobile-preview-toggle')).toBeHidden();
});

test('Compact Blocks makes each Block shorter, and a Block still edits', async ({ page }) => {
  await boot(page);
  const heights = () => cards(page).evaluateAll(els => els.map(el => el.getBoundingClientRect().height));
  const before = await heights();

  await setOption(page, 'compactBlocks', true);
  const after = await heights();
  after.forEach((h, i) => expect(h, `Block ${i}`).toBeLessThan(before[i]));

  await cards(page).first().locator('textarea.editor-textarea').fill('compact');
  await expect.poll(() => page.evaluate(() => window.getActiveBlocks()[0].content)).toEqual(['compact']);
});

test('Open sections minimized shuts the Blocks of every section opened after it is ticked', async ({ page }) => {
  const desc = { ...DESC, strategy: [para('s1'), para('s2')] };
  await boot(page, { desc });
  const open = page.locator('#block-list .block-body:visible');
  await expect(open).toHaveCount(4);

  // It is about opening: the section already on screen is left as it is.
  await setOption(page, 'openMinimized', true);
  await expect(open).toHaveCount(4);

  await page.click('#overview-nav-strategy');
  await expect(cards(page)).toHaveCount(2);
  await expect(open).toHaveCount(0);

  await page.click('#overview-nav-overview');
  await expect(cards(page)).toHaveCount(4);
  await expect(open).toHaveCount(0);

  // A shut Block still opens with its own button.
  await cards(page).first().locator('.btn-collapse').click();
  await expect(open).toHaveCount(1);
});

// --- PREVIEW FOLLOWS THE BLOCK ---

// Is this Block's text inside the part of the preview the reader can see?
const previewShows = (page, scope, text) => page.evaluate(({ scope, text }) => {
  const pane = document.querySelector('.live-preview-pane');
  const el = Array.from(pane.querySelectorAll(`${scope} p`)).find(p => p.textContent.trim() === text);
  if (!el) return 'missing';
  const p = pane.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return r.top >= p.top && r.bottom <= Math.min(p.bottom, window.innerHeight);
}, { scope, text });

// Far-off cards are virtualized until they scroll into the Workspace, so the
// card comes in first and its textarea is clicked once it is drawn.
async function clickInto(page, n) {
  await cards(page).nth(n).scrollIntoViewIfNeeded();
  const field = cards(page).nth(n).locator('textarea.editor-textarea');
  await expect(field).toBeVisible();
  await field.click();
}

test('Preview follows the Block scrolls the preview to the Block clicked into, and only when ticked', async ({ page }) => {
  await boot(page, { desc: LONG, height: 700 });

  // The control: unticked, the preview stays where it was.
  await clickInto(page, 25);
  await page.waitForTimeout(800);
  expect(await previewShows(page, '#overview-text-subnode', 'p25')).toBe(false);

  await setOption(page, 'previewFollows', true);
  await clickInto(page, 27);
  await expect.poll(() => previewShows(page, '#overview-text-subnode', 'p27')).toBe(true);

  // And back up again.
  await clickInto(page, 1);
  await expect.poll(() => previewShows(page, '#overview-text-subnode', 'p1')).toBe(true);
});

// The Overview tab draws Overview, General Strategy and every custom tab in one
// preview, so each has a Block 1. The one that follows is the one being edited.
test('Preview follows the Block finds the Block of the section being edited, not the same place in another', async ({ page }) => {
  const desc = { ...LONG, strategy: [para('s0'), para('s1')] };
  await boot(page, { desc, height: 700, storage: { dsl_editor_config: JSON.stringify({ previewFollows: true }) } });
  await page.click('#overview-nav-strategy');
  await expect(cards(page)).toHaveCount(2);

  // Back to the top first, so a jump to the right place is a jump.
  await page.evaluate(() => { document.querySelector('.live-preview-pane').scrollTop = 0; });
  await page.waitForTimeout(400);
  await clickInto(page, 1);
  await expect.poll(() => previewShows(page, '#overview-strategy-subnode', 's1')).toBe(true);
  expect(await previewShows(page, '#overview-text-subnode', 'p1')).toBe(false);
});

// --- PREVIEW ONLY ON SYNC ---

const SYNC = (page) => page.locator('.header-actions button', { hasText: 'Sync/Save' });

test('at the default the preview redraws as a Block is typed into', async ({ page }) => {
  await boot(page);
  await cards(page).first().locator('textarea.editor-textarea').fill('drawn at once');
  await expect(page.locator('.live-preview-pane #overview-text-subnode')).toContainText('drawn at once');
});

test('Preview only on Sync: an edit reaches the page at once, and the preview on SYNC', async ({ page }) => {
  const errors = await boot(page, { storage: { dsl_editor_config: JSON.stringify({ previewOnSync: true }) } });
  const preview = page.locator('.live-preview-pane #overview-text-subnode');

  await cards(page).first().locator('textarea.editor-textarea').fill('held edit');
  // In the page's data, which is what a draft and a submission read.
  await expect.poll(() => page.evaluate(() => window.currentEditorDescData.overview[0].content)).toEqual(['held edit']);
  await page.waitForTimeout(600);
  await expect(preview).not.toContainText('held edit');

  await SYNC(page).click();
  await expect(preview).toContainText('held edit');
  expect(errors).toEqual([]);
});

const SYSTEM_DESC = {
  tabs: [{
    tabId: 'basics', tabLabel: 'Basics',
    sections: [
      { sectionTitle: 'Intro', layout: 'full', blocks: [para('intro text')] },
      { sectionTitle: 'Advanced', layout: 'full', blocks: [para('advanced text')] },
    ],
  }],
};

test('Preview only on Sync on a system page: SYNC draws, and so does switching section', async ({ page }) => {
  const errors = await boot(page, {
    desc: SYSTEM_DESC, url: '/edit.html?char=m1-trading&type=system',
    storage: { dsl_editor_config: JSON.stringify({ previewOnSync: true }) },
  });
  const intro = page.locator('.live-preview-pane #system-basics-sec-0');
  await expect(intro).toContainText('intro text');

  await cards(page).first().locator('textarea.editor-textarea').fill('held system edit');
  await page.waitForTimeout(800);
  await expect(intro).not.toContainText('held system edit');
  await SYNC(page).click();
  await expect(intro).toContainText('held system edit');

  await cards(page).first().locator('textarea.editor-textarea').fill('drawn by the switch');
  await page.waitForTimeout(800);
  await expect(intro).not.toContainText('drawn by the switch');
  await page.locator('.system-section-tab-btn').nth(1).click();
  await expect(intro).toContainText('drawn by the switch');
  expect(errors).toEqual([]);
});

// --- STICKY TOP ELEMENTS ---

const LONG = { ...DESC, overview: Array.from({ length: 30 }, (_, i) => para(`p${i}`)) };

test('at the defaults the layout is the one the editor always had', async ({ page }) => {
  await boot(page, { desc: LONG });
  const scrolls = await page.evaluate(() => ({
    workspace: getComputedStyle(document.querySelector('.editor-workspace')).overflowY,
    builder: getComputedStyle(document.getElementById('interactive-builder')).overflowY,
  }));
  expect(scrolls).toEqual({ workspace: 'hidden', builder: 'auto' });
});

test('the Workspace Header can scroll away while the page tabs stay, and the basic actions can stay too', async ({ page }) => {
  await boot(page, { desc: LONG, height: 700 });
  await setOption(page, 'stickHeader', false);
  await setOption(page, 'stickActions', true);

  // Measured at two scroll positions: a bar that is pinned does not move
  // between them, and one that is not would have moved by the difference.
  const at = async (scrollTop) => {
    await page.evaluate((y) => { document.querySelector('.editor-workspace').scrollTop = y; }, scrollTop);
    await page.waitForTimeout(150);
    return page.evaluate(() => {
      const r = (el) => el.getBoundingClientRect();
      return {
        wsTop: r(document.querySelector('.editor-workspace')).top,
        headerBottom: r(document.getElementById('editor-header')).bottom,
        tabsTop: r(document.getElementById('editor-tab-nav')).top,
        tabsBottom: r(document.getElementById('editor-tab-nav')).bottom,
        actionsTop: r(document.getElementById('btn-undo').closest('.strategy-toolbar-row')).top,
      };
    });
  };
  const first = await at(1500);
  const later = await at(2500);

  expect(first.headerBottom, 'the header scrolled out of sight').toBeLessThanOrEqual(first.wsTop + 1);
  // The page navigation group can include the character's state bar above the
  // tabs, so "pinned" is "does not move", not "touches the top".
  expect(first.tabsTop, 'the page tabs are on screen').toBeGreaterThanOrEqual(first.wsTop);
  expect(Math.abs(later.tabsTop - first.tabsTop), 'and pinned').toBeLessThan(1);
  expect(Math.abs(first.actionsTop - first.tabsBottom), 'the basic actions sit right under them').toBeLessThan(2);
  expect(Math.abs(later.actionsTop - first.actionsTop), 'and stay').toBeLessThan(1);
});

// --- ACTIONS ---

test('MINIMIZE ALL and MAXIMIZE ALL act on every Block in the section, folders included', async ({ page }) => {
  const desc = { ...DESC, overview: [para('loose'), para('in a', { folder: 'Kept' }), para('folder', { folder: 'Kept' })] };
  await boot(page, { desc });
  // Folders open shut; one shut folder is the case MAXIMIZE has to get past.
  await page.evaluate(() => { window.setBlockFolderCollapsed('Kept', true); window.renderBlockList(); });

  await page.click('#btn-editor-config');
  await page.click('[data-config-tab="actions"]');
  await page.click('[data-config-action="minimize"]');
  await expect(page.locator('[data-config-note]')).toHaveText('Minimized 3 Blocks.');
  await expect(page.locator('#block-list .block-body:visible')).toHaveCount(0);

  await page.click('[data-config-action="maximize"]');
  await expect(page.locator('[data-config-note]')).toHaveText('Maximized 3 Blocks.');
  await expect(page.locator('#block-list .block-body:visible')).toHaveCount(3);
});

test('the mass actions say so when the screen has no Blocks', async ({ page }) => {
  await boot(page);
  await page.click('#overview-nav-profile');
  await expect(page.locator('#block-list')).toHaveCount(0);

  await page.click('#btn-editor-config');
  await page.click('[data-config-tab="actions"]');
  await page.click('[data-config-action="minimize"]');
  await expect(page.locator('[data-config-note]')).toHaveText('There are no Blocks in the section on screen.');
});

// --- W5: CONFIRM BEFORE DELETING ---

test('a Block\'s ✖ asks first, CANCEL keeps it, and DELETE removes it', async ({ page }) => {
  await boot(page);
  await cards(page).first().locator('.btn-delete').click();
  await expect(page.locator('#editor-custom-modal')).toBeVisible();
  await expect(page.locator('#editor-modal-text')).toHaveText('Delete this Paragraph block?');

  await page.click('#editor-modal-cancel');
  expect(await contents(page)).toEqual(['one', 'two', 'three', 'table']);

  await cards(page).first().locator('.btn-delete').click();
  await page.click('#editor-modal-confirm');
  await expect.poll(() => contents(page)).toEqual(['two', 'three', 'table']);
});

// Renamed in v1.1 (owner, 2026-10-19), and turned around: the box now says
// "skip", so ticking it is what turns the prompts off.
test('Skip delete confirmations starts unticked, and ticked deletes on the first click', async ({ page }) => {
  await boot(page);
  await page.click('#btn-editor-config');
  await expect(page.locator('[data-config-key="confirmDeletes"]')).not.toBeChecked();
  await page.keyboard.press('Escape');
  await setOption(page, 'confirmDeletes', true);

  await cards(page).first().locator('.btn-delete').click();
  await expect.poll(() => contents(page)).toEqual(['two', 'three', 'table']);
  await expect(page.locator('#editor-custom-modal')).toBeHidden();

  // A table's bottom row too, which never asked before v1.1.
  await cards(page).last().locator('.btn-table-del-row').click();
  await expect.poll(() => page.evaluate(() => window.getActiveBlocks().at(-1).rows.length)).toBe(1);
});

test('deletes outside the block list ask too: a profile stat and a move stat', async ({ page }) => {
  await boot(page);

  await page.click('#overview-nav-profile');
  await page.locator('.btn-del-stat').first().click();
  await expect(page.locator('#editor-modal-text')).toHaveText('Delete this stat?');
  await page.click('#editor-modal-cancel');
  await expect.poll(() => page.evaluate(() => window.currentEditorDescData.profile.stats.length)).toBe(1);

  await page.click('#edit-nav-skills');
  await page.locator('.daw-stat-del-btn').first().click();
  await expect(page.locator('#editor-modal-text')).toHaveText('Delete this stat?');
  await page.click('#editor-modal-confirm');
  await expect.poll(() => page.evaluate(() => window.currentEditorFrameData.skills[0].stats.length)).toBe(0);
});

// The stored setting kept its name and meaning through the rename, so a
// device that turned the prompts off under the old label still has them off.
test('a device that switched the prompts off before the rename shows Skip ticked, and still skips', async ({ page }) => {
  await boot(page, { storage: { dsl_editor_config: JSON.stringify({ confirmDeletes: false }) } });
  await page.click('#btn-editor-config');
  await expect(page.locator('[data-config-key="confirmDeletes"]')).toBeChecked();
  await page.keyboard.press('Escape');

  await cards(page).first().locator('.btn-delete').click();
  await expect.poll(() => contents(page)).toEqual(['two', 'three', 'table']);
  await expect(page.locator('#editor-custom-modal')).toBeHidden();
});

test('a prompt that is not a delete still asks with the switch off: restoring a draft', async ({ page }) => {
  await boot(page, {
    noWait: true,
    storage: {
      dsl_editor_config: JSON.stringify({ confirmDeletes: false }),
      wiki_draft_boomcat: JSON.stringify({ desc_data: DESC, frame_data: FRAME }),
    },
  });
  await expect(page.locator('#editor-custom-modal')).toBeVisible({ timeout: 45000 });
  await expect(page.locator('#editor-modal-text')).toContainText('unsaved local draft');
});
