// The editor side of character states.
//
// The design rests on one thing: currentEditorDescData/currentEditorFrameData
// are re-pointed at the active state's slice of the master objects, and every
// existing writer in the editor keeps writing through them unchanged. So the
// tests that matter are the ones about where a write actually lands - editing
// an ultimate state must never touch the base kit, and a draft must never
// persist a slice as if it were the whole character.
const { test, expect } = require('@playwright/test');

async function openEditor(page, { pageId = 'testchar', tab = 'overview', desc, frame, search = '' } = {}) {
  await page.goto(`/edit.html?char=${pageId}&tab=${tab}${search}`, { waitUntil: 'networkidle' });

  return page.evaluate(async ({ pageId, tab, desc, frame }) => {
    window.currentEditorPageType = 'character';
    window.currentEditorCharId = pageId;
    window.currentEditorTabId = tab;

    // The page's own boot ran and failed to load data (no session), leaving
    // sub-tab state set with an empty block buffer. Clear it so seeded content
    // is not flushed over before the test starts.
    window.currentOverviewSection = null;
    window.currentMatchupIndex = undefined;
    window.currentCounterplayIndex = undefined;

    window.originalCloudDescData = JSON.parse(JSON.stringify(desc));
    window.originalCloudFrameData = JSON.parse(JSON.stringify(frame));

    await window.initEditorModes(pageId, desc, frame);
    initFullTabEditor(pageId, tab, window.currentEditorDescData, window.currentEditorFrameData);
  }, { pageId, tab, desc, frame });
}

const PLAIN = () => ({
  desc: { overview: [{ type: 'paragraph', content: 'Base overview.' }], strategy: [], extras: [], matchups: [], counterplay: [], moveStrategies: {} },
  frame: { m1s: [{ id: 'base-m1', name: 'Jab' }], skills: [], specials: [] },
});

test('a character with no states edits the master objects themselves', async ({ page }) => {
  // Identity, not equality. If these ever became copies, every write in the
  // editor would land somewhere the draft and submit paths do not read.
  const { desc, frame } = PLAIN();
  await openEditor(page, { desc, frame });

  const same = await page.evaluate(() => ({
    desc: window.currentEditorDescData === window.editorMasterDescData,
    frame: window.currentEditorFrameData === window.editorMasterFrameData,
    mode: window.editorActiveMode,
  }));

  expect(same.desc).toBe(true);
  expect(same.frame).toBe(true);
  expect(same.mode).toBe('base');

  // No states to toggle between yet, so the bar is just the way to make one -
  // hiding it would leave no way to ever add the first state.
  await expect(page.locator('#editor-mode-bar .character-mode-chip')).toHaveText(['+ STATE']);
  await expect(page.locator('#editor-mode-controls')).toBeHidden();
});

test('adding a state declares the base one too, so there is a way back', async ({ page }) => {
  const { desc, frame } = PLAIN();
  await openEditor(page, { desc, frame });

  await page.evaluate(() => window.addEditorMode());

  const bar = page.locator('#editor-mode-bar');
  await expect(bar).toBeVisible();
  await expect(bar.locator('.character-mode-chip:not(.editor-mode-add)')).toHaveText(['Base Kit', 'Ultimate']);
  await expect(bar.locator('.character-mode-chip.active')).toHaveText('Ultimate');

  const state = await page.evaluate(() => ({
    mode: window.editorActiveMode,
    modes: window.editorMasterFrameData.modes,
  }));
  expect(state.mode).toBe('ultimate');
  expect(state.modes).toEqual([{ id: 'base', label: 'Base Kit' }, { id: 'ultimate', label: 'Ultimate' }]);
});

test('editing a state does not touch the base kit', async ({ page }) => {
  // The corruption this whole design exists to prevent.
  const { desc, frame } = PLAIN();
  await openEditor(page, { desc, frame });

  const result = await page.evaluate(async () => {
    await window.addEditorMode();

    // Exactly what the block buffer and the move editor do.
    window.currentEditorDescData.overview = [{ type: 'paragraph', content: 'Ultimate overview.' }];
    window.currentEditorFrameData.skills = [{ id: 'ult-skill', name: 'Dismantle' }];

    return {
      baseOverview: window.editorMasterDescData.overview,
      baseSkills: window.editorMasterFrameData.skills,
      stateOverview: window.editorMasterDescData.modeData.ultimate.overview,
      stateSkills: window.editorMasterFrameData.modeData.ultimate.skills,
    };
  });

  expect(result.baseOverview).toEqual([{ type: 'paragraph', content: 'Base overview.' }]);
  expect(result.baseSkills).toEqual([]);
  expect(result.stateOverview).toEqual([{ type: 'paragraph', content: 'Ultimate overview.' }]);
  expect(result.stateSkills).toEqual([{ id: 'ult-skill', name: 'Dismantle' }]);
});

test('switching states flushes what is being typed into the state being left', async ({ page }) => {
  // currentStrategyBlocks only reaches desc_data on sync, so a switch without
  // a flush drops the paragraph in progress - and drops it into whichever
  // state you happen to land on.
  const { desc, frame } = PLAIN();
  await openEditor(page, { desc, frame });

  const seen = await page.evaluate(async () => {
    await window.addEditorMode();

    // What typing into the block editor leaves behind.
    currentStrategyBlocks = [{ type: 'paragraph', content: 'Ultimate overview.' }];

    await window.setEditorMode('base');
    const backOnBase = window.currentEditorDescData.overview;

    await window.setEditorMode('ultimate');
    const backOnState = window.currentEditorDescData.overview;

    return { backOnBase, backOnState };
  });

  expect(seen.backOnBase).toEqual([{ type: 'paragraph', content: 'Base overview.' }]);
  expect(seen.backOnState).toEqual([{ type: 'paragraph', content: 'Ultimate overview.' }]);
});

test('a state edit becomes a mode-scoped delta that lands where it should', async ({ page }) => {
  const { desc, frame } = PLAIN();
  await openEditor(page, { desc, frame });

  const round = await page.evaluate(async () => {
    await window.addEditorMode();

    const base = window.scopeEditorDelta('matchup', 'Sukuna');
    await window.setEditorMode('base');
    const plain = window.scopeEditorDelta('matchup', 'Sukuna');

    // The delta the editor would submit for the ultimate state, applied to a
    // clean copy of the live row the way admin.js applies it on approval.
    const payload = { opponent: 'Sukuna', tier: 'Advantage', content: [] };
    const applied = window.applyDeltaToData(
      { matchups: [{ opponent: 'Gojo', tier: 'Equal' }] },
      {},
      base.scope, base.key, payload
    );

    return { base, plain, applied };
  });

  expect(round.base).toEqual({ scope: 'mode', key: 'ultimate::matchup::Sukuna' });
  // Base-mode edits keep emitting the plain scope, so every ticket already in
  // the queue keeps applying exactly as before.
  expect(round.plain).toEqual({ scope: 'matchup', key: 'Sukuna' });

  expect(round.applied.newDesc.modeData.ultimate.matchups).toEqual([
    { opponent: 'Sukuna', tier: 'Advantage', content: [] },
  ]);
  // The base kit's own matchups are untouched by a state-scoped delta.
  expect(round.applied.newDesc.matchups).toEqual([{ opponent: 'Gojo', tier: 'Equal' }]);
});

test('a move delta keeps its category through the mode wrapper', async ({ page }) => {
  // The move scope has a composite key of its own, so mode wrapping produces
  // three segments and the unwrapper has to split exactly twice.
  const { desc, frame } = PLAIN();
  await openEditor(page, { desc, frame });

  const out = await page.evaluate(async () => {
    await window.addEditorMode();
    const scoped = window.scopeEditorDelta('move', 'skills::ult-cleave');
    const applied = window.applyDeltaToData({}, {}, scoped.scope, scoped.key, {
      frame_data: { id: 'ult-cleave', name: 'Cleave' },
      desc_data: [{ type: 'paragraph', content: 'Hits hard.' }],
    });
    return { scoped, applied };
  });

  expect(out.scoped.key).toBe('ultimate::move::skills::ult-cleave');
  expect(out.applied.newFrame.modeData.ultimate.skills).toEqual([{ id: 'ult-cleave', name: 'Cleave' }]);
  expect(out.applied.newDesc.modeData.ultimate.moveStrategies['ult-cleave'])
    .toEqual([{ type: 'paragraph', content: 'Hits hard.' }]);
});

test('the local draft holds the whole character, not the state being edited', async ({ page }) => {
  // Saving the slice would restore a draft containing only that state, and
  // silently drop the base kit the moment it was reloaded.
  const { desc, frame } = PLAIN();
  await openEditor(page, { desc, frame });

  const draft = await page.evaluate(async () => {
    await window.addEditorMode();
    window.currentEditorDescData.overview = [{ type: 'paragraph', content: 'Ultimate overview.' }];
    window.saveLocalDraft();
    return JSON.parse(localStorage.getItem('wiki_draft_testchar'));
  });

  expect(draft.desc_data.overview).toEqual([{ type: 'paragraph', content: 'Base overview.' }]);
  expect(draft.desc_data.modeData.ultimate.overview).toEqual([{ type: 'paragraph', content: 'Ultimate overview.' }]);
  expect(draft.mode).toBe('ultimate');
});

test('renaming a state keeps its id, so its content is not orphaned', async ({ page }) => {
  const { desc, frame } = PLAIN();
  await openEditor(page, { desc, frame });

  await page.evaluate(async () => {
    await window.addEditorMode();
    window.currentEditorDescData.overview = [{ type: 'paragraph', content: 'Ultimate overview.' }];
  });

  const field = page.locator('#editor-mode-name');
  await expect(field).toHaveValue('Ultimate');
  await field.fill('Malevolent Shrine');

  const after = await page.evaluate(() => ({
    modes: window.editorMasterFrameData.modes,
    content: window.editorMasterDescData.modeData.ultimate.overview,
    // The field must survive its own input handler.
    stillFocusable: !!document.getElementById('editor-mode-name'),
  }));

  expect(after.modes[1]).toEqual({ id: 'ultimate', label: 'Malevolent Shrine' });
  expect(after.content).toEqual([{ type: 'paragraph', content: 'Ultimate overview.' }]);
  expect(after.stillFocusable).toBe(true);
  await expect(page.locator('#editor-mode-bar .character-mode-chip.active')).toHaveText('Malevolent Shrine');
});

test('deleting the last extra state returns the character to a plain one', async ({ page }) => {
  const { desc, frame } = PLAIN();
  await openEditor(page, { desc, frame });

  await page.evaluate(async () => {
    await window.addEditorMode();
    window.currentEditorDescData.overview = [{ type: 'paragraph', content: 'Ultimate overview.' }];
  });

  await page.locator('#editor-mode-delete').click();
  // The site's own confirm modal, not a native dialog.
  await expect(page.locator('#editor-modal-confirm')).toBeVisible();
  await expect(page.locator('#editor-modal-confirm')).toHaveText('DELETE STATE');
  await page.locator('#editor-modal-confirm').click();

  // Back to a plain character: no state chips, just the way to add one again.
  await expect(page.locator('#editor-mode-bar .character-mode-chip')).toHaveText(['+ STATE']);
  await expect(page.locator('#editor-mode-controls')).toBeHidden();

  const after = await page.evaluate(() => ({
    modes: window.editorMasterFrameData.modes,
    modeData: window.editorMasterDescData.modeData,
    mode: window.editorActiveMode,
    overview: window.currentEditorDescData.overview,
  }));

  expect(after.modes).toBeUndefined();
  expect(after.modeData.ultimate).toBeUndefined();
  expect(after.mode).toBe('base');
  expect(after.overview).toEqual([{ type: 'paragraph', content: 'Base overview.' }]);
});

test('a base-only character gets the Ultimate tab and no state toggle', async ({ page }) => {
  // locust_guy is flagged is_base_only in the real registry.
  const { desc, frame } = PLAIN();
  await openEditor(page, { pageId: 'locust_guy', desc, frame });

  await expect(page.locator('#edit-nav-ultimateAtk')).toBeVisible();
  await expect(page.locator('#editor-mode-bar')).toBeHidden();
});

test('a full character gets the state toggle and no Ultimate tab', async ({ page }) => {
  const { desc, frame } = PLAIN();
  await openEditor(page, { pageId: 'boomcat', desc, frame });

  await expect(page.locator('#edit-nav-ultimateAtk')).toBeHidden();
  await page.evaluate(() => window.addEditorMode());
  await expect(page.locator('#editor-mode-bar')).toBeVisible();
});

test('the Ultimate tab uses the same move editor as Skills and Specials', async ({ page }) => {
  const { desc } = PLAIN();
  const frame = { m1s: [], skills: [], specials: [], ultimateAtk: [{ id: 'swarm', name: 'Locust Swarm' }] };
  await openEditor(page, { pageId: 'locust_guy', tab: 'ultimateAtk', desc, frame });

  // The move sub-nav, not the "Editing ultimateAtk" fallback.
  await expect(page.locator('#move-nav-swarm')).toHaveText('Locust Swarm');
  await expect(page.locator('#move-editor-container')).toBeVisible();
});

// --- WHAT ACTUALLY REACHES THE DATABASE ---
// The state's content deltas are wrapped and land in modeData, but which
// states exist is page-level and is not covered by any tab's scan. Without its
// own payload a contributor could add an ultimate state, write a whole kit
// into it, and have every content delta apply while the declaration never
// shipped - leaving the work in the database with no toggle able to reach it.
async function bootEditorWithSession(page, { desc, frame }) {
  await page.addInitScript(({ desc, frame }) => {
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
                  // A fresh copy per read, deliberately. The editor mutates the
                  // object it was handed, so returning the same reference would
                  // make the submit-time collision check compare this session's
                  // own edit against itself and pop the "someone else changed
                  // this" confirm on every submission.
                  single: async () => ({
                    data: { desc_data: JSON.parse(JSON.stringify(desc)), frame_data: JSON.parse(JSON.stringify(frame)) },
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
              // site_utils.js polls the inbox on every page; an empty result
              // keeps it quiet rather than throwing through its boot handler.
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
  }, { desc, frame });

  await page.goto('/edit.html?char=boomcat&tab=overview', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.removeItem('wiki_last_submit_time');
    // The QA modal is a separate interaction; these tests are about the payload.
    window.openQAModal = async () => ({ changelog: 'Added a state.', confidence: 'high', evidence: '' });
  });
}

test('adding a state ships the declaration, not just the content', async ({ page }) => {
  const { desc, frame } = PLAIN();
  await bootEditorWithSession(page, { desc, frame });

  await page.evaluate(async () => {
    await window.addEditorMode();
    currentStrategyBlocks = [{ type: 'paragraph', content: 'Ultimate overview.' }];
  });

  await page.locator('#submit-payload-btn').click();
  await expect.poll(() => page.evaluate(() => (window.__inserted || []).length)).toBeGreaterThan(0);

  const inserted = await page.evaluate(() => window.__inserted);
  expect(inserted).toHaveLength(1);

  const ticket = inserted[0];
  expect(ticket.is_delta).toBe(true);
  expect(ticket.target_scope).toBe('multi');

  const deltas = ticket.delta_payload.map(d => `${d.scope}:${d.key ?? ''}`);
  expect(deltas, 'the toggle itself has to ship or the state is unreachable')
    .toContain('modes:full');
  expect(deltas).toContain('mode:ultimate::overview::full');

  // Applying the ticket produces both the toggle and the content behind it.
  const applied = await page.evaluate((payload) =>
    window.applyDeltaToData({}, {}, 'multi', 'batch', payload), ticket.delta_payload);

  expect(applied.newFrame.modes).toEqual([
    { id: 'base', label: 'Base Kit' }, { id: 'ultimate', label: 'Ultimate' },
  ]);
  expect(applied.newDesc.modeData.ultimate.overview).toEqual([{ type: 'paragraph', content: 'Ultimate overview.' }]);
});

test('a base-kit edit on a plain character still ships exactly as before', async ({ page }) => {
  // The regression guard for every contributor who has never seen a state.
  const { desc, frame } = PLAIN();
  await bootEditorWithSession(page, { desc, frame });

  await page.evaluate(() => {
    currentStrategyBlocks = [{ type: 'paragraph', content: 'Rewritten base overview.' }];
  });

  await page.locator('#submit-payload-btn').click();
  await expect.poll(() => page.evaluate(() => (window.__inserted || []).length)).toBeGreaterThan(0);

  const inserted = await page.evaluate(() => window.__inserted);
  expect(inserted).toHaveLength(1);
  expect(inserted[0].target_scope).toBe('overview');
  expect(inserted[0].target_key).toBe('full');
  expect(inserted[0].delta_payload).toEqual([{ type: 'paragraph', content: 'Rewritten base overview.' }]);
});

test('a gallery page shows no character tab strip', async ({ page }) => {
  // Missing from renderEditorTabNav's exclusion list when the gallery type
  // shipped, so its editor offered six tabs that did nothing.
  await page.goto('/edit.html?page=emotes&type=gallery', { waitUntil: 'networkidle' });

  await page.evaluate(() => {
    window.currentEditorPageType = 'gallery';
    window.currentEditorDescData = { items: [] };
    window.renderEditorTabNav('overview');
  });

  await expect(page.locator('#editor-tab-nav')).toBeHidden();
});
