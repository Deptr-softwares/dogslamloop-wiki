// A combo block beside a right-aligned video keeps clear of it (owner's
// wishlist, 2026-10-18: "some elements clip into each other on a screen that
// is not too wide, namely a left-aligned Combo block and right-aligned Video
// block").
//
// The cause was the box, not the text. A plain block box does not move out of
// a float's way; only its text does. So the route wrapped beside the video
// while the combo's border and background ran on underneath it. Measured
// before the fix, the two boxes overlapped at 700, 900, 1100 and 1400px.
//
// Asserted as "the two boxes do not intersect", which holds whatever the
// fonts measure on the machine running it.
const { test, expect } = require('@playwright/test');

const BLOCKS = [
  { type: 'video', src: '/medias/videos/missing.mp4', align: 'right', width: '45%' },
  { type: 'paragraph', content: 'Text beside the video.' },
  { type: 'combo', align: 'left', sequence: ['M1', 'M1', 'M1', 'Side Dash', 'Garuda Stab', 'Rising Rage', 'Downslam', 'Aerial Crushing Blow'], damage: '45' },
];

for (const width of [700, 1100, 1400]) {
  test(`at ${width}px the combo and the video do not overlap`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/systems/terminologies/index.html', { waitUntil: 'networkidle' });

    const out = await page.evaluate((blocks) => {
      const host = document.createElement('div');
      host.id = 'combo-host';
      host.className = 'wiki-section';
      (document.querySelector('.main-content-area, main') || document.body).prepend(host);
      window.populateTextSection('combo-host', 'Combo beside media', blocks);

      const media = host.querySelector('.wiki-media-right').getBoundingClientRect();
      const combo = host.querySelector('.combo-block').getBoundingClientRect();
      const x = Math.min(media.right, combo.right) - Math.max(media.left, combo.left);
      const y = Math.min(media.bottom, combo.bottom) - Math.max(media.top, combo.top);
      return { overlap: x > 0 && y > 0, comboWidth: combo.width };
    }, BLOCKS);

    expect(out.overlap).toBe(false);
    expect(out.comboWidth, 'the combo is still there, wrapped beside it').toBeGreaterThan(100);
  });
}

test('with nothing beside it, the combo still hugs its route', async ({ page }) => {
  // flow-root must not turn the block into a full-width panel: width stays
  // fit-content, which is what keeps a short route a short box.
  await page.goto('/systems/terminologies/index.html', { waitUntil: 'networkidle' });
  const out = await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'combo-alone';
    host.className = 'wiki-section';
    (document.querySelector('.main-content-area, main') || document.body).prepend(host);
    window.populateTextSection('combo-alone', 'Short', [{ type: 'combo', sequence: ['M1', 'M1'], damage: '8' }]);
    const combo = host.querySelector('.combo-block').getBoundingClientRect();
    return { combo: combo.width, host: host.getBoundingClientRect().width };
  });
  expect(out.combo).toBeLessThan(out.host / 2);
});
