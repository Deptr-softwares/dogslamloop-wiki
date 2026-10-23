// The Halloween minigame (owner's design, 2026-10-23). Any click has a 50%
// chance to wake it: the screen fades to black under a wobbling "HIT A FULL
// BLACK FLASH CHAIN OR GET JUMPSCARED", music starts, and the game's own
// Divergent Fist skill box sits in the middle. Space, a click, a tap or the 3
// key throws a Divergent Fist, and pressing again about 0.3s later lands a
// Black Flash. Four fists, and only the fourth decides. Losing is the owner's
// avatar holding a stretched Ko-fi button like a sword, growing for about two
// seconds, then its face filling the screen begging, then the Ko-fi button
// stretched over everything with a scream; winning is the avatar far away,
// quietly asking. "press x to skip" in the corner the whole way through.
// Either way the site turns Pumpkin Night after. Once per reader, again from
// Site settings, and gone on November 1.
//
// THE CLOCK IS FAKED AND PAUSED: time moves only when a test moves it, so a
// press "0.3s later" is exactly 300ms, and no date here turns red in November.
const { test, expect } = require('@playwright/test');

test.use({ timezoneId: 'UTC' });
const DURING = new Date('2026-10-25T12:00:00Z');
const AFTER = new Date('2026-11-01T00:00:01Z');

async function arm(page, { at = DURING, random = 0.01, automated = false, played = false } = {}) {
  await page.clock.install({ time: at });
  await page.clock.pauseAt(new Date(at.getTime() + 1000));
  await page.addInitScript(({ random, automated, played }) => {
    // The game skips automated browsers; this one says it is not.
    if (!automated) Object.defineProperty(Navigator.prototype, 'webdriver', { configurable: true, get: () => false });
    if (random !== null) Math.random = () => random;
    window.__played = [];
    window.__paused = [];
    HTMLMediaElement.prototype.play = function () { window.__played.push(this.src); return Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function () { window.__paused.push(this.src); };
    try {
      localStorage.setItem('dsl_editor_tutorial_seen', '1');
      if (played) localStorage.setItem('dsl_halloween_done', '1');
    } catch (e) { /* ignore */ }
  }, { random, automated, played });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
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
const MUSIC = /medias\/audios\/tunetank-dark-tense-cinematic-chase-music-414691\.mp3$/;
const SCREAM = /medias\/audios\/HalloweenJumpscare\.mp3$/;

test('a click wakes it: the screen goes to black, the music starts, and nothing counts until the warning is up', async ({ page }) => {
  await arm(page);
  await expect(game(page)).toHaveCount(0);
  await heading(page).click();
  await expect(game(page)).toHaveCount(1);
  await expect(page.locator('.hw-tip')).toHaveText('HIT A FULL BLACK FLASH CHAIN OR GET JUMPSCARED');
  expect((await sounds(page)).played).toEqual([expect.stringMatching(MUSIC)]);
  // A press during the fade does nothing.
  await page.keyboard.press('Space');
  await expect(page.locator('.hw-callout')).toHaveText('');
  await page.clock.runFor(1600);
  await expect(game(page)).toHaveClass(/is-live/);
  // Fully black, not see-through (owner). The fade is CSS, on the real clock.
  await expect.poll(() => game(page).evaluate(g => getComputedStyle(g).backgroundColor)).toBe('rgb(0, 0, 0)');
  await expect(page.locator('.hw-count')).toHaveText('FIST 1 / 4');
  await expect(page.locator('.hw-skill')).toHaveAttribute('src', /medias\/images\/InGameDivergentFistUI\.png$/);
  await expect(page.locator('.hw-skip')).toHaveText('press x to skip');
  // The warning wobbles.
  expect(await page.locator('.hw-tip').evaluate(t => getComputedStyle(t).animationName)).toBe('hw-wobble');
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

test('on the beat is a Black Flash; too early, too late or no second press is a miss', async ({ page }) => {
  await arm(page);
  await wakeAndWait(page);
  expect(await fist(page, 300)).toBe('BLACK FLASH!');
  await expect(page.locator('.hw-count')).toHaveText('FIST 2 / 4');
  expect(await fist(page, 150)).toBe('MISS');
  expect(await fist(page, 420)).toBe('MISS');
  expect(await fist(page, null), 'the fist lands on its own without a second press').toBe('MISS');
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

test('only the fourth fist decides: three misses and then a Black Flash wins', async ({ page }) => {
  await arm(page);
  await wakeAndWait(page);
  for (let i = 0; i < 3; i++) await fist(page, 100);
  await fist(page, 300);

  // Seen from far away, quietly asking, the music over; then into the new look.
  await expect(page.locator('.hw-won .hw-avatar')).toHaveAttribute('src', /medias\/images\/DeptrAvatar\.webp$/);
  await expect(page.locator('.hw-ask')).toBeVisible();
  await expect(page.locator('.hw-lost')).toHaveCount(0);
  expect((await sounds(page)).paused).toEqual(expect.arrayContaining([expect.stringMatching(MUSIC)]));
  await page.clock.runFor(2600);
  expect(await looks(page)).toMatchObject({ on: true, done: '1' });
  await page.clock.runFor(1000);
  await expect(game(page)).toHaveCount(0);
  expect((await looks(page)).webs).toBe(2);
  expect((await sounds(page)).played.some(s => SCREAM.test(s))).toBe(false);
});

test('three Black Flashes and a miss on the fourth loses: the growing avatar, the pixelated face, the Ko-fi button and the scream', async ({ page }) => {
  await arm(page);
  await wakeAndWait(page);
  for (let i = 0; i < 3; i++) await fist(page, 300);
  await fist(page, 100);

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
  const face = await page.locator('.hw-face').evaluate(c => {
    const r = c.getBoundingClientRect();
    return { drawn: c.width, rendering: getComputedStyle(c).imageRendering, covers: r.width >= window.innerWidth - 1 && r.height >= window.innerHeight - 1 };
  });
  expect(face.drawn).toBeLessThan(400);
  expect(face).toMatchObject({ rendering: 'pixelated', covers: true });
  expect((await sounds(page)).played.some(s => SCREAM.test(s))).toBe(false);

  await page.clock.runFor(1800);
  const kofi = page.locator('.hw-kofi');
  await expect(kofi).toHaveAttribute('src', /medias\/images\/KoFiButton\.png$/);
  const stretched = await kofi.evaluate(k => {
    const r = k.getBoundingClientRect();
    return { rendering: getComputedStyle(k).imageRendering, covers: r.width >= window.innerWidth - 1 && r.height >= window.innerHeight - 1 };
  });
  expect(stretched).toEqual({ rendering: 'pixelated', covers: true });
  const s = await sounds(page);
  expect(s.played.at(-1)).toMatch(SCREAM);
  expect(s.paused, 'the music stops for the scream').toEqual(expect.arrayContaining([expect.stringMatching(MUSIC)]));

  await page.clock.runFor(2000);
  expect((await looks(page)).on).toBe(true);
  await page.clock.runFor(1000);
  await expect(game(page)).toHaveCount(0);
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
  await expect(page.locator('.hw-lost')).toHaveCount(1);
  await page.keyboard.press('X');
  await page.clock.runFor(1000);
  await expect(game(page)).toHaveCount(0);
  expect((await looks(page)).on).toBe(true);
  // The scare's own timers were stopped with it: no scream later.
  await page.clock.runFor(8000);
  expect((await sounds(page)).played.some(s => SCREAM.test(s))).toBe(false);
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
