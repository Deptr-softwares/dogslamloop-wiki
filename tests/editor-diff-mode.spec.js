// The editor's diff mode shows a contributor their change as a diff, not as tags.
//
// Found 2026-09-25, fixed in v0.20 batch 3. edit.html never loaded the review
// queue's diff (then in js/admin-diff.js) and js/editor-sync.js carried an
// older copy that returned real <ins>/<del> tags. Since v0.15 the block
// renderer escapes every field, so those tags were escaped as well: a
// paragraph changed from "Hold the dash" to "Hold the jump" read, to the
// contributor, as the literal text
//
//     Hold the <del class="diff-del">dash</del><ins class="diff-add">jump</ins>
//
// The call that would have turned markers into tags sat behind a typeof guard,
// so the missing script failed silently. Both screens now load
// js/diff-markers.js and the editor's copy is gone.
//
// Both sides of the comparison are set by this test, so it never reads the
// owner's Boomcat content.
const { test, expect } = require('@playwright/test');

test('a changed paragraph is marked, painted, and never printed as tags', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/edit.html?page=boomcat&type=character&tab=overview', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.currentEditorDescData && window.originalCloudDescData
    && typeof window.toggleDiffMode === 'function', { timeout: 45000 });

  await page.evaluate(() => {
    window.originalCloudDescData.overview = [{ type: 'paragraph', content: 'Hold the dash' }];
    window.currentEditorDescData.overview = [{ type: 'paragraph', content: 'Hold the jump' }];
    window.toggleDiffMode();
  });

  const target = page.locator('#diff-view-container .diff-inline-target')
    .filter({ hasText: 'Hold the' }).first();
  await expect(target).toBeVisible();

  const seen = await target.evaluate(el => {
    const ins = el.querySelector('ins.diff-add');
    const del = el.querySelector('del.diff-del');
    const plain = getComputedStyle(el).color;
    return {
      text: el.textContent,
      added: ins ? ins.textContent : null,
      removed: del ? del.textContent : null,
      // What a contributor sees: the marked words are painted differently
      // from the text around them, and the removed one is struck through.
      addedPaintedApart: ins ? getComputedStyle(ins).color !== plain : false,
      removedStruck: del ? getComputedStyle(del).textDecorationLine.includes('line-through') : false,
    };
  });

  expect(seen.text, 'no tag is printed as text').not.toMatch(/<\/?(ins|del)\b/);
  expect(seen.text, 'no raw marker survives').not.toMatch(/[\u0011-\u0014]/);
  expect(seen.added).toBe('jump');
  expect(seen.removed).toBe('dash');
  expect(seen.addedPaintedApart).toBe(true);
  expect(seen.removedStruck).toBe(true);
  expect(errors).toEqual([]);
});

test('both review screens load the one shared diff, and nothing else defines it', () => {
  // Two copies drifted once: one learned markers, the other kept tags. Derived
  // from the source, so a third copy, or a page that stops loading the shared
  // file, fails here.
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.join(__dirname, '..');

  const definers = fs.readdirSync(path.join(ROOT, 'js'))
    .filter(f => f.endsWith('.js'))
    .filter(f => /window\.diffTextLCS\s*=|window\.resolveDiffMarkers\s*=/
      .test(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8')));
  expect(definers).toEqual(['diff-markers.js']);

  for (const page of ['admin.html', 'edit.html']) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    expect(html, `${page} loads js/diff-markers.js`).toMatch(/<script src="js\/diff-markers\.js/);
  }
});
