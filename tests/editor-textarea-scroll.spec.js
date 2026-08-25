// A long entry in an editor text field has to stay reachable.
//
// style/editor.css carried two rules for the same 0-1-0 selector: the 260px cap
// with `overflow-y: auto` (line ~240), and a bare `.editor-textarea { overflow:
// hidden }` about 190 lines further down, left over from when these fields grew
// to fit their content instead of capping. Same specificity, so the later one
// won, and every capped field showed 260px of text with no scrollbar and no
// wheel scrolling.
//
// The block editor hid this the whole time: autoSizeEditorTextarea writes
// style.overflowY inline, and an inline style outranks both rules. The fields
// that had nothing setting them inline - the combo card's route and notes, the
// QA changelog on the submit modal, the tier changelog - did not.
//
// So the first test reads a REAL combo card field, not a constructed one: the
// bug lived precisely in the gap between the class and what JS did to it.
const { test, expect } = require('@playwright/test');

const EDITOR = '/edit.html?char=boomcat&type=character&tab=combos';
const LONG_NOTE = Array.from({ length: 60 }, (_, i) => `Note line ${i}`).join('\n');

test('a long note on a combo card can be scrolled', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto(EDITOR, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const opened = await page.evaluate(({ LONG_NOTE }) => {
    window.currentEditorPageType = 'character';
    window.currentEditorCharId = 'testchar';
    window.currentEditorDescData = {
      overview: [], strategy: [], extras: [], matchups: [], counterplay: [],
      moveStrategies: {}, comboIntro: [], comboGroups: [],
      comboList: [{
        starter: 'Test Starter',
        rows: [{ sequence: ['M1'], damage: '10', difficulty: 'Easy', notes: LONG_NOTE }],
      }],
      profile: { image: '', stats: [] }, playstyle: { likes: [], dislikes: [] },
    };
    window.currentEditorFrameData = { m1s: [], skills: [], specials: [] };
    if (typeof window.openDocumentRowModal !== 'function') return 'no modal fn';
    window.openDocumentRowModal('combos', 0, 0);
    return 'ok';
  }, { LONG_NOTE });
  expect(opened, 'setup: the combo row modal is reachable').toBe('ok');
  await page.waitForTimeout(600);

  const seen = await page.evaluate(() => {
    const ta = document.querySelector('[data-combo-field="notes"]');
    if (!ta) return null;
    const before = ta.scrollTop;
    ta.scrollTop = 9999;
    const after = ta.scrollTop;
    return {
      overflowY: getComputedStyle(ta).overflowY,
      overflows: ta.scrollHeight > ta.clientHeight,
      inlineOverflow: ta.style.overflowY,
      reachedBottom: after > before,
    };
  });

  expect(seen, 'setup: the notes field rendered').not.toBeNull();
  expect(seen.overflows, 'setup: the note is longer than its box').toBe(true);
  // The claim. Not "the class is right" - what the browser decided to paint.
  expect(seen.overflowY, 'the field offers a scrollbar').toBe('auto');
  expect(seen.inlineOverflow,
    'and does so from CSS - nothing sets this one inline, which is the whole point').toBe('');
  expect(seen.reachedBottom, 'so the rest of the note is reachable').toBe(true);
  expect(errors).toEqual([]);
});

test('nothing in editor.css takes overflow back off the class', async ({ page }) => {
  // The rule that caused this was added in good faith and won on source order.
  // This asserts the resolved outcome for a bare .editor-textarea, so a future
  // `overflow: hidden` anywhere in the file is caught wherever it is written.
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto('/edit.html?char=boomcat&type=character&tab=overview', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const seen = await page.evaluate(() => {
    const host = document.createElement('div');
    host.style.width = '360px';
    document.body.appendChild(host);
    host.innerHTML = '<textarea class="editor-textarea"></textarea>';
    const cs = getComputedStyle(host.querySelector('textarea'));
    return { overflowY: cs.overflowY, maxHeight: cs.maxHeight };
  });

  expect(seen.overflowY, 'a plain .editor-textarea scrolls').toBe('auto');
  // Paired deliberately: the cap is why the scrollbar has to be there. If the
  // cap ever goes, this test should be revisited rather than quietly passing.
  expect(seen.maxHeight, 'and is still capped, which is what makes it needed').toBe('260px');
});

test('the block editor still hides the scrollbar on a field that fits', async ({ page }) => {
  // The reason the old rule existed. Restoring `overflow-y: auto` must not put
  // a scrollbar on every short block in the workspace.
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto('/edit.html?char=boomcat&type=character&tab=overview', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  await page.evaluate(() => {
    window.currentEditorPageType = 'character';
    window.currentEditorCharId = 'testchar';
    window.currentOverviewSection = null;
    window.currentEditorDescData = {
      overview: [], strategy: [{ type: 'paragraph', content: 'Short.' }],
      extras: [], matchups: [], counterplay: [], moveStrategies: {},
      profile: { image: '', stats: [] }, playstyle: { likes: [], dislikes: [] },
    };
    window.currentEditorFrameData = { m1s: [], skills: [], specials: [] };
    initFullTabEditor('testchar', 'overview', window.currentEditorDescData, window.currentEditorFrameData);
    window.loadOverviewSectionIntoEditor('strategy');
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    (window.getActiveBlocks() || []).forEach(b => window.setEditorBlockExpanded(b, true));
    window.renderBlockList();
  });
  await page.waitForTimeout(600);

  const seen = await page.evaluate(() => {
    const ta = document.querySelector('#block-list .editor-textarea');
    return {
      inlineOverflow: ta.style.overflowY,
      overflows: ta.scrollHeight > ta.clientHeight,
    };
  });

  expect(seen.overflows, 'setup: this one fits in its box').toBe(false);
  expect(seen.inlineOverflow, 'so the workspace keeps it scrollbar-free').toBe('hidden');
});
