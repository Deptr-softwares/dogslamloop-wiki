// v0.18 FT2 - a dark character's name gets a white outline, on dark pages only.
//
// Owner, 2026-09-08: "internalStyling.js gives dark character names white
// outline only in a dark pages (pages of character with 'dark' color codes)".
//
// TWO CONDITIONS, AND THE TEST HAS TO SEPARATE THEM, because a rule that got
// either half wrong would still look right on the one page somebody checked:
//
//   the NAME must be dark   - a light character mentioned on a dark page was
//                             already readable, and outlining it only thickens
//                             it
//   the PAGE must be dark   - this is where the site already outlines its own
//                             titles in white (the engine in js/site_meta.js),
//                             so elsewhere an outlined name would be the only
//                             thing on the page treated that way
//
// So there are three cases below, not one: dark-on-dark outlines, light-on-dark
// does not, and dark-on-light does not.
//
// Measured off the browser rather than asserted as a class. This project has
// shipped nine passing tests against a colour that never painted, because
// .combo-node set `color` in a stylesheet that loaded later at equal
// specificity - "thickened but not orange".
const { test, expect } = require('@playwright/test');

// hsl(233, 39%, 23%) - well under the <50% lightness test.
const DARK_PAGE = '/characters/Crow_charmer/index.html';
// hsl(0, 1%, 75%) - well over it.
const LIGHT_PAGE = '/characters/Boomcat/index.html';

// Black Death is hsl(352, 49%, 27%); Vessel is hsl(0, 100%, 80%).
const DARK_NAME = 'Black Death';
const LIGHT_NAME = 'Vessel';

async function outlineOf(page, url, name) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof window.applyInternalStyling === 'function', { timeout: 15000 });
  await page.waitForTimeout(1200);

  return page.evaluate((who) => {
    const host = document.createElement('p');
    host.className = 'wiki-text';
    host.id = 'ft2-probe';
    host.textContent = `A sentence naming ${who} in prose.`;
    document.querySelector('main').appendChild(host);
    window.applyInternalStyling();

    const span = host.querySelector('.sc-char');
    if (!span) return { found: false };
    const cs = getComputedStyle(span);
    return {
      found: true,
      classes: span.className,
      stroke: cs.webkitTextStrokeColor,
      strokeWidth: cs.webkitTextStrokeWidth,
      shadow: cs.textShadow,
      pageDark: document.documentElement.classList.contains('page-character-dark'),
    };
  }, name);
}

// White, drawn either as a stroke or as the fallback shadow - one of the two,
// because which applies depends on @supports rather than on this feature.
function isOutlinedWhite(r) {
  const strokeWhite = r.stroke === 'rgb(255, 255, 255)' && parseFloat(r.strokeWidth) > 0;
  const shadowWhite = /255,\s*255,\s*255/.test(r.shadow);
  return strokeWhite || shadowWhite;
}

test('a dark page is marked as one', async ({ page }) => {
  const dark = await outlineOf(page, DARK_PAGE, DARK_NAME);
  expect(dark.pageDark, 'Crow Charmer is hsl(233, 39%, 23%)').toBe(true);

  const light = await outlineOf(page, LIGHT_PAGE, DARK_NAME);
  expect(light.pageDark, 'Boomcat is hsl(0, 1%, 75%)').toBe(false);
});

test('a dark name on a dark page is outlined in white', async ({ page }) => {
  const r = await outlineOf(page, DARK_PAGE, DARK_NAME);
  expect(r.found, 'the name has to be highlighted at all first').toBe(true);
  expect(r.classes).toContain('sc-char-dark');
  expect(isOutlinedWhite(r), `no white outline: stroke=${r.stroke} shadow=${r.shadow}`).toBe(true);
});

test('a LIGHT name on a dark page is left alone', async ({ page }) => {
  const r = await outlineOf(page, DARK_PAGE, LIGHT_NAME);
  expect(r.found).toBe(true);
  // The page half of the selector matches here, so this is what proves the
  // name half is doing work rather than riding along.
  expect(r.classes).not.toContain('sc-char-dark');
  expect(isOutlinedWhite(r), 'a light name was already readable').toBe(false);
});

test('a dark name on a LIGHT page is left alone', async ({ page }) => {
  const r = await outlineOf(page, LIGHT_PAGE, DARK_NAME);
  expect(r.found).toBe(true);
  // The name half matches here, so this is what proves the page half is doing
  // work. Between this and the test above, neither half can be deleted with
  // the suite still green.
  expect(r.classes).toContain('sc-char-dark');
  expect(isOutlinedWhite(r), 'only dark-coded pages outline their names').toBe(false);
});

test('the darkness test is stated once, not re-derived', async ({ page }) => {
  await page.goto(DARK_PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.isDarkCharacterColor === 'function', { timeout: 15000 });

  // --character-ink, the title shadow engine and the name outline all ask this
  // one function. Three copies of "<50%" is how they would come to disagree
  // about the same character, and they sit next to each other on one page.
  const out = await page.evaluate(() => ({
    darkest: window.isDarkCharacterColor('hsl(233, 39%, 23%)'),
    boundaryUnder: window.isDarkCharacterColor('hsl(0, 0%, 49%)'),
    boundaryOver: window.isDarkCharacterColor('hsl(0, 0%, 50%)'),
    lightest: window.isDarkCharacterColor('hsl(0, 0%, 100%)'),
    // Unparseable must not be guessed at - no outline beats a wrong one.
    junk: window.isDarkCharacterColor('not a colour'),
    nothing: window.isDarkCharacterColor(null),
  }));

  expect(out).toEqual({
    darkest: true, boundaryUnder: true, boundaryOver: false,
    lightest: false, junk: false, nothing: false,
  });
});
