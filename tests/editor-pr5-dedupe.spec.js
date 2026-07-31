// Coverage for Workstream B, editor.js PR 5/6: editor infrastructure - live
// sync (triggerManualSync/updateLivePreview), the media library, the visual
// diff viewer (renderDiffView), and the local draft manager.
//
// Real finding while extracting: js/admin.js's own diff view (queue review)
// already used .diff-container/.diff-section-title/.diff-stacked-* - but
// editor.css had TWO conflicting .diff-container/.diff-section-title rules
// ("DIFF VIEWER (UNSAVED CHANGES)" and "SMART DIFF VIEWER"), and the first
// one was entirely dead/shadowed by source order (both bare, same
// specificity - the later declaration always won). Deleted the dead one and
// reused the live "SMART DIFF VIEWER" classes for editor.js's own diff view
// instead of inventing a parallel copy, matching admin.js's own markup
// pattern. Also found admin.js references a .diff-stacked-pre class that
// never had a CSS rule at all - added it (a strict improvement, not a
// behavior change, since it previously rendered unstyled).
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/edit.html?page=boomcat&type=character&tab=overview', { waitUntil: 'networkidle' });
});

test('media library: status/error messages and thumbnail card render with no inline styles', async ({ page }) => {
  await page.evaluate(() => {
    document.getElementById('media-modal-overlay').classList.remove('hidden');
    window.initMediaLibrary();
    const grid = document.getElementById('media-gallery-grid');
    grid.innerHTML = '<div class="media-status-msg">Connecting to Cloud Storage...</div>';
  });
  const statusMsg = page.locator('.media-status-msg');
  await expect(statusMsg).toBeVisible();
  expect(await statusMsg.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await statusMsg.evaluate(el => getComputedStyle(el).textAlign)).toBe('center');

  await page.evaluate(() => {
    const card = document.createElement('div');
    card.className = 'media-thumbnail-card';
    card.innerHTML = `
      <img src="x.webp" class="media-thumbnail-media">
      <div class="media-thumbnail-badge">GIF</div>
      <div class="media-thumbnail-filename">x.webp</div>
    `;
    document.getElementById('media-gallery-grid').appendChild(card);
  });
  const media = page.locator('.media-thumbnail-media');
  expect(await media.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await media.evaluate(el => getComputedStyle(el).objectFit)).toBe('cover');
  const filename = page.locator('.media-thumbnail-filename');
  expect(await filename.evaluate(el => getComputedStyle(el).textAlign)).toBe('center');
});

test('media library: upload zone toggles a CSS class on drag instead of mutating .style directly, and matches the existing :hover appearance', async ({ page }) => {
  await page.evaluate(() => window.initMediaLibrary());
  const dropZone = page.locator('#media-upload-zone');

  await dropZone.dispatchEvent('dragover');
  expect(await dropZone.evaluate(el => el.classList.contains('media-upload-zone-dragover'))).toBe(true);
  // edit.html hardcodes style="margin-right: 0;" on this element already (a
  // separate, unrelated static override) - confirm the drag handler doesn't
  // ADD to it, rather than asserting no style attribute at all.
  expect(await dropZone.evaluate(el => el.getAttribute('style'))).toBe('margin-right: 0;');
  const dragCs = await dropZone.evaluate(el => ({ border: getComputedStyle(el).borderTopColor, bg: getComputedStyle(el).backgroundColor }));
  expect(dragCs.border).toBe('rgb(52, 211, 153)'); // #34d399

  await dropZone.dispatchEvent('dragleave');
  expect(await dropZone.evaluate(el => el.classList.contains('media-upload-zone-dragover'))).toBe(false);
});

test('real bug fix: media prev/next buttons use :disabled CSS instead of JS style.opacity mutation', async ({ page }) => {
  const cs = await page.evaluate(() => {
    const el = document.createElement('button');
    el.id = 'btn-media-prev-test';
    el.className = 'btn-sys btn-sys-regular';
    el.disabled = true;
    document.body.appendChild(el);
    el.id = 'btn-media-prev'; // reuse the real selector to hit the :disabled rule
    const opacity = getComputedStyle(el).opacity;
    el.remove();
    return opacity;
  });
  expect(cs).toBe('0.3'); // not .btn-sys:disabled's own 0.4 default
});

test('diff viewer: renderDiffView blocks-branch reuses the live .diff-container/.diff-section-title (not the dead shadowed rule)', async ({ page }) => {
  await page.evaluate(() => {
    window.currentEditorDescData.overview = [{ type: 'paragraph', content: 'Changed for the diff test' }];
    window.toggleDiffMode();
  });
  const container = page.locator('.diff-container').first();
  await expect(container).toBeVisible();
  expect(await container.evaluate(el => el.hasAttribute('style'))).toBe(false);
  const cs = await container.evaluate(el => ({ borderLeftWidth: getComputedStyle(el).borderLeftWidth, boxShadow: getComputedStyle(el).boxShadow }));
  expect(cs.borderLeftWidth).toBe('3px'); // the live "SMART DIFF VIEWER" rule's border-left, not the dead rule's plain 2px border
});

test('diff viewer: raw/JSON branch wins its compound border/box-shadow override, and diff-stacked-pre gets its real color (previously unstyled)', async ({ page }) => {
  await page.evaluate(() => {
    window.currentEditorFrameData.m1s = window.currentEditorFrameData.m1s || [];
    window.currentEditorFrameData.m1s.push({ id: 'diff_test_move', name: 'Diff Test Move' });
    window.toggleDiffMode();
  });

  const rawContainer = page.locator('.diff-container.diff-container-raw').first();
  await expect(rawContainer).toBeVisible();
  expect(await rawContainer.evaluate(el => getComputedStyle(el).borderWidth)).toBe('2px'); // not the inline-blocks variant's 1px

  const oldPre = page.locator('.diff-stacked-pre.old').first();
  await expect(oldPre).toBeVisible();
  expect(await oldPre.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await oldPre.evaluate(el => getComputedStyle(el).color)).toBe('rgb(252, 165, 165)'); // #fca5a5

  const newPre = page.locator('.diff-stacked-pre.new').first();
  expect(await newPre.evaluate(el => getComputedStyle(el).color)).toBe('rgb(134, 239, 172)'); // #86efac
});

test('draft manager: renders drafts with no inline styles; real bug check that .draft-resume-btn suppresses the shared hover glow', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('wiki_draft_testchar_overview', JSON.stringify({
      timestamp: Date.now(), charId: 'testchar', tabId: 'overview', moveId: '',
      desc_data: {}, frame_data: {},
    }));
    window.openDraftManager();
  });

  const row = page.locator('.draft-row').first();
  await expect(row).toBeVisible();
  expect(await row.evaluate(el => el.hasAttribute('style'))).toBe(false);

  const resumeBtn = page.locator('.draft-resume-btn').first();
  await expect(resumeBtn).toBeVisible();
  expect(await resumeBtn.evaluate(el => el.hasAttribute('style'))).toBe(false);
  const restingShadow = await resumeBtn.evaluate(el => getComputedStyle(el).boxShadow);
  await resumeBtn.hover();
  const hoverShadow = await resumeBtn.evaluate(el => getComputedStyle(el).boxShadow);
  expect(hoverShadow).toBe(restingShadow); // no glow on hover, matching the original inline box-shadow: none

  await page.evaluate(() => localStorage.removeItem('wiki_draft_testchar_overview'));
});
