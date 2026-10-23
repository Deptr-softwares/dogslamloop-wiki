// The Halloween update's Update Log entry is hidden until the reader has been
// through the minigame (owner, 2026-10-23: "visible only after the minigame,
// or if the person scrolling has reduce-motion, so they skip the game"). An
// entry carries "revealedBy": "halloween" for that. From November 1, when the
// event is over, it shows to everyone.
//
// updates.json is this test's own, so nothing here reads the real log. Dates
// are on a fixed clock, so nothing turns red in November.
const { test, expect } = require('@playwright/test');

test.use({ timezoneId: 'UTC' });
const DURING = new Date('2026-10-25T12:00:00Z');
const AFTER = new Date('2026-11-01T00:00:01Z');

const UPDATES = {
  changelogs: [
    { version: 'Zzq Spooky', date: '10/30/2026', type: 'site', title: 'Zzq Halloween entry', description: 'd', changes: ['one'], revealedBy: 'halloween' },
    { version: 'Zzq Plain', date: '10/22/2026', type: 'site', title: 'Zzq Ordinary entry', description: 'd', changes: ['two'] },
  ],
};

async function open(page, url, { at = DURING, played = false } = {}) {
  await page.clock.setFixedTime(at);
  await page.route(/data\/updates\.json/, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(UPDATES) }));
  await page.addInitScript((played) => {
    try { if (played) localStorage.setItem('dsl_halloween_done', '1'); } catch (e) { /* ignore */ }
  }, played);
  await page.goto(url, { waitUntil: 'networkidle' });
}

for (const [where, url, list] of [
  ['the Main Dashboard', '/', '#site-updates-dashboard'],
  ['the Update Log page', '/systems/updatelog/', '#changelog-container'],
]) {
  test(`${where}: hidden before the minigame, shown after it, without a reload`, async ({ page }) => {
    await open(page, url);
    const box = page.locator(list);
    await expect(box).toContainText('Zzq Ordinary entry');
    await expect(box).not.toContainText('Zzq Halloween entry');

    // What the minigame calls as it fades out.
    await page.evaluate(() => window.halloween.lookOn());
    await expect(box).toContainText('Zzq Halloween entry');
    await expect(box).toContainText('Zzq Ordinary entry');
  });

  test(`${where}: shown to a reader who has played`, async ({ page }) => {
    await open(page, url, { played: true });
    await expect(page.locator(list)).toContainText('Zzq Halloween entry');
  });

  test(`${where}: shown to everyone from November 1`, async ({ page }) => {
    await open(page, url, { at: AFTER });
    await expect(page.locator(list)).toContainText('Zzq Halloween entry');
  });
}
