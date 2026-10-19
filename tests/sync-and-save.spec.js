// Sync and Save (v1.1). Owner, 2026-10-19: "Split the action Sync/Save into 2
// distinct Sync and Save yellow system buttons ... writing new logic for the
// Save button to actually save stuff into its own independent slot in Drafts."
// Scoped with the owner the same day: one Save slot per page, shown as SAVED
// beside the AUTO-SAVED draft, and the auto-save keeps running.
//
// What Sync does to the preview is tested with Preview only on Sync, in
// tests/editor-config.spec.js. This file is the buttons, the slot, the Drafts
// list, and the RESUME link, which never said what type of page it opened.
const { test, expect } = require('@playwright/test');

const para = (text) => ({ type: 'paragraph', content: [text], align: 'left' });
const DESC = {
  overview: [para('one'), para('two')],
  profile: { stats: [], image: '' }, extras: [], matchups: [],
};
const FRAME = { m1s: [], specials: [], skills: [] };

// A signed-in contributor, page_data answered from the fixture, and inserts
// into pending_revisions recorded. `storage` is written once, before the first
// load, the way a returning editor's browser has it; a reload keeps it.
function mockEditor(page, { desc = DESC, storage = {} } = {}) {
  return page.addInitScript(({ desc, frame, storage }) => {
    window.__inserted = [];
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
        insert(rows) {
          const list = [].concat(rows);
          window.__inserted.push(...list);
          return { select: async () => ({ data: list.map((r, i) => ({ id: `new-${i}`, ...r })), error: null }) };
        },
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
  }, { desc, frame: FRAME, storage });
}

async function boot(page, opts = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: opts.width || 1400, height: 900 });
  await mockEditor(page, opts);
  await page.goto(opts.url || '/edit.html?char=boomcat&type=character&tab=overview', { waitUntil: 'domcontentloaded' });
  if (opts.noWait) return errors;
  await expect(page.locator('#block-list .block-card').first()).toBeVisible({ timeout: 45000 });
  return errors;
}

const firstField = (page) => page.locator('#block-list .block-card').first().locator('textarea.editor-textarea');
const stored = (page, key) => page.evaluate((key) => {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}, key);
const firstText = (draft) => draft && draft.desc_data.overview[0].content[0];

// --- THE BUTTONS ---

for (const width of [1400, 390]) {
  test(`Sync and Save are two yellow buttons in the Workspace Header, both reachable, at ${width}px`, async ({ page }) => {
    await boot(page, { width });
    await expect(page.locator('.header-actions button', { hasText: 'Sync/Save' })).toHaveCount(0);
    for (const [id, label] of [['#btn-sync', 'Sync'], ['#btn-save', 'Save']]) {
      const btn = page.locator(`.header-actions ${id}`);
      await expect(btn).toHaveText(label);
      await expect(btn).toHaveClass(/btn-sys-yellow/);
      const onTop = await btn.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return r.right <= window.innerWidth && (el === hit || el.contains(hit));
      });
      expect(onTop, `${label} is on screen and on top`).toBe(true);
    }
  });
}

// --- SAVE ---

test('Save keeps this version in its own slot, and the auto-save carries on past it', async ({ page }) => {
  const errors = await boot(page);
  await firstField(page).fill('kept by Save');
  await page.click('#btn-save');
  await expect(page.locator('#btn-save')).toHaveText('Saved!');
  await expect.poll(async () => firstText(await stored(page, 'wiki_save_boomcat'))).toBe('kept by Save');
  await expect(page.locator('#btn-save')).toHaveText('Save', { timeout: 5000 });

  await firstField(page).fill('typed after');
  await expect.poll(async () => firstText(await stored(page, 'wiki_draft_boomcat'))).toBe('typed after');
  expect(firstText(await stored(page, 'wiki_save_boomcat')), 'the saved version is left alone').toBe('kept by Save');
  expect(errors).toEqual([]);
});

test('Drafts lists the saved version as SAVED beside the AUTO-SAVED one', async ({ page }) => {
  await boot(page);
  await firstField(page).fill('kept by Save');
  await page.click('#btn-save');
  await firstField(page).fill('typed after');
  await expect.poll(async () => firstText(await stored(page, 'wiki_draft_boomcat'))).toBe('typed after');

  await page.locator('.header-actions button', { hasText: 'Drafts' }).click();
  const rows = page.locator('#draft-list-container .draft-row');
  await expect(rows).toHaveCount(2);
  const saved = page.locator('.draft-row-saved');
  const auto = page.locator('.draft-row-auto');
  await expect(saved.locator('.draft-row-label')).toHaveText('SAVED');
  await expect(saved.locator('.draft-row-timestamp')).toContainText('Saved:');
  await expect(auto.locator('.draft-row-label')).toHaveText('AUTO-SAVED');
  // The auto-save is the one on screen; the saved version can be reopened.
  await expect(auto.locator('.draft-active-badge')).toHaveText('CURRENTLY ACTIVE');
  await expect(saved.locator('.draft-resume-btn')).toBeVisible();
});

test('RESUME on this page\'s saved version asks first, then opens it', async ({ page }) => {
  await boot(page);
  await firstField(page).fill('kept by Save');
  await page.click('#btn-save');
  await expect.poll(async () => firstText(await stored(page, 'wiki_save_boomcat'))).toBe('kept by Save');
  await firstField(page).fill('typed after');

  await page.locator('.header-actions button', { hasText: 'Drafts' }).click();
  await page.locator('.draft-row-saved .draft-resume-btn').click();
  await expect(page.locator('#editor-modal-text')).toContainText('Open the version you saved?');
  // CANCEL keeps the page as it is.
  await page.click('#editor-modal-cancel');
  await expect(firstField(page)).toHaveValue('typed after');

  await page.locator('.draft-row-saved .draft-resume-btn').click();
  await page.click('#editor-modal-confirm');
  await page.waitForURL(/draftKey=wiki_save_boomcat/);
  await expect(firstField(page)).toHaveValue('kept by Save', { timeout: 45000 });
});

test('Save on a submission being edited says the queue keeps it, and writes no slot', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    window.activeEditTicketId = 'ticket-1';
    window.editorAlert = (m) => { window.__alerts = (window.__alerts || []).concat(m); };
  });
  await page.click('#btn-save');
  await expect.poll(() => page.evaluate(() => window.__alerts || [])).toEqual([
    'This is a submission, and the review queue keeps it already. UPDATE SUBMISSION sends your changes to it.',
  ]);
  expect(await stored(page, 'wiki_save_boomcat')).toBeNull();
});

// --- THE RESUME LINK ---

test('Save and the auto-save record the type of page they came from', async ({ page }) => {
  const systemDesc = { tabs: [{ tabId: 'basics', tabLabel: 'Basics', sections: [{ sectionTitle: 'Intro', layout: 'full', blocks: [para('system text')] }] }] };
  await boot(page, { desc: systemDesc, url: '/edit.html?char=m1-trading&type=system' });
  await firstField(page).fill('edited system text');
  await page.click('#btn-save');
  await expect.poll(async () => (await stored(page, 'wiki_save_m1-trading') || {}).pageType).toBe('system');
  await expect.poll(async () => (await stored(page, 'wiki_draft_m1-trading') || {}).pageType).toBe('system');
});

// It carried the page and the tab and never the type, and the editor reads no
// type as a character page, so a system page's draft reopened as a character.
test('a system page\'s saved version reopens as a system page', async ({ page }) => {
  const systemDesc = { tabs: [{ tabId: 'basics', tabLabel: 'Basics', sections: [{ sectionTitle: 'Intro', layout: 'full', blocks: [para('saved system text')] }] }] };
  await boot(page, {
    storage: {
      'wiki_save_m1-trading': JSON.stringify({
        timestamp: Date.now(), charId: 'm1-trading', pageType: 'system', tabId: 'overview', moveId: '',
        desc_data: systemDesc, frame_data: FRAME, mode: null,
      }),
    },
  });
  await page.locator('.header-actions button', { hasText: 'Drafts' }).click();
  const row = page.locator('.draft-row-saved', { hasText: 'M1-trading' });
  await row.locator('.draft-resume-btn').click();

  await page.waitForURL(/type=system/);
  await expect(page.locator('.system-section-tab-btn')).toHaveText(['Intro'], { timeout: 45000 });
  await expect(firstField(page)).toHaveValue('saved system text');
});

// No underscore in the name: the list title-cases a page id at each one.
test('a draft name from storage is shown as text, never as markup', async ({ page }) => {
  await boot(page, {
    storage: {
      'wiki_save_x': JSON.stringify({ timestamp: 1, charId: '<img src=x onerror=window.pwnedByDraft=1>', tabId: 'overview', desc_data: DESC, frame_data: FRAME }),
    },
  });
  await page.locator('.header-actions button', { hasText: 'Drafts' }).click();
  await expect(page.locator('.draft-row-saved .draft-row-title')).toContainText('<img src=x onerror=window.pwnedByDraft=1>');
  await expect(page.locator('#draft-list-container img')).toHaveCount(0);
  expect(await page.evaluate(() => window.pwnedByDraft)).toBeUndefined();
});

// --- SUBMIT ---

// Owner, 2026-10-19: Submit keeps every draft ("a successful Submit won't
// clear any saves at all"), and warns instead about sending one twice.
test('a successful Submit keeps both of the page\'s drafts and records when it was sent', async ({ page }) => {
  await boot(page);
  await firstField(page).fill('submitted text');
  await page.click('#btn-save');
  await expect.poll(async () => firstText(await stored(page, 'wiki_save_boomcat'))).toBe('submitted text');
  await expect.poll(async () => firstText(await stored(page, 'wiki_draft_boomcat'))).toBe('submitted text');

  await page.evaluate(() => {
    localStorage.removeItem('wiki_last_submit_time');
    window.openQAModal = async () => ({ changelog: 'test', confidence: 'high', evidence: '' });
    window.editorAlert = () => {};
  });
  const before = Date.now();
  await page.click('#submit-payload-btn');
  await expect.poll(() => page.evaluate(() => window.__inserted.length)).toBeGreaterThan(0);
  await expect.poll(() => stored(page, 'wiki_submitted_boomcat')).toBeGreaterThanOrEqual(before);
  expect(firstText(await stored(page, 'wiki_save_boomcat'))).toBe('submitted text');
  expect(firstText(await stored(page, 'wiki_draft_boomcat'))).toBe('submitted text');
});

// Another page's drafts, so reopening one is a plain navigation and the only
// prompt is the one being tested.
const otherDraft = (timestamp, extra = {}) => JSON.stringify({
  timestamp, charId: 'vessel', tabId: 'overview', moveId: '', desc_data: DESC, frame_data: FRAME, mode: null, ...extra,
});

test('a draft saved before its page was submitted says so in Drafts, and RESUME warns about sending it twice', async ({ page }) => {
  await boot(page, { storage: { wiki_save_vessel: otherDraft(1000), wiki_submitted_vessel: '2000' } });
  await page.locator('.header-actions button', { hasText: 'Drafts' }).click();
  const row = page.locator('.draft-row-saved', { hasText: 'Vessel' });
  await expect(row.locator('.draft-row-submitted')).toContainText(new Date(2000).toLocaleString());

  await row.locator('.draft-resume-btn').click();
  await expect(page.locator('#editor-modal-text')).toContainText('Submitting it again sends the same changes to the review queue a second time.');
  await page.click('#editor-modal-cancel');
  expect(page.url()).not.toContain('draftKey');

  await row.locator('.draft-resume-btn').click();
  await page.click('#editor-modal-confirm');
  await page.waitForURL(/draftKey=wiki_save_vessel/);
});

test('a draft saved after the page was submitted neither says so nor warns', async ({ page }) => {
  await boot(page, { storage: { wiki_save_vessel: otherDraft(3000), wiki_submitted_vessel: '2000' } });
  await page.locator('.header-actions button', { hasText: 'Drafts' }).click();
  const row = page.locator('.draft-row-saved', { hasText: 'Vessel' });
  await expect(row.locator('.draft-row-submitted')).toHaveCount(0);
  await row.locator('.draft-resume-btn').click();
  await page.waitForURL(/draftKey=wiki_save_vessel/);
});

test('opening a page whose auto-save was already submitted warns in the restore prompt', async ({ page }) => {
  await boot(page, {
    noWait: true,
    storage: {
      wiki_draft_boomcat: JSON.stringify({ timestamp: 1000, charId: 'boomcat', tabId: 'overview', desc_data: DESC, frame_data: FRAME }),
      wiki_submitted_boomcat: '2000',
    },
  });
  await expect(page.locator('#editor-custom-modal')).toBeVisible({ timeout: 45000 });
  await expect(page.locator('#editor-modal-text')).toContainText('Submitting it again sends the same changes to the review queue a second time.');
  await expect(page.locator('#editor-modal-confirm')).toHaveText('RESTORE DRAFT');
});

// --- FIVE AUTO-SAVES ---
//
// Owner, 2026-10-19: "a max limit of 5 auto-save slots for every editor", the
// submitted ones going first.

const autoSave = (id, timestamp) => JSON.stringify({ timestamp, charId: id, tabId: 'overview', desc_data: DESC, frame_data: FRAME });
const autoSaveKeys = (page) => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('wiki_draft_')).sort());

test('a sixth page\'s auto-save drops one already submitted, and never a SAVED version', async ({ page }) => {
  await boot(page, {
    storage: {
      wiki_draft_p1: autoSave('p1', 1), wiki_draft_p2: autoSave('p2', 2), wiki_draft_p3: autoSave('p3', 3),
      wiki_draft_p4: autoSave('p4', 4), wiki_draft_p5: autoSave('p5', 5),
      wiki_submitted_p4: '10',
      wiki_save_p1: autoSave('p1', 1),
    },
  });
  await firstField(page).fill('the sixth page');
  await expect.poll(() => autoSaveKeys(page)).toEqual(['wiki_draft_boomcat', 'wiki_draft_p1', 'wiki_draft_p2', 'wiki_draft_p3', 'wiki_draft_p5']);
  expect(await stored(page, 'wiki_save_p1')).not.toBeNull();
  await expect(page.locator('#editor-alert-modal')).toBeHidden();

  // Room is made once: editing the same page again drops nothing more.
  await firstField(page).fill('the sixth page, again');
  await expect.poll(async () => firstText(await stored(page, 'wiki_draft_boomcat'))).toBe('the sixth page, again');
  expect(await autoSaveKeys(page)).toHaveLength(5);
});

test('with all five unsent, the oldest goes and the editor is told which', async ({ page }) => {
  await boot(page, {
    storage: {
      wiki_draft_p1: autoSave('p1', 1), wiki_draft_p2: autoSave('p2', 2), wiki_draft_p3: autoSave('p3', 3),
      wiki_draft_p4: autoSave('p4', 4), wiki_draft_p5: autoSave('p5', 5),
    },
  });
  await firstField(page).fill('the sixth page');
  await expect.poll(() => autoSaveKeys(page)).toEqual(['wiki_draft_boomcat', 'wiki_draft_p2', 'wiki_draft_p3', 'wiki_draft_p4', 'wiki_draft_p5']);
  await expect(page.locator('#editor-alert-modal')).toBeVisible();
  await expect(page.locator('#editor-alert-msg')).toContainText('the oldest unsent one was removed to make room: P1');
});
