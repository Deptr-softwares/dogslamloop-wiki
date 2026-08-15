// Regression cover for the P0 the reviewer team hit: merging submissions
// used to produce a FULL OVERWRITE.
//
// The compiler builds its merged content by applying each ticket onto live
// data at *compile* time, but the ticket was written with is_delta: false -
// so approval, which can happen minutes or days later, wrote that stale
// snapshot over the whole page. Anything approved in between vanished with
// no conflict and no warning. Rare with nine trusted friends, routine with
// thirty contributors.
//
// The fix emits a multi-scope delta instead, so approval injects only the
// sections the reviewer actually chose.
//
// The discriminating assertion is the third test: it moves live data on
// AFTER the merge is compiled, then applies the merged ticket. A snapshot
// payload loses that change; a delta payload keeps it. Asserting only the
// payload's shape would pass for a snapshot that happened to be correct at
// compile time, which is exactly the bug.
const { test, expect } = require('@playwright/test');

// Two tickets touching different, non-overlapping parts of the same page.
const LIVE_DESC = {
  overview: ['Live overview'],
  matchups: [
    { opponent: 'A', tier: 'even', content: ['A strategy'] },
    { opponent: 'B', tier: 'even', content: ['B strategy'] },
  ],
};
const LIVE_FRAME = {
  skills: [{ id: 'skill-one', name: 'Skill One', startup: 10 }],
};

async function compileMerge(page) {
  return page.evaluate(async ({ liveDesc, liveFrame }) => {
    // admin.html's RBAC gate wipes document.body for this logged-out visitor -
    // rebuild only the DOM openMergeCompiler actually reads.
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
    // Both are plain top-level function declarations in admin-queue.js, so
    // they are writable globals; the compiler calls them bare on success.
    window.resetPreviewState = () => {};
    window.loadQueue = () => {};

    // Alice rewrites the overview. Bob edits the matchup vs B. Nothing overlaps.
    window.currentQueueData = [
      {
        id: 'ticket-alice', page_id: 'testchar', author_name: 'Alice',
        created_at: '2026-08-01T00:00:00Z',
        is_delta: true, target_scope: 'overview', target_key: null,
        delta_payload: ['Alice rewrote the overview'],
        desc_data: {}, frame_data: {},
        qa_metadata: { changelog: 'Rewrote the overview for clarity.', confidence: 'high', evidence: 'https://example.test/alice' },
      },
      {
        id: 'ticket-bob', page_id: 'testchar', author_name: 'Bob',
        created_at: '2026-08-02T00:00:00Z',
        is_delta: true, target_scope: 'matchup', target_key: 'B',
        delta_payload: { opponent: 'B', tier: 'winning', content: ['B strategy, corrected'] },
        desc_data: {}, frame_data: {},
        qa_metadata: { changelog: 'Corrected the B matchup tier.', confidence: 'low', evidence: '' },
      },
    ];

    await window.openMergeCompiler('testchar');

    // Accept every contributor version (the last option in each select is
    // preselected; "live" is the discard option at index 0).
    document.querySelectorAll('.compiler-conflict-card select').forEach(sel => {
      sel.value = sel.options[sel.options.length - 1].value;
    });

    await document.getElementById('btn-compiler-confirm').onclick();

    return captured;
  }, { liveDesc: LIVE_DESC, liveFrame: LIVE_FRAME });
}

test('a merged ticket is a multi-scope delta, not a full overwrite', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  const captured = await compileMerge(page);

  expect(captured.update, 'the compiler should have written a merged ticket').toBeTruthy();
  expect(captured.update.is_delta, 'a merged ticket must apply as a patch, not a snapshot').toBe(true);
  expect(captured.update.target_scope).toBe('multi');
  expect(Array.isArray(captured.update.delta_payload)).toBe(true);

  // One delta per accepted conflict: Alice's overview, Bob's matchup.
  //
  // The singular scope's key is 'full', not null. This assertion previously
  // expected 'overview:' — it had pinned the null the compiler was emitting,
  // and so helped the bug survive: js/admin-preview.js interpolated
  // key.replace(...) into the diff label, threw on the null, and abandoned
  // every remaining edit in the batch. A real merged ticket on
  // defense_attorney counted 5 edits and showed a reviewer 2.
  //
  // `?? ''` is kept rather than tightened, so a regression back to null would
  // show up here as 'overview:' rather than crashing this line.
  const scopes = captured.update.delta_payload.map(d => `${d.scope}:${d.key ?? ''}`).sort();
  expect(scopes).toEqual(['matchup:B', 'overview:full']);

  // The other merged ticket is still cleaned up.
  expect(captured.deletedIds).toEqual(['ticket-alice']);
  expect(captured.updateId).toBe('ticket-bob');
});

test('a merged ticket keeps every contributor QA note, and takes the lowest confidence', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  const captured = await compileMerge(page);

  const qa = captured.update.qa_metadata;

  // Previously replaced wholesale by "System Merge: Unified edits from N
  // contributors." - the audit trail of who verified what was thrown away.
  expect(qa.changelog).toContain('Rewrote the overview for clarity.');
  expect(qa.changelog).toContain('Corrected the B matchup tier.');
  expect(qa.changelog).toContain('Alice');
  expect(qa.changelog).toContain('Bob');

  // Evidence used to keep only the master ticket's, dropping everyone else's.
  expect(qa.evidence).toContain('https://example.test/alice');

  // Confidence was hardcoded "high" even when a source said "low", which
  // tells a reviewer the opposite of the truth.
  expect(qa.confidence, 'a merge is only as certain as its least certain source').toBe('low');
});

test('approving a merged ticket does not clobber work approved after the merge was compiled', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  const captured = await compileMerge(page);

  // The scenario the P0 describes: after the merge is compiled but before a
  // reviewer approves it, a third contributor's matchup-A edit and a skill
  // frame-data edit both land. Live data has moved on.
  const applied = await page.evaluate((rev) => {
    const laterLiveDesc = {
      overview: ['Live overview'],
      matchups: [
        { opponent: 'A', tier: 'losing', content: ['A strategy, revised by Carol'] },
        { opponent: 'B', tier: 'even', content: ['B strategy'] },
      ],
    };
    const laterLiveFrame = {
      skills: [{ id: 'skill-one', name: 'Skill One', startup: 7 }],
    };

    // Mirrors the real approval branch (js/admin-actions.js:65-75) rather
    // than assuming the delta path - under the old payload this fell through
    // to the snapshot, which is precisely how the work was lost.
    if (rev.is_delta) {
      const { newDesc, newFrame } = window.applyDeltaToData(
        laterLiveDesc, laterLiveFrame,
        rev.target_scope, rev.target_key, rev.delta_payload
      );
      return { newDesc, newFrame };
    }
    return { newDesc: rev.desc_data || {}, newFrame: rev.frame_data || {} };
  }, captured.update);

  // What the merge actually chose still applies.
  expect(applied.newDesc.overview).toEqual(['Alice rewrote the overview']);
  const matchupB = applied.newDesc.matchups.find(m => m.opponent === 'B');
  expect(matchupB.tier).toBe('winning');

  // And the work that landed in between survives. Under the old snapshot
  // payload both of these reverted to their compile-time values, silently.
  const matchupA = applied.newDesc.matchups.find(m => m.opponent === 'A');
  expect(matchupA.tier, "Carol's matchup edit landed after the merge was compiled").toBe('losing');
  expect(matchupA.content).toEqual(['A strategy, revised by Carol']);
  expect(applied.newFrame.skills[0].startup, 'a frame-data edit the merge never touched').toBe(7);
});
