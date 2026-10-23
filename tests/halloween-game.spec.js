// The Halloween minigame (owner's design, 2026-10-23). A 5% chance every
// second that it pops up: the screen turns dark under "HIT A FULL BLACK FLASH
// CHAIN OR GET JUMPSCARED". Space, a click, a tap or the 3 key throws a
// Divergent Fist, and pressing again about 0.3s later lands a Black Flash.
// Four fists, and only the fourth decides. Losing is the owner's avatar
// holding a Ko-fi button like a sword, growing, then filling the screen
// begging, then the Ko-fi button with a scream; winning is the avatar far
// away, quietly asking. Either way the site turns Pumpkin Night after.
// Once per reader, again from Site settings, and gone on November 1.
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
    HTMLMediaElement.prototype.play = function () { window.__played.push(this.src); return Promise.resolve(); };
    try {
      localStorage.setItem('dsl_editor_tutorial_seen', '1');
      if (played) localStorage.setItem('dsl_halloween_done', '1');
    } catch (e) { /* ignore */ }
  }, { random, automated, played });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
}

const game = (page) => page.locator('.hw-game');
// Into the game: it pops up within the first second, then 1.6s of darkening.
async function popAndWait(page) {
  await page.clock.runFor(1000);
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

test('it pops up on its own, darkens the screen under the prompt, and counts nothing until then', async ({ page }) => {
  await arm(page);
  await expect(game(page)).toHaveCount(0);
  await page.clock.runFor(1000);
  await expect(game(page)).toHaveCount(1);
  await expect(page.locator('.hw-tip')).toHaveText('HIT A FULL BLACK FLASH CHAIN OR GET JUMPSCARED');
  // A press during the darkening does nothing.
  await page.keyboard.press('Space');
  await expect(page.locator('.hw-callout')).toHaveText('');
  await page.clock.runFor(1600);
  await expect(game(page)).toHaveClass(/is-live/);
  await expect(page.locator('.hw-count')).toHaveText('FIST 1 / 4');
});

test('on the beat is a Black Flash; too early, too late or no second press is a miss', async ({ page }) => {
  await arm(page);
  await popAndWait(page);
  expect(await fist(page, 300)).toBe('BLACK FLASH!');
  await expect(page.locator('.hw-count')).toHaveText('FIST 2 / 4');
  expect(await fist(page, 150)).toBe('MISS');
  expect(await fist(page, 420)).toBe('MISS');
  expect(await fist(page, null), 'the fist lands on its own without a second press').toBe('MISS');
});

test('the edges of the beat: 220ms and 380ms count, 219ms and 381ms do not', async ({ page }) => {
  await arm(page);
  await popAndWait(page);
  expect(await fist(page, 220)).toBe('BLACK FLASH!');
  expect(await fist(page, 380)).toBe('BLACK FLASH!');
  expect(await fist(page, 219)).toBe('MISS');
  expect(await fist(page, 381)).toBe('MISS');
});

test('the 3 key and a click work as well as Space', async ({ page }) => {
  await arm(page);
  await popAndWait(page);
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
    await popAndWait(page);
    const tap = () => page.locator('.hw-game').tap({ position: { x: 20, y: 20 } });
    expect(await fist(page, 300, { throwWith: tap, landWith: tap })).toBe('BLACK FLASH!');
  });
});

test('only the fourth fist decides: three misses and then a Black Flash wins', async ({ page }) => {
  await arm(page);
  await popAndWait(page);
  for (let i = 0; i < 3; i++) await fist(page, 100);
  await fist(page, 300);

  // Seen from far away, quietly asking, then into the new look.
  await expect(page.locator('.hw-won .hw-figure img')).toHaveAttribute('src', /medias\/images\/DeptrAvatar\.webp$/);
  await expect(page.locator('.hw-ask')).toBeVisible();
  await expect(page.locator('.hw-lost')).toHaveCount(0);
  await page.clock.runFor(2600);
  expect(await looks(page)).toMatchObject({ on: true, done: '1' });
  await page.clock.runFor(1000);
  await expect(game(page)).toHaveCount(0);
  expect((await looks(page)).webs).toBe(2);
  expect(await page.evaluate(() => window.__played)).toEqual([]);
});

test('three Black Flashes and a miss on the fourth loses: the jumpscare, the scream, then the look', async ({ page }) => {
  await arm(page);
  await popAndWait(page);
  for (let i = 0; i < 3; i++) await fist(page, 300);
  await fist(page, 100);

  const scene = page.locator('.hw-lost');
  await expect(scene).toHaveClass(/is-growing/);
  await expect(scene.locator('.hw-figure img')).toHaveAttribute('src', /medias\/images\/DeptrAvatar\.webp$/);
  await expect(scene.locator('.hw-sword')).toContainText('SUPPORT KO-FI');
  await expect(page.locator('.hw-beg')).toBeHidden();
  expect((await looks(page)).done, 'played, even if the tab closes mid-scare').toBe('1');

  await page.clock.runFor(3800);
  await expect(scene).toHaveClass(/is-close/);
  await expect(page.locator('.hw-beg')).toBeVisible();
  // Filling the screen now.
  const fills = await scene.locator('.hw-figure').evaluate(f => f.getBoundingClientRect().height >= window.innerHeight - 1);
  expect(fills).toBe(true);
  expect(await page.evaluate(() => window.__played)).toEqual([]);

  await page.clock.runFor(1800);
  await expect(page.locator('.hw-kofi')).toBeVisible();
  expect(await page.evaluate(() => window.__played)).toEqual([expect.stringMatching(/medias\/audios\/HalloweenJumpscare\.mp3$/)]);

  await page.clock.runFor(2000);
  expect((await looks(page)).on).toBe(true);
  await page.clock.runFor(1000);
  await expect(game(page)).toHaveCount(0);
});

test('doing nothing loses', async ({ page }) => {
  await arm(page);
  await popAndWait(page);
  await page.clock.runFor(10000);
  await expect(page.locator('.hw-lost')).toHaveCount(1);
});

test('once played, never again on this device, and the look is there from the start', async ({ page }) => {
  await arm(page, { played: true });
  await page.clock.runFor(30000);
  await expect(game(page)).toHaveCount(0);
  expect(await looks(page)).toMatchObject({ on: true, webs: 2 });
});

test('not while the reader is typing', async ({ page }) => {
  await arm(page);
  const box = page.locator('input[type="text"], input[type="search"]').first();
  await box.focus();
  await page.clock.runFor(5000);
  await expect(game(page)).toHaveCount(0);
  await page.evaluate(() => document.activeElement.blur());
  await page.clock.runFor(1000);
  await expect(game(page)).toHaveCount(1);
});

test('an automated browser never gets it, so no other test on the site meets it', async ({ page }) => {
  await arm(page, { automated: true });
  await page.clock.runFor(30000);
  await expect(game(page)).toHaveCount(0);
  expect((await looks(page)).on).toBe(false);
});

test('a reader who asked for less motion gets the look straight away, without the game', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await arm(page);
  // At once, before a game could have popped up and run its course.
  expect(await looks(page)).toMatchObject({ on: true, done: '1', webs: 2 });
  for (let s = 0; s < 30; s++) {
    await page.clock.runFor(1000);
    await expect(game(page)).toHaveCount(0);
  }
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
  await page.clock.runFor(30000);
  await expect(game(page)).toHaveCount(0);
  await page.locator('#dock-btn-settings').click();
  await expect(page.locator('#site-settings-overlay .site-settings-body')).toBeVisible();
  await expect(page.locator('[data-halloween-replay]')).toHaveCount(0);
});
