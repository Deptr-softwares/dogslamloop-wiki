// Regression coverage for a real XSS gap in the reviewer diff view, found
// while building Phase 2 of the reviewer-workflow redesign but deliberately
// deferred until then. diffTextLCS is used to diff contributor-submitted prose
// (paragraph/list/table/combo content) for the reviewer-facing diff view - it
// inserted old/new text straight into <del>/<ins> markup without escaping it
// first, the same class of bug the 2026-08-01 admin.js XSS review pass fixed
// everywhere else on this page. Any contributor could have crafted submitted
// text that ran script in a reviewer's authenticated session the moment a diff
// rendered it.
//
// WHERE THE GUARANTEE LIVES MOVED IN v0.15 ITEM 6, AND THESE TESTS MOVED WITH
// IT. diffTextLCS used to escape the text and return finished <ins>/<del>
// markup. That worked until the block renderer began escaping at every
// interpolation (item 1, closing a stored-XSS hole) - which escaped this
// function's own tags a second time, so every prose diff rendered as visible
// `<ins class="diff-add">` instead of as a diff.
//
// So diffTextLCS now returns the text RAW with control-character markers around
// the changed runs, the renderer escapes it exactly once like any other content,
// and resolveDiffMarkers turns the markers into tags afterwards.
//
// That means asserting on diffTextLCS's return value alone no longer proves
// anything about safety - its output is SUPPOSED to contain raw text now. These
// tests therefore drive the whole pipeline (escape, then resolve) and assert
// what the reviewer's browser actually ends up with, which is the only thing
// that was ever really at stake.
const { test, expect } = require('@playwright/test');

// escape-then-resolve, exactly as the block renderer and admin-preview do it.
async function throughPipeline(page, oldStr, newStr) {
  return page.evaluate(([o, n]) => {
    const host = document.createElement('div');
    // textContent is the escaping step: it is what the renderer's escapeHtml
    // achieves, without depending on the renderer being loaded here.
    host.textContent = window.diffTextLCS(o, n);
    window.resolveDiffMarkers(host);
    return { html: host.innerHTML, text: host.innerText, scripts: host.querySelectorAll('script').length, imgs: host.querySelectorAll('img').length };
  }, [oldStr, newStr]);
}

test('real bug fix: submitted content cannot become markup in the reviewer diff', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const changed = await throughPipeline(page, 'safe old text', '<img src=x onerror="alert(1)">');
  const added = await throughPipeline(page, '', '<script>alert(2)</script>');
  const removed = await throughPipeline(page, '<b>bold</b>', '');

  // No element is ever created from submitted text - the claim that matters.
  expect(changed.imgs).toBe(0);
  expect(added.scripts).toBe(0);
  expect(changed.html).toContain('&lt;img');
  expect(added.html).toContain('&lt;script&gt;');
  expect(removed.html).toContain('&lt;b&gt;');
  expect(removed.imgs + removed.scripts).toBe(0);

  // And the only markup present is the diff's own.
  const tags = [...changed.html.matchAll(/<(\/?[a-z]+)/gi)].map(m => m[1].toLowerCase());
  expect(new Set(tags), 'only ins/del may be created').toEqual(new Set(['ins', '/ins', 'del', '/del']));
});

test('the markers themselves cannot be smuggled in by a contributor', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const forged = await page.evaluate(() => {
    const m = window.DIFF_MARKERS;
    const payload = m.delOpen + 'x' + m.delClose + m.addOpen + 'y' + m.addClose;
    const host = document.createElement('div');
    host.textContent = window.diffTextLCS('', payload + ' tail');
    window.resolveDiffMarkers(host);
    // One ins, from the wholly-added case. Not three, from the forged pair.
    return { ins: host.querySelectorAll('ins').length, del: host.querySelectorAll('del').length, text: host.innerText };
  });

  expect(forged.ins).toBe(1);
  expect(forged.del, 'a submitted marker must not open a tag').toBe(0);
  expect(forged.text).toContain('tail');
});

test('word-level diff grouping still works', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const out = await throughPipeline(page, 'The quick brown fox', 'The quick red fox');

  expect(out.html).toBe('The quick <del class="diff-del">brown</del><ins class="diff-add">red</ins> fox');
});

test('internalstyling.js shortcode syntax survives untouched (not itself HTML)', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const out = await throughPipeline(page, 'plain text', '[color=red]Boomcat[/color] is great');

  expect(out.text).toContain('[color=red]Boomcat[/color] is great');
});
