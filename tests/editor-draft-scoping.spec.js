// Regression coverage for a real bug in js/editor-drafts.js's saveLocalDraft,
// matching the site owner's own complaint about the draft system ("something
// wrong with save, can't pinpoint it"). Root cause: window.currentEditorDescData
// is always the FULL character object for the whole editing session, but the
// localStorage key used to be scoped per-tab/move (wiki_draft_{char}_{tab}
// [_{move}]) - every tab/move switched to within one session created a new,
// separate key holding a growing full snapshot, none of which ever got swept
// except the single last-active one on submit. Fixed by scoping the key
// per-character only (wiki_draft_{char}), so every save in a session
// overwrites the same one entry instead of creating orphans.
const { test, expect } = require('@playwright/test');

test('real bug fix: saveLocalDraft no longer creates a new orphaned key every time the active move/tab changes within one session', async ({ page }) => {
  await page.goto('/edit.html?page=boomcat&type=character&tab=overview', { waitUntil: 'networkidle' });

  const result = await page.evaluate(() => {
    localStorage.clear();

    window.currentEditorCharId = 'boomcat';
    window.currentEditorDescData = { moveStrategies: { m1: ['first move edit'] } };
    window.currentEditorFrameData = {};

    // Simulate being on move "m1" (mirrors saveLocalDraft's own DOM-based
    // move-id detection via a fake active nav button, same as the real UI).
    const btn1 = document.createElement('button');
    btn1.id = 'move-nav-m1';
    btn1.className = 'daw-variant-tabs daw-tab-btn active';
    document.body.appendChild(btn1);
    const wrap1 = document.createElement('div');
    wrap1.className = 'daw-variant-tabs';
    wrap1.appendChild(btn1);
    document.body.appendChild(wrap1);

    window.currentEditorTabId = 'm1s';
    window.saveLocalDraft();
    const keysAfterFirstSave = Object.keys(localStorage).filter(k => k.startsWith('wiki_draft_'));

    // Now switch to a different move within the same session and save again.
    btn1.id = 'move-nav-m2';
    window.currentEditorDescData = { moveStrategies: { m1: ['first move edit'], m2: ['second move edit'] } };
    window.saveLocalDraft();
    const keysAfterSecondSave = Object.keys(localStorage).filter(k => k.startsWith('wiki_draft_'));

    wrap1.remove();

    return { keysAfterFirstSave, keysAfterSecondSave };
  });

  expect(result.keysAfterFirstSave).toEqual(['wiki_draft_boomcat']);
  // The real bug: this used to be 2 keys (wiki_draft_boomcat_m1s_m1 AND
  // wiki_draft_boomcat_m1s_m2) after switching moves and saving again -
  // the first one orphaned forever, since only the current key ever gets
  // swept on submit.
  expect(result.keysAfterSecondSave).toEqual(['wiki_draft_boomcat']);
});
