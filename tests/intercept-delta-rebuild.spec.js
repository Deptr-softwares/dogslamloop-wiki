// v0.17 B-I: a reviewer intercepts a ticket, edits it, gets "UPDATED!" - and
// nothing changed.
//
// THE MECHANISM. The intercept path rebuilt the delta by reading the ticket's
// own target_scope out of the editor's data:
//
//     dPayload = window.currentEditorDescData[scope];
//
// For a 'multi' ticket - a BATCH - there is no `currentEditorDescData.multi`,
// so that is `undefined`. supabase-js serializes the update with
// JSON.stringify, and JSON.stringify drops undefined values, so `delta_payload`
// was never in the PATCH at all and the column kept its old contents. The row's
// author_id, status and qa_metadata updated, the request returned no error, the
// button said UPDATED!, and the edits were gone.
//
// A merged ticket is 'multi'. So is a batched submission. This is the common
// case in a queue that has a MERGE TICKETS button, not a corner.
//
// The fix makes buildInterceptDelta return null for anything it cannot scope,
// which routes the submit through the ordinary diff scanner instead - so these
// tests are mostly about that null being returned for exactly the right shapes,
// and never a payload that would no-op.
const { test, expect } = require('@playwright/test');

async function loadEditor(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/edit.html?char=boomcat&type=character', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.buildInterceptDelta === 'function', { timeout: 45000 });
  return errors;
}

// The editor state an intercept reads from. Set directly so each case is about
// one ticket shape and nothing else.
async function withEditorData(page) {
  await page.evaluate(() => {
    window.currentEditorDescData = {
      overview: [{ type: 'text', content: 'live overview' }],
      extras: [{ title: 'Extra One' }, { title: 'Extra Two' }],
      moveStrategies: { m1: ['strategy for m1'] },
    };
    window.currentEditorFrameData = {
      skills: [{ id: 'm1', startup: 7 }, { id: 'm2', startup: 9 }],
    };
  });
}

const rebuild = (page, ticket) =>
  page.evaluate(t => window.buildInterceptDelta(t), ticket);

// --- THE BUG ---

test('a batched ticket is not rebuilt from a scope that does not exist', async ({ page }) => {
  const errors = await loadEditor(page);
  await withEditorData(page);

  const out = await rebuild(page, {
    is_delta: true, target_scope: 'multi', target_key: 'batch',
    delta_payload: [{ scope: 'overview', key: 'full', payload: [] }],
  });

  // null means "I cannot scope this - use the scanner". The old code returned a
  // payload here whose delta was undefined, which is strictly worse than
  // failing: it looked like a successful write.
  expect(out, 'a multi ticket has no single scope to rebuild').toBeNull();
  expect(errors).toEqual([]);
});

test('a legacy whole-page ticket is not rebuilt either', async ({ page }) => {
  await loadEditor(page);
  await withEditorData(page);

  // is_delta false, and target_scope null - the pre-delta upload format.
  // `currentEditorDescData[null]` is undefined, the same silent no-op.
  const out = await rebuild(page, { is_delta: false, target_scope: null, target_key: null });
  expect(out).toBeNull();
});

test('nothing that resolves to undefined is ever returned as a delta', async ({ page }) => {
  await loadEditor(page);
  await withEditorData(page);

  // The invariant, stated over the shapes most likely to drift into it - a
  // scope the editor does not carry, and an index past the end of a list. Each
  // one used to produce a payload that wrote nothing.
  const shapes = [
    { is_delta: true, target_scope: 'not_a_real_scope', target_key: 'full' },
    { is_delta: true, target_scope: 'extra', target_key: '99' },
    { is_delta: true, target_scope: 'move', target_key: 'nosuchcategory::m1' },
    { is_delta: true, target_scope: null, target_key: 'full' },
  ];

  for (const shape of shapes) {
    const out = await rebuild(page, shape);
    if (out !== null) {
      expect(out.delta, `${shape.target_scope}/${shape.target_key} produced a live no-op`)
        .not.toBeUndefined();
    }
  }
});

// --- THE HALF THAT MUST STILL WORK ---

test('a move ticket still rebuilds from the editor', async ({ page }) => {
  await loadEditor(page);
  await withEditorData(page);

  const out = await rebuild(page, {
    is_delta: true, target_scope: 'move', target_key: 'skills::m1',
  });

  expect(out).not.toBeNull();
  expect(out.scope).toBe('move');
  expect(out.key).toBe('skills::m1');
  // Reads the CURRENT editor contents, which is the whole point of an
  // intercept - the reviewer's edits, not the ticket's original payload.
  expect(out.delta.frame_data).toEqual({ id: 'm1', startup: 7 });
  expect(out.delta.desc_data).toEqual(['strategy for m1']);
});

test('an indexed extra still rebuilds, and by index', async ({ page }) => {
  await loadEditor(page);
  await withEditorData(page);

  const out = await rebuild(page, { is_delta: true, target_scope: 'extra', target_key: '1' });
  expect(out).not.toBeNull();
  expect(out.delta, 'the second extra, not the first').toEqual({ title: 'Extra Two' });
});

test('a character-state ticket unwraps to the scope it wraps', async ({ page }) => {
  await loadEditor(page);
  await withEditorData(page);

  // 'mode' is an envelope: mode::<stateId>::<scope>::<key>. initEditorModes has
  // already switched the editor into that state by this point, so the unwrapped
  // scope is the right thing to read and buildPayload re-wraps on the way out.
  const out = await rebuild(page, {
    is_delta: true, target_scope: 'mode', target_key: 'ultimate::move::skills::m2',
  });

  expect(out).not.toBeNull();
  expect(out.scope, 'unwrapped to the inner scope').toBe('move');
  expect(out.key).toBe('skills::m2');
  expect(out.delta.frame_data).toEqual({ id: 'm2', startup: 9 });
});

test('a plain section ticket rebuilds from its own key', async ({ page }) => {
  await loadEditor(page);
  await withEditorData(page);

  const out = await rebuild(page, { is_delta: true, target_scope: 'overview', target_key: 'full' });
  expect(out).not.toBeNull();
  expect(out.delta).toEqual([{ type: 'text', content: 'live overview' }]);
});
