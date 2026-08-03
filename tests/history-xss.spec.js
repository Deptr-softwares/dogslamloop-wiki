// Regression coverage for a real XSS gap found while reviewing history.js's
// renderRevision for reuse in Phase 4 of the reviewer-workflow redesign
// (recent-changes.html). This is a PUBLIC, unauthenticated page rendering
// contributor-submitted author names/changelogs/target keys straight into
// innerHTML with no escaping - any contributor could have crafted a
// submission that ran script in any visitor's browser the moment its
// approved revision was viewed.
const { test, expect } = require('@playwright/test');

test('real bug fix: history.js renderRevision escapes author/changelog/target content', async ({ page }) => {
  await page.goto('/history.html?page=boomcat', { waitUntil: 'networkidle' });

  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });

  const html = await page.evaluate(async () => {
    window.historyRevisions = [{
      id: 'test-rev-xss',
      created_at: new Date().toISOString(),
      author_name: '<img src=x onerror=alert(1)>',
      qa_metadata: { reviewed_by: '<script>alert(2)</script>', changelog: 'Line one\n<b>bold injection</b>' },
      is_delta: true,
      target_scope: 'matchup',
      target_key: '<svg onload=alert(3)>',
      page_id: 'boomcat',
      desc_data: {},
      frame_data: {},
    }];
    window.currentHistoryIndex = 0;
    await window.renderRevision(0);
    return document.getElementById('history-meta-card').innerHTML;
  });

  expect(dialogs).toEqual([]);
  expect(html).not.toContain('<img src=x');
  expect(html).not.toContain('<script>alert(2)');
  expect(html).not.toContain('<svg onload');
  expect(html).toContain('&lt;img');
  expect(html).toContain('&lt;script&gt;');
  // The <br> from the changelog's own \n->br formatting is intentional and
  // should still render as a real line break, not get escaped away too.
  expect(html).toContain('<br>');
});
