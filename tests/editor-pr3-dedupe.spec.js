// Coverage for Workstream B, editor.js PR 3/6: the DAW Frame Editor engine
// (initDawEditor) - the frame-data timeline builder used for every move's
// stats/frame-data editing.
const { test, expect } = require('@playwright/test');

const SAMPLE_MOVE = {
  id: 'test_move', name: 'Test Move', input: 'M1', type: 'Attack', damageType: 'Melee',
  media: { src: '', alt: '' },
  stats: [{ label: 'Damage', value: '5', isHighlighted: false }],
  variants: {},
  totalScale: 100,
  bars: [{
    type: 'single', headerInfo: 'Track 1', headerClass: 'text-red-400',
    phases: [
      { duration: 10, styleClass: 'bg-tick-start', label: 'Startup' },
      { duration: 5, styleClass: 'bg-tick-active', label: 'Active' },
    ],
  }],
};

test.beforeEach(async ({ page }) => {
  await page.goto('/edit.html?page=boomcat&type=character&tab=overview', { waitUntil: 'networkidle' });
  await page.evaluate((move) => {
    const container = document.createElement('div');
    container.id = 'daw-test-container';
    document.body.appendChild(container);
    window.initDawEditor('daw-test-container', move);
  }, SAMPLE_MOVE);
});

test('real bug fix: changing the track color select keeps .daw-track-color-select (styling class), not just the semantic color marker', async ({ page }) => {
  const select = page.locator('#daw-test-container .daw-track-color');
  await expect(select).toHaveCount(1);
  expect(await select.evaluate(el => el.className)).toContain('daw-track-color-select');

  // Simulate changing the color - the 'change' handler rebuilds className from scratch.
  // Some other script visually replaces .editor-select with a custom dropdown
  // (note the "manga-initialized" class), so drive the native <select> directly
  // instead of Playwright's selectOption(), which requires it to be visible.
  await select.evaluate(el => {
    el.value = 'text-blue-400';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const classAfter = await select.evaluate(el => el.className);
  expect(classAfter).toContain('daw-track-color-select'); // must survive the className rebuild
  expect(classAfter).toContain('text-blue-400');
});

test('real bug fix: changing the track color no longer drops .manga-initialized, so a later DOM-mutation rescan does not double-wrap the select', async ({ page }) => {
  await page.evaluate(() => window.initializeMangaSelects());
  const select = page.locator('#daw-test-container .daw-track-color');
  // Scoped to this select's own wrapper. The container holds the whole DAW
  // editor, which as of v0.12 has a second .editor-select in the move
  // metadata card (media box shape) - so counting every wrapper in the
  // container stopped being a statement about double-wrapping.
  const wrapper = page.locator('#daw-test-container .daw-track-color + .manga-select-wrapper');
  await expect(wrapper).toHaveCount(1);

  await select.evaluate(el => {
    el.value = 'text-blue-400';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Simulate the site-wide MutationObserver (site_utils.js) re-running
  // initializeMangaSelects() after some later, unrelated DOM mutation.
  await page.evaluate(() => window.initializeMangaSelects());

  await expect(wrapper).toHaveCount(1); // not duplicated
  expect(await select.evaluate(el => el.classList.contains('manga-initialized'))).toBe(true);
  expect(await select.evaluate(el => el.classList.contains('text-red-400'))).toBe(false); // old marker cleared
});

test('real bug fix: the manga-select custom dropdown colors its option rows from the .daw-option-* CSS classes, not a (removed) inline style', async ({ page }) => {
  await page.evaluate(() => window.initializeMangaSelects());
  // The track-colour select specifically - .first() used to be it, but the move
  // metadata card now contributes a wrapper of its own that has no colour
  // options in it at all.
  const wrapper = page.locator('#daw-test-container .daw-track-color + .manga-select-wrapper');
  const redOptionColor = await wrapper.locator('.manga-option', { hasText: 'Red (L)' }).evaluate(el => el.style.color);

  // Compare against a synthetic option nested in a real .editor-select: bare
  // .daw-option-red-400 alone loses outright to .editor-select option's own
  // color at higher specificity, so the class only wins as a compound
  // selector (.editor-select option.daw-option-red-400) - must match that.
  const expectedColor = await page.evaluate(() => {
    const sel = document.createElement('select');
    sel.className = 'editor-select';
    const opt = document.createElement('option');
    opt.className = 'daw-option-red-400';
    sel.appendChild(opt);
    document.body.appendChild(sel);
    const c = getComputedStyle(opt).color;
    sel.remove();
    return c;
  });

  expect(redOptionColor).not.toBe('');
  expect(redOptionColor).not.toBe('rgb(209, 213, 219)'); // must not be .editor-select option's generic #d1d5db default
  expect(redOptionColor).toBe(expectedColor);
});

test('.daw-track-color-select CSS rule itself sets width/font-weight (verified in isolation - some other script visually replaces the live <select>, confounding a direct computed-style check on it)', async ({ page }) => {
  const cs = await page.evaluate(() => {
    const el = document.createElement('select');
    el.className = 'editor-select daw-track-color daw-track-color-select';
    document.body.appendChild(el);
    const result = { width: getComputedStyle(el).width, fontWeight: getComputedStyle(el).fontWeight };
    el.remove();
    return result;
  });
  expect(cs.width).toBe('125px');
  expect(cs.fontWeight).toBe('700');
});

test('move metadata card and stats card render with no inline styles, add-stat button has the compound-selector padding', async ({ page }) => {
  const metaCard = page.locator('#daw-test-container .block-editor-container').first();
  expect(await metaCard.evaluate(el => el.hasAttribute('style'))).toBe(false);

  const addStatBtn = page.locator('#btn-add-movestat');
  expect(await addStatBtn.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await addStatBtn.evaluate(el => getComputedStyle(el).padding)).toBe('2.4px 6.4px'); // 0.15rem 0.4rem, wins over .add-block-btn's 0.35rem 0.6rem default
});

test('phase blocks keep their genuinely dynamic width/background-color inline, everything else is classed', async ({ page }) => {
  const phases = page.locator('.daw-phase-block');
  await expect(phases).toHaveCount(2);
  const first = phases.first();
  const style = await first.getAttribute('style');
  expect(style).toContain('width:');
  expect(style).toContain('background-color:');
  const duration = first.locator('.daw-phase-block-duration');
  expect(await duration.evaluate(el => el.hasAttribute('style'))).toBe(false);
});

test('selecting a phase opens the inspector with no inline styles and correct field values', async ({ page }) => {
  await page.locator('.daw-phase-block').first().click();
  const inspector = page.locator('.daw-inspector');
  await expect(inspector).toBeVisible();
  expect(await inspector.evaluate(el => el.className)).toBe('daw-inspector daw-inspector-spaced');
  await expect(page.locator('#insp-duration')).toHaveValue('10');
  await expect(page.locator('#insp-class')).toHaveValue('bg-tick-start');

  const overlayLabels = inspector.locator('.daw-overlay-label');
  expect(await overlayLabels.count()).toBe(6);
  expect(await overlayLabels.first().evaluate(el => el.hasAttribute('style'))).toBe(false);
});

test('real bug fix: .daw-branch-empty-notice wins its padding specificity tie against .daw-container base rule', async ({ page }) => {
  const cs = await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'daw-container daw-branch-empty-notice';
    document.body.appendChild(el);
    const result = { padding: getComputedStyle(el).padding, textAlign: getComputedStyle(el).textAlign };
    el.remove();
    return result;
  });
  expect(cs.padding).toBe('48px 16px'); // 3rem 1rem, not .daw-container's own 1rem
  expect(cs.textAlign).toBe('center');
});

test('empty-move notice and empty-variant branch UI render with the expected classes', async ({ page }) => {
  await page.evaluate(() => {
    const container = document.createElement('div');
    container.id = 'daw-empty-test';
    document.body.appendChild(container);
    window.initDawEditor('daw-empty-test', null);
  });
  const notice = page.locator('#daw-empty-test .daw-empty-notice');
  await expect(notice).toBeVisible();
  expect(await notice.evaluate(el => el.hasAttribute('style'))).toBe(false);
});
