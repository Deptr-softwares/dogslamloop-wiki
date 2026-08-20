// Reordering a list must submit, and must apply.
//
// THE BUG
//
// Position was not in the delta model at all, and it failed at both ends:
//
//   The submit scan pairs local against cloud by IDENTITY
//   (`cloudMoves.find(old => old.id === m.id)`), so an entry that only moved
//   has a byte-identical partner and produced no payload. The editor reported
//   "no changes detected" and refused to submit.
//
//   applyDeltaToData replaces in place - findIndex, then assign - so even a
//   ticket carrying the new order would have written each entry back into the
//   slot it already occupied.
//
// Together that is the owner's report: reordering alone would not submit, and
// reordering PLUS a wording change submitted, applied the wording, and left the
// order untouched.
//
// BACKWARD COMPATIBILITY IS THE OTHER HALF OF THIS FILE
//
// The scope is new; the data is not. page_data holds content written long
// before it existed, and two shapes make a reorder ambiguous - an entry with no
// identity, and two entries sharing one (combo group titles are contributor
// text, and js/description.js already notes two groups may share a title).
// Both ends refuse those rather than guessing, because losing a reorder is
// visible and repeatable while shuffling somebody's page is neither.
const { test, expect } = require('@playwright/test');

// applyDeltaToData is pure and lives in site_utils.js, so these run against the
// real function in a real page rather than a reimplementation of it.
async function apply(page, baseDesc, baseFrame, scope, key, payload) {
  return page.evaluate(([d, f, s, k, p]) =>
    window.applyDeltaToData(d, f, s, k, p), [baseDesc, baseFrame, scope, key, payload]);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.applyDeltaToData === 'function');
});

test('an order delta reorders a move list', async ({ page }) => {
  const frame = { skills: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }] };

  const out = await apply(page, {}, frame, 'order', 'frame.skills', ['c', 'a', 'b']);
  expect(out.newFrame.skills.map(m => m.id)).toEqual(['c', 'a', 'b']);

  // The entries themselves are untouched - this scope moves things, it does
  // not edit them.
  expect(out.newFrame.skills.find(m => m.id === 'a').name).toBe('A');
});

test('an order delta reorders a keyed section', async ({ page }) => {
  const desc = { comboGroups: [{ title: 'True' }, { title: 'Simpler' }, { title: 'Advanced' }] };

  const out = await apply(page, desc, {}, 'order', 'desc.comboGroups', ['Advanced', 'True', 'Simpler']);
  expect(out.newDesc.comboGroups.map(g => g.title)).toEqual(['Advanced', 'True', 'Simpler']);
});

test('an entry the delta does not name keeps its index rather than being pushed to the end', async ({ page }) => {
  // A ticket is raised against a snapshot. Anything added to the live page
  // since is not this delta's business, and appending it would move content
  // the contributor never touched.
  const frame = {
    skills: [{ id: 'a' }, { id: 'NEW' }, { id: 'b' }, { id: 'c' }],
  };

  const out = await apply(page, {}, frame, 'order', 'frame.skills', ['c', 'a', 'b']);

  // NEW stays in slot 1. The three named entries fill slots 0, 2 and 3 in
  // their requested order.
  expect(out.newFrame.skills.map(m => m.id)).toEqual(['c', 'NEW', 'a', 'b']);
});

test('a list with a duplicate identity is left completely alone', async ({ page }) => {
  // Two combo groups may share a title. There is no single correct answer for
  // which one the payload means, so the safe move is to change nothing.
  const desc = { comboGroups: [{ title: 'True' }, { title: 'True' }, { title: 'Advanced' }] };

  const out = await apply(page, desc, {}, 'order', 'desc.comboGroups', ['Advanced', 'True', 'True']);
  expect(out.newDesc.comboGroups.map(g => g.title)).toEqual(['True', 'True', 'Advanced']);
});

test('a list holding an entry with no identity is left completely alone', async ({ page }) => {
  // Older content, or a list this scope was never meant for.
  const desc = { comboGroups: [{ title: 'True' }, { note: 'no identity here' }, { title: 'Advanced' }] };

  const out = await apply(page, desc, {}, 'order', 'desc.comboGroups', ['Advanced', 'True']);
  expect(out.newDesc.comboGroups).toEqual(desc.comboGroups);
});

test('an order delta naming a list that does not exist changes nothing', async ({ page }) => {
  // A ticket raised against a page whose field was later removed.
  const desc = { comboGroups: [{ title: 'True' }] };
  const out = await apply(page, desc, {}, 'order', 'desc.notAThing', ['x']);
  expect(out.newDesc).toEqual(desc);
});

test('every other scope still applies exactly as before', async ({ page }) => {
  // The guard that this change is additive. A new branch in applyDeltaToData
  // sits above the existing ones, and a mistake there would break every ticket
  // in the queue rather than only the new kind.
  const desc = { comboGroups: [{ title: 'True', content: [] }], overview: [{ type: 'paragraph', content: 'old' }] };

  const edited = await apply(page, desc, {}, 'comboGroup', 'True',
    { title: 'True', content: [{ type: 'paragraph', content: 'new' }] });
  expect(edited.newDesc.comboGroups[0].content[0].content).toBe('new');

  const overview = await apply(page, desc, {}, 'overview', 'full',
    [{ type: 'paragraph', content: 'replaced' }]);
  expect(overview.newDesc.overview[0].content).toBe('replaced');

  // And an unknown scope is still a no-op rather than a throw.
  const unknown = await apply(page, desc, {}, 'not_a_scope', 'x', { a: 1 });
  expect(unknown.newDesc.comboGroups).toEqual(desc.comboGroups);
});

test('an order delta inside a character state unwraps like every other scope', async ({ page }) => {
  // The mode unwrapper peels `<modeId>::<scope>::<key>` and recurses, so a new
  // scope gets state support for free - but only if it does not depend on
  // anything the unwrapper strips. Worth pinning, because getting it wrong
  // would write a state's reorder into the base kit.
  const desc = {
    modeData: {
      ult: { comboGroups: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] },
    },
    comboGroups: [{ title: 'A' }, { title: 'B' }, { title: 'C' }],
  };

  // scope 'mode', with the state, the inner scope and the inner key packed
  // into the KEY - `<modeId>::<innerScope>::<innerKey>`. buildPayload wraps
  // this automatically, which is what makes a new scope state-aware for free.
  const out = await apply(page, desc, {}, 'mode', 'ult::order::desc.comboGroups', ['C', 'B', 'A']);

  expect(out.newDesc.modeData.ult.comboGroups.map(g => g.title)).toEqual(['C', 'B', 'A']);
  // The base kit is untouched.
  expect(out.newDesc.comboGroups.map(g => g.title)).toEqual(['A', 'B', 'C']);
});

test('reordering alone is a submittable change', async ({ page }) => {
  // THE OWNER'S PRIMARY SYMPTOM. Reordering and nothing else produced no
  // payload at all, so the editor's own change summary said "No changes
  // detected against the live database" and the contributor could not submit.
  //
  // Drives the real reorder control and reads the real change summary, because
  // the claim is about what a contributor sees - the scan itself is a closure
  // inside a DOMContentLoaded handler and is not reachable any other way.
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto('/edit.html?char=boomcat&type=character&tab=counterplay', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // Two entries of this test's own, so the reorder is against known content
  // rather than whatever the owner happens to have written.
  await page.evaluate(() => {
    window.currentEditorDescData.counterplay = [
      { topic: 'ZZ First', importance: 'Low', content: [] },
      { topic: 'ZZ Second', importance: 'Low', content: [] },
    ];
    window.originalCloudDescData.counterplay =
      JSON.parse(JSON.stringify(window.currentEditorDescData.counterplay));
  });

  // Re-render the strip against that data, then select the second entry and
  // move it left. Selection is read from the DOM at click time.
  await page.evaluate(() => window.switchEditorTab('overview'));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.switchEditorTab('counterplay'));
  await page.waitForTimeout(500);

  await page.locator('#counterplay-nav-1').click();
  await page.waitForTimeout(200);
  await page.locator('[data-reorder-list="desc.counterplay"][data-reorder-dir="-1"]').first().click();
  await page.waitForTimeout(400);

  const order = await page.evaluate(() =>
    window.currentEditorDescData.counterplay.map(e => e.topic));
  expect(order, 'the control actually moved it').toEqual(['ZZ Second', 'ZZ First']);

  // And the editor now considers that a change worth submitting.
  const summary = await page.evaluate(async () => {
    await window.triggerManualSync();
    window.renderDiffView();
    await new Promise(r => setTimeout(r, 300));
    const el = document.getElementById('diff-view-container');
    return el ? el.innerText : '';
  });

  // Positive, not merely absent: `.not.toContain` on an empty string passes
  // for the wrong reason, and an empty summary is exactly the failure mode
  // here. The container has to exist and have said something.
  expect(summary.length, 'the change summary rendered at all').toBeGreaterThan(0);
  expect(summary, 'a reorder must not report as no change')
    .not.toContain('No changes detected');

  expect(errors).toEqual([]);
});
