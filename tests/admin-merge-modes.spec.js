// The merge compiler and character states.
//
// The compiler scanned only the top level of desc_data/frame_data. A character
// with ultimate states keeps those states under modeData, so a merge that
// swept up a state edit found no conflict for it, emitted no delta for it, and
// deleted the contributor's ticket on success. The edit was gone with no
// warning - the same data-loss class as the compile-time snapshot this file's
// sibling spec covers.
//
// The discriminating assertion is the second test: the merged ticket has to
// carry a mode-wrapped delta that lands inside modeData, not a plain one that
// overwrites the base kit with the ultimate state's content.
const { test, expect } = require('@playwright/test');

const LIVE_DESC = {
  overview: ['Base overview'],
  matchups: [{ opponent: 'A', tier: 'even', content: ['A strategy'] }],
  modeData: {
    ultimate: {
      overview: ['Ultimate overview'],
      matchups: [{ opponent: 'A', tier: 'even', content: ['A strategy, ultimate'] }],
    },
  },
};

const LIVE_FRAME = {
  modes: [{ id: 'base', label: 'Base Kit' }, { id: 'ultimate', label: 'Malevolent Shrine' }],
  skills: [{ id: 'base-skill', name: 'Cleave', startup: 10 }],
  modeData: {
    ultimate: { skills: [{ id: 'ult-skill', name: 'Dismantle', startup: 6 }] },
  },
};

async function compileMerge(page, queue) {
  return page.evaluate(async ({ liveDesc, liveFrame, queue }) => {
    document.body.innerHTML = `
      <div id="compiler-modal-overlay" class="hidden">
        <h3>SMART COMPILER: <span id="compiler-char-name"></span></h3>
        <div id="compiler-modal-body"></div>
        <button id="btn-compiler-confirm"></button>
      </div>
    `;

    const captured = { update: null, updateId: null, deletedIds: null };

    window.supabaseClient = {
      from(table) {
        if (table === 'page_data') {
          return {
            select() { return this; },
            eq() { return this; },
            single: async () => ({ data: { desc_data: liveDesc, frame_data: liveFrame }, error: null }),
          };
        }
        if (table === 'pending_revisions') {
          return {
            update(payload) { captured.update = payload; return this; },
            delete() { captured.deleting = true; return this; },
            eq(_col, val) { captured.updateId = val; return Promise.resolve({ error: null }); },
            in(_col, vals) { captured.deletedIds = vals; return Promise.resolve({ error: null }); },
          };
        }
        throw new Error('unexpected table: ' + table);
      },
    };

    window.adminConfirm = async () => true;
    window.adminAlert = () => {};
    window.currentUserId = 'staff-user';
    window.resetPreviewState = () => {};
    window.loadQueue = () => {};

    window.currentQueueData = queue;

    await window.openMergeCompiler('testchar');

    const sections = Array.from(document.querySelectorAll('.compiler-conflict-card .compiler-conflict-title'))
      .map(el => el.textContent);

    document.querySelectorAll('.compiler-conflict-card select').forEach(sel => {
      sel.value = sel.options[sel.options.length - 1].value;
    });

    await document.getElementById('btn-compiler-confirm').onclick();

    return { captured, sections };
  }, { liveDesc: LIVE_DESC, liveFrame: LIVE_FRAME, queue });
}

// Alice edits the base kit's overview. Bob edits the ultimate state's matchup.
// Nothing overlaps, and neither should be able to erase the other.
const QUEUE = [
  {
    id: 'ticket-alice', page_id: 'testchar', author_name: 'Alice',
    created_at: '2026-08-01T00:00:00Z',
    is_delta: true, target_scope: 'overview', target_key: null,
    delta_payload: ['Alice rewrote the base overview'],
    desc_data: {}, frame_data: {},
    qa_metadata: { changelog: 'Base overview.', confidence: 'high', evidence: '' },
  },
  {
    id: 'ticket-bob', page_id: 'testchar', author_name: 'Bob',
    created_at: '2026-08-02T00:00:00Z',
    is_delta: true, target_scope: 'mode', target_key: 'ultimate::matchup::A',
    delta_payload: { opponent: 'A', tier: 'winning', content: ['A strategy, ultimate, corrected'] },
    desc_data: {}, frame_data: {},
    qa_metadata: { changelog: 'Ultimate matchup.', confidence: 'medium', evidence: '' },
  },
];

test('a state edit shows up as its own conflict, labelled with the state', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  const { sections } = await compileMerge(page, QUEUE);

  // Two conflicts, not one: the base overview and the ultimate matchup are
  // different sections of different kits and must never be offered as
  // alternatives to each other.
  expect(sections).toContain('Character Overview');
  expect(sections).toContain('[ULTIMATE] Matchup: A');
});

test('the merged ticket carries the state edit as a mode-wrapped delta', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  const { captured } = await compileMerge(page, QUEUE);

  expect(captured.update.is_delta).toBe(true);
  expect(captured.update.target_scope).toBe('multi');

  const deltas = captured.update.delta_payload.map(d => `${d.scope}:${d.key ?? ''}`).sort();
  expect(deltas).toEqual(['mode:ultimate::matchup::A', 'overview:']);
});

test('applying the merged ticket puts each edit in its own kit', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  const { captured } = await compileMerge(page, QUEUE);

  const applied = await page.evaluate(({ payload, liveDesc, liveFrame }) => {
    return window.applyDeltaToData(liveDesc, liveFrame, 'multi', 'batch', payload);
  }, { payload: captured.update.delta_payload, liveDesc: LIVE_DESC, liveFrame: LIVE_FRAME });

  expect(applied.newDesc.overview).toEqual(['Alice rewrote the base overview']);
  expect(applied.newDesc.modeData.ultimate.matchups).toEqual([
    { opponent: 'A', tier: 'winning', content: ['A strategy, ultimate, corrected'] },
  ]);

  // The base kit's matchup is untouched by Bob's ultimate-state edit, and the
  // ultimate state's overview is untouched by Alice's base edit.
  expect(applied.newDesc.matchups).toEqual([{ opponent: 'A', tier: 'even', content: ['A strategy'] }]);
  expect(applied.newDesc.modeData.ultimate.overview).toEqual(['Ultimate overview']);
});

test('a move inside a state merges into that state, not over the base moveset', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const { captured } = await compileMerge(page, [
    {
      id: 'ticket-carol', page_id: 'testchar', author_name: 'Carol',
      created_at: '2026-08-03T00:00:00Z',
      is_delta: true, target_scope: 'mode', target_key: 'ultimate::move::skills::ult-skill',
      delta_payload: {
        frame_data: { id: 'ult-skill', name: 'Dismantle', startup: 4 },
        desc_data: ['Faster than it looks.'],
      },
      desc_data: {}, frame_data: {},
      qa_metadata: { changelog: 'Reframed.', confidence: 'high', evidence: '' },
    },
  ]);

  const deltas = captured.update.delta_payload;
  expect(deltas).toHaveLength(1);
  expect(deltas[0].scope).toBe('mode');
  expect(deltas[0].key).toBe('ultimate::move::skills::ult-skill');

  const applied = await page.evaluate(({ payload, liveDesc, liveFrame }) => {
    return window.applyDeltaToData(liveDesc, liveFrame, 'multi', 'batch', payload);
  }, { payload: deltas, liveDesc: LIVE_DESC, liveFrame: LIVE_FRAME });

  expect(applied.newFrame.modeData.ultimate.skills).toEqual([{ id: 'ult-skill', name: 'Dismantle', startup: 4 }]);
  // The base kit's own Cleave keeps its frames.
  expect(applied.newFrame.skills).toEqual([{ id: 'base-skill', name: 'Cleave', startup: 10 }]);
});
