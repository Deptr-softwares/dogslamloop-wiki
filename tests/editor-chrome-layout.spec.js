// v0.16 fine-tuning 4 and 7: where the editor's chrome sits.
//
//  4. "Collapsed Workspace Header (the part that contains the function buttons:
//     Cancel, Sync/Save, ...) should also show the Hub button beside the Submit
//     button."
//  7. "Move Media Library position to the Workspace Footer (where Add Block is)
//     instead. Reposition the quick styling buttons to have two rows and have
//     Media Library sits next to Add Block."
//
// Plus one thing found while doing them: the mobile-only SHOW PREVIEW button
// had been visible on desktop for as long as editor.css has had its own
// `.btn-sys { display: inline-flex }` rule, which sits after the hide rule at
// equal specificity and won on source order. Fine-tuning 4 only made it
// obvious, by putting it in the collapsed header next to HUB.
const { test, expect } = require('@playwright/test');

const EDITOR = '/edit.html?char=boomcat&type=character&tab=overview';

async function openEditor(page, width = 1400) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width, height: 950 });
  await page.goto(EDITOR, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  return errors;
}

// --- FINE-TUNING 4: HUB SURVIVES THE COLLAPSE ---

test('collapsing the header keeps HUB, beside Submit', async ({ page }) => {
  const errors = await openEditor(page);

  await page.locator('#btn-collapse-chrome').click();
  await page.waitForTimeout(300);

  const seen = await page.evaluate(() => {
    const header = document.getElementById('editor-header');
    const hub = document.querySelector('.editor-hub-link');
    const submit = document.getElementById('submit-payload-btn');
    const hr = hub.getBoundingClientRect();
    const sr = submit.getBoundingClientRect();
    return {
      collapsed: header.classList.contains('is-collapsed'),
      hubVisible: hr.width > 0 && getComputedStyle(hub).display !== 'none',
      submitVisible: sr.width > 0,
      // "Beside": on the same line, and nothing but a gap between them.
      sameRow: Math.abs((hr.top + hr.height / 2) - (sr.top + sr.height / 2)) < 12,
      gap: Math.round(sr.left - hr.right),
    };
  });

  expect(seen.collapsed, 'setup: the header really collapsed').toBe(true);
  expect(seen.submitVisible, 'Submit still survives the collapse').toBe(true);
  expect(seen.hubVisible, 'and so does HUB now').toBe(true);
  expect(seen.sameRow, 'they sit on the same line').toBe(true);
  expect(seen.gap, `HUB is beside Submit, not across the header (gap ${seen.gap}px)`)
    .toBeLessThan(60);
  expect(seen.gap, 'and not overlapping it').toBeGreaterThanOrEqual(0);

  expect(errors).toEqual([]);
});

test('collapsing still folds away everything it always did', async ({ page }) => {
  // The control. "Keep HUB" must not have become "keep the whole header",
  // which would undo the item this one is built on top of.
  await openEditor(page);
  await page.locator('#btn-collapse-chrome').click();
  await page.waitForTimeout(300);

  const shown = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.header-actions > .btn-sys'))
      .filter(b => b.getBoundingClientRect().width > 0)
      .map(b => b.textContent.trim()));

  expect(shown, 'Submit is the only action button left').toEqual(['Submit']);

  const subtitle = await page.evaluate(() =>
    getComputedStyle(document.getElementById('editor-subtitle')).display);
  expect(subtitle, 'the subtitle still folds away').toBe('none');
});

// --- THE DEAD RULE FINE-TUNING 4 EXPOSED ---

test('SHOW PREVIEW is off on desktop and on below the mobile breakpoint', async ({ page }) => {
  // It is the only route to the preview on a phone, so it has to survive; and
  // it is meaningless on desktop, where it had been showing anyway. Both sides
  // of the 900px breakpoint, because a fix that hid it everywhere would pass
  // any test that only looked at the desktop half.
  await openEditor(page, 1400);
  expect(await page.evaluate(() =>
    getComputedStyle(document.getElementById('mobile-preview-toggle')).display),
  'hidden on desktop').toBe('none');

  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(300);

  const onPhone = await page.evaluate(() => {
    const el = document.getElementById('mobile-preview-toggle');
    return {
      display: getComputedStyle(el).display,
      width: Math.round(el.getBoundingClientRect().width),
    };
  });
  expect(onPhone.display, 'and back on a phone').not.toBe('none');
  expect(onPhone.width, 'with a real size, not a zero-width ghost').toBeGreaterThan(0);
});

// --- FINE-TUNING 7: THE FOOTER ---

test('Media Library sits in the footer next to Add Block', async ({ page }) => {
  const errors = await openEditor(page);

  const seen = await page.evaluate(() => {
    const media = document.getElementById('btn-media-library');
    const add = document.getElementById('btn-toggle-add-menu');
    const mr = media.getBoundingClientRect();
    const ar = add.getBoundingClientRect();
    return {
      inFooter: !!media.closest('.add-block-toolbar'),
      // Not merely "in the same container" - actually adjacent.
      gap: Math.round(ar.left - mr.right),
      sameRow: Math.abs((mr.top + mr.height / 2) - (ar.top + ar.height / 2)) < 12,
      // And gone from the row it used to live in.
      stillInTopRow: !!document.querySelector('.strategy-toolbar-row #btn-media-library'),
    };
  });

  expect(seen.inFooter, 'it moved into the footer toolbar').toBe(true);
  expect(seen.stillInTopRow, 'and left the top row').toBe(false);
  expect(seen.sameRow, 'it is on the same line as Add Block').toBe(true);
  expect(seen.gap, `next to Add Block, not merely near it (gap ${seen.gap}px)`).toBeLessThan(40);
  expect(seen.gap).toBeGreaterThanOrEqual(0);

  expect(errors).toEqual([]);
});

test('Media Library still opens the media manager from its new home', async ({ page }) => {
  // Moving a button in the markup is exactly how a binding gets orphaned:
  // initStrategyBlockBuilder wires this one with container.querySelector.
  await openEditor(page);

  // Closed FIRST. Without this the test passes on a modal that was never
  // hidden, which proves the markup exists and nothing about the button - the
  // exact shape of vacuous pass this project keeps producing.
  const before = await page.evaluate(() =>
    document.getElementById('media-modal-overlay').classList.contains('hidden'));
  expect(before, 'setup: the media manager starts closed').toBe(true);

  await page.locator('#btn-media-library').click();
  await page.waitForTimeout(600);

  const after = await page.evaluate(() =>
    document.getElementById('media-modal-overlay').classList.contains('hidden'));
  expect(after, 'clicking it in its new home still opens the media manager').toBe(false);
});

test('the quick styling buttons occupy exactly two rows', async ({ page }) => {
  await openEditor(page);

  const rows = await page.evaluate(() => {
    const tops = Array.from(document.querySelector('.format-toolbar').children)
      .map(c => Math.round(c.getBoundingClientRect().top));
    return [...new Set(tops)].length;
  });

  expect(rows, 'two rows, as asked').toBe(2);
});

test('two rows at narrow widths too, not two-then-three', async ({ page }) => {
  // The reason this is a grid rather than flex-wrap: wrapping gives two rows at
  // one pane width and three at another, and "two rows" was the request.
  for (const width of [1600, 1280, 1024]) {
    await openEditor(page, width);
    const rows = await page.evaluate(() => {
      const tops = Array.from(document.querySelector('.format-toolbar').children)
        .map(c => Math.round(c.getBoundingClientRect().top));
      return [...new Set(tops)].length;
    });
    expect(rows, `still two rows at ${width}px`).toBe(2);
  }
});

// --- THE OTHER CONSUMER ---

test('the Profile toolbar keeps its own Media Library', async ({ page }) => {
  // .strategy-toolbar-row is shared with structuredFormToolbar in
  // js/editor-tabs.js, which has no Add Block footer to move anything into.
  // This project's standing rule is that a change to a shared class is checked
  // against every consumer, so the check is a test rather than a memory.
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto('/edit.html?char=testchar&tab=overview', { waitUntil: 'networkidle' });

  await page.evaluate(() => {
    window.currentEditorPageType = 'character';
    window.currentEditorCharId = 'testchar';
    window.currentOverviewSection = null;
    window.currentEditorDescData = {
      overview: [], strategy: [], extras: [], matchups: [], counterplay: [], moveStrategies: {},
      profile: { image: '', stats: [{ label: 'Archetype', value: 'Rushdown' }] },
      playstyle: { likes: [], dislikes: [] },
    };
    window.currentEditorFrameData = { m1s: [], skills: [], specials: [] };
    initFullTabEditor('testchar', 'overview', window.currentEditorDescData, window.currentEditorFrameData);
    window.loadOverviewSectionIntoEditor('profile');
  });
  await page.waitForTimeout(600);

  const formMedia = page.locator('[data-form-media]');
  await expect(formMedia, 'the structured form kept its own button').toHaveCount(1);
  await expect(formMedia).toBeVisible();

  // And it is still on the row it always was - it has no footer to move to.
  const inRow = await page.evaluate(() =>
    !!document.querySelector('.strategy-toolbar-row [data-form-media]'));
  expect(inRow, 'still in the toolbar row').toBe(true);
});
