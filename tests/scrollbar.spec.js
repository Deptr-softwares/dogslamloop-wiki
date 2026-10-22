// The scrollbar (v1.1, owner's pick 2026-10-20): square like everything else
// on the site, in the page's border colour, and the page colour when hovered
// or grabbed.
//
// Its own file because headless Chromium hides scrollbars, and showing them
// is a launch option, which Playwright sets per file. Read from the pixels
// drawn: Chrome 121+ silently skips ::-webkit-scrollbar rules on an element
// that sets scrollbar-width, which the site's old `* { scrollbar-width: thin }`
// did, so a rule being present proves nothing.
const { test, expect } = require('@playwright/test');
const zlib = require('zlib');

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

// The colour drawn at one point (same reader as tests/site-touches.spec.js).
async function pixel(page, x, y) {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  const chunks = [];
  for (let at = 8; at < png.length;) {
    const len = png.readUInt32BE(at);
    if (png.toString('ascii', at + 4, at + 8) === 'IDAT') chunks.push(png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  return [...zlib.inflateSync(Buffer.concat(chunks)).subarray(1, 4)];
}

const rgbOf = (page, prop) => page.evaluate(p => {
  const d = document.createElement('div');
  d.style.color = `var(${p})`;
  document.body.appendChild(d);
  const v = getComputedStyle(d).color;
  d.remove();
  return v.match(/\d+/g).slice(0, 3).map(Number);
}, prop);

const near = (a, b, tolerance = 4) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);

test('the page scrollbar is square, in the border colour, and turns the page colour on hover', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  const width = await page.evaluate(() => innerWidth);
  expect(await page.evaluate(() => document.documentElement.clientWidth)).toBeLessThan(width);
  const border = await rgbOf(page, '--border-color');
  const bg = await rgbOf(page, '--bg-main');
  const accent = await rgbOf(page, '--accent-blue');

  // The thumb, at the top while the page is at the top.
  expect(near(await pixel(page, width - 5, 12), border)).toBe(true);
  // Its corner: a rounded thumb leaves the track showing here.
  expect(near(await pixel(page, width - 8, 2), border)).toBe(true);
  // The track, far below the thumb on this long page.
  expect(near(await pixel(page, width - 5, 880), bg)).toBe(true);

  await page.mouse.move(width - 5, 12);
  await expect.poll(async () => near(await pixel(page, width - 5, 12), accent)).toBe(true);
});
