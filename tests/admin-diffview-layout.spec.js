// Regression coverage for a real layout bug reported live by the owner
// (from an actual diff-view screenshot on admin.html): the revision-
// comparison title, the "Suggested Edit Location" label, and the diff
// content itself all rendered on the same row instead of stacking
// vertically. Root cause: the diff container's className copied a
// class pairing from js/description.js's unrelated system-page tab
// containers ('tab-content wiki-tab-content') - .wiki-tab-content
// carries a display:flex;flex-wrap:wrap rule (style/Layout.css) that
// was never wanted here.
const { test, expect } = require('@playwright/test');

test('real bug fix: diff view container stacks vertically (display:block), not wiki-tab-content flex-wrap', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div class="main-content-area"></div>';

    window.currentLiveDescData = { overview: [{ type: 'paragraph', content: 'The Unbeatable' }] };
    window.currentLiveFrameData = {};
    const rev = {
      id: 'test-rev', page_id: 'boomcat', is_delta: true,
      target_scope: 'overview', target_key: 'full',
      delta_payload: [{ type: 'paragraph', content: 'Boomcat is my spirit animal.' }],
    };
    window.currentQueueData = [rev];
    window.activePreviewRevId = 'test-rev';
    window.populateTextSection = (id, _title, blocks) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = blocks.map(b => `<p>${b.content}</p>`).join('');
    };

    await window.switchVersionView('diff');

    const container = document.getElementById('admin-diff-container');
    return {
      className: container.className,
      display: getComputedStyle(container).display,
      hasWikiTabContentClass: container.classList.contains('wiki-tab-content'),
    };
  });

  expect(result.hasWikiTabContentClass).toBe(false);
  expect(result.display).toBe('block');
});
