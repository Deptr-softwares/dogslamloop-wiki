// Coverage for Workstream B Tier 2: frame-data color de-duplication.
// ColorCoding.css's :root custom properties are now the single source for
// the 9 frame-timing colors + 6 window/i-frame colors, consumed by
// .bg-tick-*/.span-* rules, the legend swatches (js/framedata.js), and the
// runtime dictionaries window.FRAME_COLORS/WINDOW_COLORS (js/site_meta.js,
// read via getComputedStyle). These tests prove the legend and the actual
// frame-tick/window-overlay elements resolve to the same color instead of
// four independently-hardcoded copies drifting apart.
const { test, expect } = require('@playwright/test');

test('legend swatch and an actual frame-tick resolve to the same background-color (bg-tick-start)', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  const [swatchColor, tickColor] = await page.evaluate(() => {
    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch bg-tick-start';
    document.body.appendChild(swatch);

    const phase = document.createElement('div');
    phase.className = 'bg-tick-start';
    const tick = document.createElement('div');
    tick.className = 'frame-tick';
    phase.appendChild(tick);
    document.body.appendChild(phase);

    const result = [getComputedStyle(swatch).backgroundColor, getComputedStyle(tick).backgroundColor];
    swatch.remove();
    phase.remove();
    return result;
  });
  expect(swatchColor).not.toBe('');
  expect(swatchColor).toBe(tickColor);
});

test('legend swatch and an actual window-overlay resolve to the same border-color (span-rhc)', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  const [swatchBorder, overlayBorder] = await page.evaluate(() => {
    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch span-rhc';
    document.body.appendChild(swatch);

    const overlay = document.createElement('div');
    overlay.className = 'window-overlay span-rhc';
    document.body.appendChild(overlay);

    const result = [getComputedStyle(swatch).borderColor, getComputedStyle(overlay).borderColor];
    swatch.remove();
    overlay.remove();
    return result;
  });
  expect(swatchBorder).not.toBe('');
  expect(swatchBorder).toBe(overlayBorder);
});

test('window.FRAME_COLORS/WINDOW_COLORS resolve to real colors, not undefined, on a character page', async ({ page }) => {
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  const colors = await page.evaluate(() => ({ frame: window.FRAME_COLORS, window: window.WINDOW_COLORS }));
  expect(colors.frame['bg-tick-start']).toMatch(/^hsl\(/);
  expect(colors.window['iframe-complete']).toMatch(/^hsl\(/);
});

test('Boomcat M1 tab renders the frame data legend with populated swatches', async ({ page }) => {
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  await page.locator('#nav-m1s').click();
  const legend = page.locator('#tab-m1s .legend-grid');
  await expect(legend).toBeVisible();
  const firstSwatchBg = await legend.locator('.legend-swatch').first().evaluate(el => getComputedStyle(el).backgroundColor);
  expect(firstSwatchBg).not.toBe('rgba(0, 0, 0, 0)');
});

test('real bug fix: bar.headerClass actually colors the header/footer text on the live page, not just the editor dropdown preview', async ({ page }) => {
  // Pre-existing gap (not caused by editor.js PR3/PR20): bar.headerClass
  // values like text-blue-400 were applied as a class on the live
  // header/footer <span>, but no stylesheet outside the editor's own
  // .daw-option-* dropdown rules ever defined what that class means, so it
  // always rendered in the generic .bar-header-info muted-gray default.
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  await page.evaluate(async () => {
    window.cachedMasterFrameData = window.cachedMasterFrameData || {};
    window.cachedMasterFrameData['boomcat'] = {
      m1s: [{
        id: 'test_move', name: 'Test Move', input: 'M1', type: 'Attack', damageType: 'Melee',
        stats: [],
        variants: {
          standard: {
            label: 'Standard', totalScale: 100,
            bars: [{
              type: 'single', headerInfo: 'Self Stun', footerInfo: 'Target Stun', headerClass: 'text-blue-400',
              phases: [{ duration: 10, styleClass: 'bg-tick-start', label: 'Startup' }],
            }],
          },
        },
      }],
    };
    await window.loadMoveSection('boomcat', 'm1s');
  });

  await page.locator('#nav-m1s').click();

  const infoRows = page.locator('#tab-m1s .bar-header-info');
  await expect(infoRows).toHaveCount(2); // header (top) + footer (bottom)
  await expect(infoRows.first()).toBeVisible();

  const headerColor = await infoRows.nth(0).locator('span').evaluate(el => getComputedStyle(el).color);
  const footerColor = await infoRows.nth(1).locator('span').evaluate(el => getComputedStyle(el).color);
  expect(headerColor).toBe('rgb(59, 130, 246)'); // text-blue-400 = #3b82f6
  expect(footerColor).toBe('rgb(59, 130, 246)');
});

test('admin.html now loads site_meta.js: CHARACTER_COLORS/FRAME_COLORS are populated, not empty', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });
  const state = await page.evaluate(() => ({
    hasCharacterColors: !!(window.CHARACTER_COLORS && Object.keys(window.CHARACTER_COLORS).length > 0),
    hasFrameColors: !!(window.FRAME_COLORS && Object.keys(window.FRAME_COLORS).length > 0),
  }));
  expect(state.hasCharacterColors).toBe(true);
  expect(state.hasFrameColors).toBe(true);
});
