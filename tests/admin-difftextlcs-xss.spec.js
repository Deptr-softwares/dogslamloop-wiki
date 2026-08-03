// Regression coverage for a real XSS gap in the reviewer diff view, found
// while building Phase 2 of the reviewer-workflow redesign but deliberately
// deferred until now (see project memory / plan file). diffTextLCS is used
// to diff contributor-submitted prose (paragraph/list/table/combo content)
// for the reviewer-facing diff view - it inserted old/new text straight
// into <del>/<ins> markup without escaping it first, the same class of bug
// the 2026-08-01 admin.js XSS review pass fixed everywhere else on this
// page. Any contributor could have crafted submitted text that ran script
// in a reviewer's authenticated session the moment a diff rendered it.
const { test, expect } = require('@playwright/test');

test('real bug fix: diffTextLCS escapes submitted content, no raw HTML injection', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate(() => {
    return {
      changedText: window.diffTextLCS('safe old text', '<img src=x onerror="alert(1)">'),
      pureAddition: window.diffTextLCS('', '<script>alert(2)</script>'),
      pureRemoval: window.diffTextLCS('<b>bold</b>', ''),
    };
  });

  expect(result.changedText).not.toContain('<img src=x');
  expect(result.changedText).toContain('&lt;img');
  expect(result.pureAddition).not.toContain('<script>alert(2)</script>');
  expect(result.pureAddition).toContain('&lt;script&gt;');
  expect(result.pureRemoval).not.toContain('<b>bold</b>');
  expect(result.pureRemoval).toContain('&lt;b&gt;');
});

test('diffTextLCS: word-level diff grouping still works correctly after escaping', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate(() => window.diffTextLCS('The quick brown fox', 'The quick red fox'));

  expect(result).toBe('The quick <del class="diff-del">brown</del><ins class="diff-add">red</ins> fox');
});

test('diffTextLCS: internalstyling.js shortcode syntax survives untouched (not itself HTML)', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate(() => window.diffTextLCS('plain text', '[color=red]Boomcat[/color] is great'));

  expect(result).toContain('[color=red]Boomcat[/color] is great');
});
