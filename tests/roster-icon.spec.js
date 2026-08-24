// The Dynamic Roster Icon (v0.16 feature 1).
//
// The contract this file exists to protect has three halves, and the third is
// the one that will rot quietly if nobody asserts it:
//
//  1. THE ICON PATH IS DERIVED, NOT STORED. navigation.json is generated from
//     site_pages, so an icon column would reach readers only through the
//     nightly regeneration job AND the next release. The convention
//     (pageId -> PascalCase + "Icon.webp") is what keeps the owner's job to
//     "drop a file in medias/images/".
//
//  2. A MISSING ICON FALLS BACK TO THE PRE-v0.16 CARD. Not to a broken image,
//     not to an empty square - to the solid colour with the name centred and
//     always visible, which is what the card was before this feature. The
//     fallback is the ABSENCE of `.has-icon`, so it cannot drift from the
//     design it is supposed to restore.
//
//  3. THE NAME IS STILL REACHABLE ON A TOUCH DEVICE. The slit is revealed by
//     hover, and a phone has none. The name therefore stays visible under
//     `@media (hover: none)`. A roster whose names are all invisible on mobile
//     is the exact class of mistake v0.5 and v0.6 spent two passes undoing.
const { test, expect } = require('@playwright/test');

const ROSTER = '/characters/index.html';

// --- 1. THE PATH CONVENTION ---

test('the icon path is derived from the page id', async ({ page }) => {
  await page.goto(ROSTER, { waitUntil: 'networkidle' });

  const resolved = await page.evaluate(() => ({
    twoWords: window.rosterIconPath('honored_one'),
    oneWord: window.rosterIconPath('perfection'),
    threeWords: window.rosterIconPath('head_hei'),
    empty: window.rosterIconPath(''),
    nullish: window.rosterIconPath(null),
  }));

  expect(resolved.twoWords).toBe('medias/images/HonoredOneIcon.webp');
  expect(resolved.oneWord).toBe('medias/images/PerfectionIcon.webp');
  expect(resolved.threeWords).toBe('medias/images/HeadHeiIcon.webp');

  // A page with no id must not produce "medias/images/Icon.webp", which would
  // be a real request for a real file that happens not to exist.
  expect(resolved.empty).toBeNull();
  expect(resolved.nullish).toBeNull();
});

// --- 2. THE ICONS ACTUALLY RESOLVE ---

test('every rendered card requests an icon that exists', async ({ page }) => {
  const missing = [];
  // Deliberately NOT asserting a count of characters or naming any of them:
  // pinning a test to owner content has blocked this owner from adding pages
  // before. This asserts that whatever is on the roster today resolves, which
  // stays true as characters come and go.
  page.on('response', r => {
    if (r.url().includes('/medias/images/') && r.status() >= 400) missing.push(r.url());
  });

  await page.goto(ROSTER, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const cards = await page.locator('.roster-card').count();
  expect(cards, 'the roster rendered at all').toBeGreaterThan(0);

  expect(missing, `icon files 404ed: ${missing.join(', ')}`).toEqual([]);
});

test('a card whose icon loaded is marked, and shows the icon', async ({ page }) => {
  await page.goto(ROSTER, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const withIcon = page.locator('.roster-card.has-icon').first();
  await expect(withIcon).toHaveCount(1);

  // Asserting the class alone would prove the marking ran, not that a reader
  // sees an icon. Read back what the browser actually painted.
  const painted = await withIcon.locator('.roster-card-icon').evaluate(img => ({
    natural: img.naturalWidth,
    box: img.getBoundingClientRect().width,
    visible: getComputedStyle(img).display !== 'none',
  }));

  expect(painted.natural, 'the icon decoded').toBeGreaterThan(0);
  expect(painted.box, 'the icon occupies the card').toBeGreaterThan(0);
  expect(painted.visible).toBe(true);
});

// --- 3. THE FALLBACK ---

test('a character with no icon file falls back to the pre-v0.16 card', async ({ page }) => {
  // Every icon request fails, so this is the "character added, icon not
  // uploaded yet" case for the WHOLE roster at once.
  await page.route('**/medias/images/*Icon.webp', route => route.abort());

  await page.goto(ROSTER, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const state = await page.evaluate(() => {
    const card = document.querySelector('.roster-card');
    const text = card.querySelector('.roster-card-text');
    const cs = getComputedStyle(text);
    return {
      marked: card.classList.contains('has-icon'),
      strayImg: !!card.querySelector('.roster-card-icon'),
      nameVisible: cs.visibility !== 'hidden' && cs.display !== 'none',
      // The pre-v0.16 card had no clip on the name. If a clip survives here the
      // name is invisible until hover on a card that has nothing to hover over.
      clip: cs.clipPath,
      solidColour: getComputedStyle(card).backgroundColor,
      nameText: text.textContent.trim(),
    };
  });

  expect(state.marked, 'a card with no icon must not be marked').toBe(false);
  expect(state.strayImg, 'the broken <img> is removed, not left to show an icon glyph').toBe(false);
  expect(state.nameVisible, 'the name stays visible').toBe(true);
  expect(state.clip === 'none' || state.clip === 'auto',
    `the name must not be clipped when there is no icon (got ${state.clip})`).toBe(true);
  expect(state.nameText.length, 'the name is actually written').toBeGreaterThan(0);
  expect(state.solidColour, 'the solid colour card is still there')
    .not.toBe('rgba(0, 0, 0, 0)');
});

// --- 4. THE SLIT ---

test('the name is hidden at rest and revealed on hover', async ({ page }) => {
  await page.goto(ROSTER, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const card = page.locator('.roster-card.has-icon').first();
  const name = card.locator('.roster-card-text');

  const atRest = await name.evaluate(el => getComputedStyle(el).clipPath);
  // inset(0px 100% 0px 0px) - fully clipped from the right, so nothing shows.
  expect(atRest, 'the name starts clipped away').toContain('100%');

  await card.hover();
  await page.waitForTimeout(500);

  const hovered = await name.evaluate(el => getComputedStyle(el).clipPath);
  expect(hovered, 'hovering opens the slit').not.toContain('100%');
});

test('the slit is as wide as the name, not as wide as the card', async ({ page }) => {
  await page.goto(ROSTER, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // The owner's requirement in one assertion: "the width of this dynamic slit
  // is dependent on the character name". Two names of different lengths must
  // produce two different widths, or the slit is not dynamic at all.
  const widths = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.roster-card.has-icon'));
    return cards.map(c => {
      const t = c.querySelector('.roster-card-text');
      return { name: t.textContent.trim(), w: t.getBoundingClientRect().width };
    });
  });

  expect(widths.length).toBeGreaterThan(1);

  const shortest = widths.reduce((a, b) => (a.name.length <= b.name.length ? a : b));
  const longest = widths.reduce((a, b) => (a.name.length >= b.name.length ? a : b));

  expect(longest.name.length).toBeGreaterThan(shortest.name.length);
  expect(longest.w,
    `"${longest.name}" (${longest.w}px) should be wider than "${shortest.name}" (${shortest.w}px)`)
    .toBeGreaterThan(shortest.w);
});

// --- 5. MOBILE ---

test('the name stays visible on a device that cannot hover', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();

  await page.goto(ROSTER, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const state = await page.evaluate(() => {
    const card = document.querySelector('.roster-card.has-icon')
      || document.querySelector('.roster-card');
    const text = card.querySelector('.roster-card-text');
    const r = text.getBoundingClientRect();
    return { clip: getComputedStyle(text).clipPath, w: r.width, h: r.height };
  });

  // The slit rules live inside @media (hover: hover), so on a touch emulation
  // context they must not apply at all.
  expect(state.clip === 'none' || state.clip === 'auto',
    `names must not be hover-gated on touch (got ${state.clip})`).toBe(true);
  expect(state.w, 'the name occupies real space').toBeGreaterThan(0);
  expect(state.h).toBeGreaterThan(0);

  await context.close();
});

// --- 6. THE WIP MARKER ---

test('WIP renders as a corner marker, not as text under the name', async ({ page }) => {
  await page.goto(ROSTER, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const wip = page.locator('.roster-wip-indicator').first();
  await expect(wip, 'at least one WIP character is on the roster').toHaveCount(1);

  // It has to survive the name being hidden: a "(WIP)" line inside a slit
  // nobody has hovered yet tells the reader nothing. That is why it moved.
  const box = await wip.evaluate(el => {
    const r = el.getBoundingClientRect();
    const card = el.closest('.roster-card').getBoundingClientRect();
    return {
      visible: getComputedStyle(el).display !== 'none',
      inTopLeft: r.left < card.left + card.width / 2 && r.top < card.top + card.height / 2,
      w: r.width,
    };
  });

  expect(box.visible).toBe(true);
  expect(box.w).toBeGreaterThan(0);
  expect(box.inTopLeft, 'the WIP marker sits in the top-left corner').toBe(true);

  // The old inline tag is gone, not merely restyled.
  await expect(page.locator('.roster-wip-tag')).toHaveCount(0);
});
