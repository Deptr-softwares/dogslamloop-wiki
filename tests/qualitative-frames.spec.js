// Qualitative frame data: recording how an endlag *feels* when nobody has
// counted it.
//
// The owner's design, and the thing every assertion here protects: an estimate
// renders as a solid block with no frame divisions. The divisions are this
// site's visual language for "measured", so their absence says "estimated"
// without needing a key - and it withholds the per-frame view, which would be
// a fabrication for an estimate.
//
// If "feels short" ever renders indistinguishably from "12f", the wiki quietly
// stops being trustworthy, and that is very hard to walk back once official.
const { test, expect } = require('@playwright/test');

function mockPageData(page, { desc = {}, frame = {} } = {}) {
  return page.addInitScript(({ desc, frame }) => {
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          const orig = lib.createClient.bind(lib);
          lib.createClient = (...args) => {
            const client = orig(...args);
            const origFrom = client.from.bind(client);
            client.from = (table) => {
              if (table !== 'page_data') return origFrom(table);
              const chain = {
                select() { return chain; }, eq() { return chain; },
                single: async () => ({ data: { desc_data: desc, frame_data: frame }, error: null }),
              };
              return chain;
            };
            client.auth.getSession = async () => ({ data: { session: null } });
            return client;
          };
          lib.__patched = true;
        }
      },
    });
  }, { desc, frame });
}

// One move, one bar: a counted startup followed by an estimated recovery.
// Side by side in the same bar is the case that matters - that is where a
// reader has to be able to tell them apart.
const MIXED = {
  m1s: [], specials: [],
  skills: [{
    id: 'mixed', name: 'Mixed Move', stats: [],
    variants: {
      standard: {
        label: 'Standard',
        totalScale: 40,
        bars: [{
          type: 'single', headerInfo: 'Standard',
          phases: [
            { duration: 14, styleClass: 'bg-tick-start', label: 'Startup' },
            { estimate: 'high', styleClass: 'bg-tick-recov', label: 'Recovery' },
          ],
        }],
      },
    },
  }],
};

test('the scale is the seven steps the owner named, in order', async ({ page }) => {
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'domcontentloaded' });

  const scale = await page.evaluate(() => window.FRAME_ESTIMATES.map(e => e.label));
  expect(scale).toEqual([
    'Non-existent', 'Very short', 'Short', 'Mid', 'High', 'Very high', 'RIP',
  ]);

  // Monotonic, or the bar would misrepresent the ordering the words imply.
  const weights = await page.evaluate(() => window.FRAME_ESTIMATES.map(e => e.frames));
  expect(weights).toEqual([...weights].sort((a, b) => a - b));
});

test('an estimated phase renders with no frame divisions; a counted one keeps them', async ({ page }) => {
  await mockPageData(page, { frame: MIXED, desc: { overview: [] } });
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  await page.locator('#nav-skills').click();

  const phases = page.locator('#tab-skills .phase-section');
  await expect(phases).toHaveCount(2);

  // The counted phase draws one tick per frame - that is the whole convention.
  await expect(phases.nth(0)).not.toHaveClass(/phase-estimated/);
  await expect(phases.nth(0).locator('.frame-tick')).toHaveCount(14);

  await expect(phases.nth(1)).toHaveClass(/phase-estimated/);
  await expect(phases.nth(1).locator('.frame-tick')).toHaveCount(0);
});

test('an estimate still takes believable space next to a counted phase', async ({ page }) => {
  // A zero-width estimate would be invisible; one sized at random would lie
  // about relative length. It is weighted, just not counted.
  await mockPageData(page, { frame: MIXED, desc: { overview: [] } });
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  await page.locator('#nav-skills').click();

  const widths = await page.locator('#tab-skills .phase-section').evaluateAll(
    els => els.map(el => Math.round(el.getBoundingClientRect().width))
  );

  // 14 counted frames against a 28-frame nominal weight, on a scale of 40.
  expect(widths[0]).toBeGreaterThan(0);
  expect(widths[1]).toBeGreaterThan(widths[0]);
});

test('a Non-existent estimate still leaves a mark', async ({ page }) => {
  // "This move has no block endlag" is a real thing to record, and a nominal
  // zero would render as nothing at all.
  await mockPageData(page, {
    frame: {
      m1s: [], specials: [],
      skills: [{
        id: 'none-move', name: 'None', stats: [],
        variants: { standard: { label: 'Standard', totalScale: 40, bars: [{ type: 'single', phases: [
          { duration: 20, styleClass: 'bg-tick-start', label: 'Startup' },
          { estimate: 'none', styleClass: 'bg-tick-blockendlag', label: 'Block Endlag' },
        ] }] } },
      }],
    },
    desc: { overview: [] },
  });

  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  await page.locator('#nav-skills').click();

  const width = await page.locator('#tab-skills .phase-section').nth(1)
    .evaluate(el => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(0);
});

test('the legend states the convention, because nothing else can teach it', async ({ page }) => {
  await mockPageData(page, { frame: MIXED, desc: { overview: [] } });
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  await page.locator('#nav-skills').click();

  const note = page.locator('#tab-skills .legend-estimate-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('counted');
  await expect(note).toContainText('estimate');
});

test('a move with no estimates renders exactly as it did before', async ({ page }) => {
  // The regression guard: every existing move is counted, and none of them
  // should gain a class, lose a tick, or change width.
  await mockPageData(page, {
    frame: {
      m1s: [], specials: [],
      skills: [{
        id: 'counted', name: 'Counted', stats: [],
        variants: { standard: { label: 'Standard', totalScale: 30, bars: [{ type: 'single', phases: [
          { duration: 10, styleClass: 'bg-tick-start', label: 'Startup' },
          { duration: 5, styleClass: 'bg-tick-active', label: 'Active' },
          { duration: 15, styleClass: 'bg-tick-recov', label: 'Recovery' },
        ] }] } },
      }],
    },
    desc: { overview: [] },
  });

  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  await page.locator('#nav-skills').click();

  await expect(page.locator('#tab-skills .phase-estimated')).toHaveCount(0);
  await expect(page.locator('#tab-skills .frame-tick')).toHaveCount(30);
});

// --- THE EDITOR ---

// .editor-select controls are replaced at runtime by a custom dropdown
// (initializeMangaSelects in site_utils.js) which hides the native element, so
// selectOption cannot reach them. This drives what a contributor actually
// clicks: the trigger, then the option.
async function pickManga(page, selectId, optionText) {
  const wrapper = page.locator(`#${selectId} + .manga-select-wrapper`);
  await wrapper.locator('.manga-select-trigger').click();
  await wrapper.locator('.manga-option', { hasText: optionText }).first().click();
}

async function openMoveEditor(page, frameData) {
  await page.goto('/edit.html?char=testchar&tab=skills', { waitUntil: 'networkidle' });
  await page.evaluate((frame) => {
    window.currentEditorPageType = 'character';
    window.currentEditorCharId = 'testchar';
    window.currentEditorDescData = { moveStrategies: {} };
    window.currentEditorFrameData = frame;
    initFullTabEditor('testchar', 'skills', window.currentEditorDescData, window.currentEditorFrameData);
  }, frameData);
}

test('a contributor can switch a phase from counted to estimated', async ({ page }) => {
  await openMoveEditor(page, JSON.parse(JSON.stringify(MIXED)));

  // Select the counted startup phase.
  await page.evaluate(() => window.selectDawPhase(0, 0));

  await expect(page.locator('#insp-measure-mode')).toHaveValue('counted');
  await expect(page.locator('#insp-duration')).toBeVisible();

  await pickManga(page, 'insp-measure-mode', 'Estimated');
  await page.evaluate(() => window.selectDawPhase(0, 0));

  const phase = await page.evaluate(() =>
    window.currentEditorFrameData.skills[0].variants.standard.bars[0].phases[0]);

  // 14 frames is nearest to Mid (16), not to whatever happens to be first in
  // the list - so the bar keeps roughly its shape across the switch.
  expect(phase.estimate).toBe('mid');
  expect(phase.duration, 'a leftover count would be data nothing displays').toBeUndefined();
});

test('switching back to counted restores a number to correct, not a blank', async ({ page }) => {
  await openMoveEditor(page, JSON.parse(JSON.stringify(MIXED)));

  // The estimated recovery phase.
  await page.evaluate(() => window.selectDawPhase(0, 1));
  await expect(page.locator('#insp-measure-mode')).toHaveValue('estimated');
  await expect(page.locator('#insp-estimate')).toHaveValue('high');

  await pickManga(page, 'insp-measure-mode', 'Counted');

  const phase = await page.evaluate(() =>
    window.currentEditorFrameData.skills[0].variants.standard.bars[0].phases[1]);

  expect(phase.duration).toBe(28);
  expect(phase.estimate).toBeUndefined();
});

test('the editor track shows which phases nobody has counted', async ({ page }) => {
  await openMoveEditor(page, JSON.parse(JSON.stringify(MIXED)));

  const blocks = page.locator('.daw-phase-block');
  await expect(blocks).toHaveCount(2);
  await expect(blocks.nth(0)).toHaveText('14f');
  await expect(blocks.nth(1)).toHaveText('~High');
  await expect(blocks.nth(1)).toHaveClass(/daw-phase-estimated/);
});

test('the editor offers exactly the seven the renderer knows', async ({ page }) => {
  // An eighth option would store an id frameEstimate() returns null for, and
  // the phase would silently render as a zero-width counted block.
  await openMoveEditor(page, JSON.parse(JSON.stringify(MIXED)));
  await page.evaluate(() => window.selectDawPhase(0, 1));

  const offered = await page.locator('#insp-estimate option').evaluateAll(els => els.map(el => el.value));
  const known = await page.evaluate(() => window.FRAME_ESTIMATES.map(e => e.id));
  expect(offered).toEqual(known);
});
