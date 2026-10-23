// The Halloween minigame (owner's design, 2026-10-23, after two rounds of the
// owner trying it). Any click has a 50% chance to wake it: the screen fades to
// black under a wobbling "HIT A FULL BLACK FLASH CHAIN OR GET JUMPSCARED",
// music starts, the sides blink red and everything sways, worse the longer
// nothing is pressed. The game's own Divergent Fist skill box sits in the
// middle with a dot on it. Space, a click, a tap or the 3 key throws a
// Divergent Fist, and pressing again about 0.3s later lands a Black Flash,
// with its sound. Four fists, and only the fourth decides; then the music and
// the game fade out. Losing is the owner's avatar holding a stretched Ko-fi
// button like a sword, growing for about two seconds, then its face filling
// the screen begging, then the Ko-fi button stretched over everything with a
// pitched-up scream; winning is the avatar far away, quietly asking. "press x
// to skip" in the corner the whole way through. Either way the site turns
// Pumpkin Night after. Once per reader, again from Site settings, and gone
// on November 1.
//
// THE CLOCK IS FAKED AND PAUSED: time moves only when a test moves it, so a
// press "0.3s later" is exactly 300ms, and no date here turns red in November.
// CSS animations run on the real clock, so a test reads which animation runs,
// not how far along it is.
const { test, expect } = require('@playwright/test');

test.use({ timezoneId: 'UTC' });
const DURING = new Date('2026-10-25T12:00:00Z');
const AFTER = new Date('2026-11-01T00:00:01Z');
const RESOLVE = 700;

async function arm(page, { at = DURING, random = 0.01, automated = false, played = false } = {}) {
  await page.clock.install({ time: at });
  await page.clock.pauseAt(new Date(at.getTime() + 1000));
  await page.addInitScript(({ random, automated, played }) => {
    // The game skips automated browsers; this one says it is not.
    if (!automated) Object.defineProperty(Navigator.prototype, 'webdriver', { configurable: true, get: () => false });
    if (random !== null) Math.random = () => random;
    window.__played = [];
    window.__paused = [];
    HTMLMediaElement.prototype.play = function () {
      window.__played.push({ src: this.src, rate: this.playbackRate, keepsPitch: this.preservesPitch });
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () { window.__paused.push({ src: this.src, volume: this.volume }); };
    try {
      localStorage.setItem('dsl_editor_tutorial_seen', '1');
      if (played) localStorage.setItem('dsl_halloween_done', '1');
    } catch (e) { /* ignore */ }
  }, { random, automated, played });
  // The game is the same on every reader page; this one loads the least.
  await page.goto('/404.html', { waitUntil: 'domcontentloaded' });
}

const game = (page) => page.locator('.hw-game');
const heading = (page) => page.locator('h1').first();
// A click wakes it, then 1.6s of fading to black.
async function wakeAndWait(page) {
  await heading(page).click();
  await expect(game(page)).toHaveCount(1);
  await page.clock.runFor(1600);
  await expect(game(page)).toHaveClass(/is-live/);
}
// One fist: throw, then the second press `gap` ms later (null: never).
async function fist(page, gap, { throwWith = () => page.keyboard.press('Space'), landWith = () => page.keyboard.press('Space') } = {}) {
  await throwWith();
  if (gap === null) {
    await page.clock.runFor(800);
  } else {
    await page.clock.runFor(gap);
    await landWith();
  }
  const said = await page.locator('.hw-callout').textContent();
  await page.clock.runFor(650);
  return said;
}
const looks = (page) => page.evaluate(() => ({
  on: document.documentElement.classList.contains('halloween'),
  done: localStorage.getItem('dsl_halloween_done'),
  webs: document.querySelectorAll('.hw-webs .hw-web').length,
}));
const sounds = (page) => page.evaluate(() => ({ played: window.__played, paused: window.__paused }));
const played = async (page, re) => (await sounds(page)).played.filter(p => re.test(p.src));
const MUSIC = /medias\/audios\/tunetank-dark-tense-cinematic-chase-music-414691\.mp3$/;
const SCREAM = /medias\/audios\/HalloweenJumpscare\.mp3$/;
const HIT = /medias\/audios\/8f73237e2303c812712cfba944ed5bf7\.mp3$/;

test('a click wakes it: the screen goes to black, the music starts, and nothing counts until the warning is up', async ({ page }) => {
  await arm(page);
  await expect(game(page)).toHaveCount(0);
  await heading(page).click();
  await expect(game(page)).toHaveCount(1);
  await expect(page.locator('.hw-tip')).toHaveText('HIT A FULL BLACK FLASH CHAIN OR GET JUMPSCARED');
  expect(await played(page, MUSIC)).toHaveLength(1);
  // A press during the fade does nothing.
  await page.keyboard.press('Space');
  await expect(page.locator('.hw-callout')).toHaveText('');
  await page.clock.runFor(1600);
  await expect(game(page)).toHaveClass(/is-live/);
  // Fully black, not see-through (owner). The fade is CSS, on the real clock.
  await expect.poll(() => game(page).evaluate(g => getComputedStyle(g).backgroundColor)).toBe('rgb(0, 0, 0)');
  await expect(page.locator('.hw-count')).toHaveText('FIST 1 / 4');
  await expect(page.locator('.hw-help')).toHaveText('Space, 3, click, or tap!!!');
  await expect(page.locator('.hw-skip')).toHaveText('press x to skip');
  // The warning wobbles.
  expect(await page.locator('.hw-tip').evaluate(t => getComputedStyle(t).animationName)).toBe('hw-wobble');
});

test('the dot sits on the middle of the skill box, in front of it, and the ring closes on the dot', async ({ page }) => {
  await arm(page);
  await wakeAndWait(page);
  await expect(page.locator('.hw-skill')).toHaveAttribute('src', /medias\/images\/InGameDivergentFistUI\.png$/);
  const where = await page.evaluate(() => {
    const centre = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const box = centre(document.querySelector('.hw-skill'));
    const dot = centre(document.querySelector('.hw-dot'));
    const ring = centre(document.querySelector('.hw-ring'));
    const onTop = document.elementFromPoint(box.x, box.y);
    return {
      dotOff: Math.hypot(box.x - dot.x, box.y - dot.y),
      ringOff: Math.hypot(dot.x - ring.x, dot.y - ring.y),
      dotOnTop: !!(onTop && onTop.closest('.hw-dot, .hw-ring')),
    };
  });
  expect(where.dotOff).toBeLessThan(2);
  expect(where.ringOff).toBeLessThan(2);
  expect(where.dotOnTop).toBe(true);
  // A press dips the box.
  await page.keyboard.press('Space');
  await expect(page.locator('.hw-target')).toHaveClass(/is-pressed/);
});

test('the sides blink red and everything sways, worse the longer nothing is pressed, calm again on a press', async ({ page }) => {
  await arm(page);
  await wakeAndWait(page);
  const state = () => page.evaluate(() => ({
    heat: document.querySelector('.hw-game').dataset.heat,
    blink: getComputedStyle(document.querySelector('.hw-game'), '::before').animationName,
    blinkEvery: getComputedStyle(document.querySelector('.hw-game'), '::before').animationDuration,
    sway: ['.hw-count', '.hw-target', '.hw-callout', '.hw-help'].map(s => getComputedStyle(document.querySelector(s)).animationName),
  }));

  const calm = await state();
  expect(calm).toMatchObject({ heat: '0', blink: 'hw-blink', blinkEvery: '1s' });
  expect(calm.sway).toEqual(['hw-sway', 'hw-sway', 'hw-sway', 'hw-sway']);

  await page.clock.runFor(3250);
  expect((await state()).heat).toBe('1');
  await page.clock.runFor(3000);
  const harder = await state();
  expect(harder.heat).toBe('2');
  expect(harder.sway[0]).toBe('hw-sway-hard');
  await page.clock.runFor(2000);
  const violent = await state();
  expect(violent.heat).toBe('3');
  expect(violent.sway).toEqual(['hw-jiggle', 'hw-jiggle', 'hw-jiggle', 'hw-jiggle']);
  expect(parseFloat(violent.blinkEvery)).toBeLessThan(parseFloat(calm.blinkEvery));

  await page.keyboard.press('Space');
  expect((await state()).heat).toBe('0');
});

test('the other half of the clicks do nothing, and a click into a text box never wakes it', async ({ page }) => {
  await arm(page, { random: 0.6 });
  await heading(page).click();
  await expect(game(page)).toHaveCount(0);

  const typing = await page.context().newPage();
  await arm(typing);
  await typing.locator('input[type="text"], input[type="search"]').first().click();
  await expect(game(typing)).toHaveCount(0);
});

test('the click that wakes it is spent on it: a link does not lead away', async ({ page }) => {
  await arm(page);
  const before = page.url();
  await page.locator('.local-sidebar-right a[href$="forum.html"]').click();
  await expect(game(page)).toHaveCount(1);
  expect(page.url()).toBe(before);
});

test('on the beat is a Black Flash, with its sound; too early, too late or no second press is a miss', async ({ page }) => {
  await arm(page);
  await wakeAndWait(page);
  expect(await fist(page, 300)).toBe('BLACK FLASH!');
  expect(await played(page, HIT)).toHaveLength(1);
  await expect(page.locator('.hw-count')).toHaveText('FIST 2 / 4');
  expect(await fist(page, 150)).toBe('MISS');
  expect(await fist(page, 420)).toBe('MISS');
  expect(await fist(page, null), 'the fist lands on its own without a second press').toBe('MISS');
  expect(await played(page, HIT), 'a miss makes no Black Flash sound').toHaveLength(1);
});

test('the edges of the beat: 220ms and 380ms count, 219ms and 381ms do not', async ({ page }) => {
  await arm(page);
  await wakeAndWait(page);
  expect(await fist(page, 220)).toBe('BLACK FLASH!');
  expect(await fist(page, 380)).toBe('BLACK FLASH!');
  expect(await fist(page, 219)).toBe('MISS');
  expect(await fist(page, 381)).toBe('MISS');
});

test('the 3 key and a click work as well as Space', async ({ page }) => {
  await arm(page);
  await wakeAndWait(page);
  const said = await fist(page, 300, {
    throwWith: () => page.keyboard.press('3'),
    landWith: () => page.locator('.hw-game').click({ position: { x: 20, y: 20 } }),
  });
  expect(said).toBe('BLACK FLASH!');
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true });
  test('a tap throws and lands too', async ({ page }) => {
    await arm(page);
    await wakeAndWait(page);
    const tap = () => page.locator('.hw-game').tap({ position: { x: 20, y: 20 } });
    expect(await fist(page, 300, { throwWith: tap, landWith: tap })).toBe('BLACK FLASH!');
  });
});

test('after the fourth fist the music and the game fade out before the scene', async ({ page }) => {
  await arm(page);
  await wakeAndWait(page);
  for (let i = 0; i < 4; i++) await fist(page, 300);
  await expect(game(page)).toHaveClass(/is-resolving/);
  await expect(page.locator('.hw-scene')).toHaveCount(0);
  await page.clock.runFor(RESOLVE);
  await expect(page.locator('.hw-won')).toHaveCount(1);
  const music = (await sounds(page)).paused.filter(p => MUSIC.test(p.src));
  expect(music, 'faded to silence, then stopped').toEqual([expect.objectContaining({ volume: 0 })]);
});

test('only the fourth fist decides: three misses and then a Black Flash wins', async ({ page }) => {
  await arm(page);
  await wakeAndWait(page);
  for (let i = 0; i < 3; i++) await fist(page, 100);
  await fist(page, 300);
  await page.clock.runFor(RESOLVE);

  // Seen from far away, quietly asking; then into the new look.
  await expect(page.locator('.hw-won .hw-avatar')).toHaveAttribute('src', /medias\/images\/DeptrAvatar\.webp$/);
  await expect(page.locator('.hw-ask')).toBeVisible();
  await expect(page.locator('.hw-lost')).toHaveCount(0);
  await page.clock.runFor(2600);
  expect(await looks(page)).toMatchObject({ on: true, done: '1' });
  await page.clock.runFor(1000);
  await expect(game(page)).toHaveCount(0);
  expect((await looks(page)).webs).toBe(2);
  expect(await played(page, SCREAM)).toEqual([]);
});

test('three Black Flashes and a miss on the fourth loses: the growing avatar, the pixelated face, the Ko-fi button and the scream', async ({ page }) => {
  await arm(page);
  await wakeAndWait(page);
  for (let i = 0; i < 3; i++) await fist(page, 300);
  await fist(page, 100);
  await page.clock.runFor(RESOLVE);

  const scene = page.locator('.hw-lost');
  await expect(scene).toHaveClass(/is-growing/);
  await expect(scene.locator('.hw-avatar')).toHaveAttribute('src', /medias\/images\/DeptrAvatar\.webp$/);
  await expect(scene.locator('.hw-sword')).toHaveAttribute('src', /medias\/images\/KoFiButton\.png$/);
  // Grows for about two seconds.
  expect(await scene.locator('.hw-figure').evaluate(f => getComputedStyle(f).transitionDuration)).toBe('2s');
  await expect(page.locator('.hw-beg')).toBeHidden();
  expect((await looks(page)).done, 'played, even if the tab closes mid-scare').toBe('1');

  await page.clock.runFor(2300);
  await expect(scene).toHaveClass(/is-close/);
  await expect(page.locator('.hw-beg')).toBeVisible();
  // The face, drawn small and stretched over the whole screen without smoothing.
  await expect(page.locator('.hw-face')).toHaveCount(1);
  const face = await page.locator('.hw-face').evaluate(c => {
    const r = c.getBoundingClientRect();
    return { drawn: c.width, rendering: getComputedStyle(c).imageRendering, covers: r.width >= window.innerWidth - 1 && r.height >= window.innerHeight - 1 };
  });
  expect(face.drawn).toBeLessThan(400);
  expect(face).toMatchObject({ rendering: 'pixelated', covers: true });
  expect(await played(page, SCREAM)).toEqual([]);

  await page.clock.runFor(1800);
  const kofi = page.locator('.hw-kofi');
  await expect(kofi).toHaveAttribute('src', /medias\/images\/KoFiButton\.png$/);
  const stretched = await kofi.evaluate(k => {
    const r = k.getBoundingClientRect();
    return { rendering: getComputedStyle(k).imageRendering, covers: r.width >= window.innerWidth - 1 && r.height >= window.innerHeight - 1, zoom: getComputedStyle(k).animationName };
  });
  expect(stretched, 'there at once, no zoom').toEqual({ rendering: 'pixelated', covers: true, zoom: 'none' });
  // Higher than the file, towards Foxy's.
  const [scream] = await played(page, SCREAM);
  expect(scream.rate).toBeGreaterThan(1);
  expect(scream.keepsPitch).toBe(false);

  await page.clock.runFor(2000);
  expect((await looks(page)).on).toBe(true);
  await page.clock.runFor(1000);
  await expect(game(page)).toHaveCount(0);
});

test('on a slow line the face is drawn when the picture arrives, not left out', async ({ page }) => {
  let release;
  const held = new Promise(r => { release = r; });
  const file = require('path').join(__dirname, '..', 'medias', 'images', 'DeptrAvatar.webp');
  await page.route(/DeptrAvatar\.webp/, async route => { await held; await route.fulfill({ path: file, contentType: 'image/webp' }); });
  await arm(page);
  await wakeAndWait(page);
  for (let i = 0; i < 4; i++) await fist(page, 100);
  await page.clock.runFor(RESOLVE + 2300);
  await expect(page.locator('.hw-lost')).toHaveClass(/is-close/);
  await expect(page.locator('.hw-face')).toHaveCount(0);
  release();
  await expect(page.locator('.hw-face')).toHaveCount(1);
});

test('x skips straight to the new look from the game', async ({ page }) => {
  await arm(page);
  await wakeAndWait(page);
  await page.keyboard.press('x');
  expect(await looks(page)).toMatchObject({ on: true, done: '1' });
  await page.clock.runFor(1000);
  await expect(game(page)).toHaveCount(0);
});

test('x skips the scare too, and nothing of it comes after', async ({ page }) => {
  await arm(page);
  await wakeAndWait(page);
  for (let i = 0; i < 4; i++) await fist(page, 100);
  await page.clock.runFor(RESOLVE);
  await expect(page.locator('.hw-lost')).toHaveCount(1);
  await page.keyboard.press('X');
  await page.clock.runFor(1000);
  await expect(game(page)).toHaveCount(0);
  expect((await looks(page)).on).toBe(true);
  // The scare's own timers were stopped with it: no scream later.
  await page.clock.runFor(8000);
  expect(await played(page, SCREAM)).toEqual([]);
});

test('the skip text can be tapped too, and doing so throws no fist', async ({ page }) => {
  await arm(page);
  await wakeAndWait(page);
  await page.locator('.hw-skip').click();
  expect(await page.locator('.hw-callout').textContent()).toBe('');
  expect(await looks(page)).toMatchObject({ on: true, done: '1' });
});

test('doing nothing loses', async ({ page }) => {
  await arm(page);
  await wakeAndWait(page);
  await page.clock.runFor(10000);
  await page.clock.runFor(RESOLVE);
  await expect(page.locator('.hw-lost')).toHaveCount(1);
});

test('once played, never again on this device, and the look is there from the start', async ({ page }) => {
  await arm(page, { played: true });
  for (let i = 0; i < 5; i++) await heading(page).click();
  await expect(game(page)).toHaveCount(0);
  expect(await looks(page)).toMatchObject({ on: true, webs: 2 });
});

test('an automated browser never gets it, so no other test on the site meets it', async ({ page }) => {
  await arm(page, { automated: true });
  for (let i = 0; i < 5; i++) await heading(page).click();
  await expect(game(page)).toHaveCount(0);
  expect((await looks(page)).on).toBe(false);
});

test('a reader who asked for less motion gets the look straight away, without the game', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await arm(page);
  // At once, before a game could have popped up and run its course.
  expect(await looks(page)).toMatchObject({ on: true, done: '1', webs: 2 });
  for (let i = 0; i < 5; i++) await heading(page).click();
  await expect(game(page)).toHaveCount(0);
});

test('Site settings plays it again', async ({ page }) => {
  await arm(page, { played: true });
  await page.locator('#dock-btn-settings').click();
  const play = page.locator('[data-halloween-replay]');
  await expect(play).toBeVisible();
  await play.click();
  await expect(page.locator('#site-settings-overlay')).toBeHidden();
  await expect(game(page)).toHaveCount(1);
});

test('from November 1 there is no game and nothing to play in Site settings', async ({ page }) => {
  await arm(page, { at: AFTER });
  for (let i = 0; i < 5; i++) await heading(page).click();
  await expect(game(page)).toHaveCount(0);
  await page.locator('#dock-btn-settings').click();
  await expect(page.locator('#site-settings-overlay .site-settings-body')).toBeVisible();
  await expect(page.locator('[data-halloween-replay]')).toHaveCount(0);
});
