// Flagged media stops rendering (v0.13 item 1, the enforcement half).
//
// The live pages render contributor media from seven places across five files
// - skill cards, image blocks, video blocks, profile portraits, gallery
// items, roster cards, tier portraits. Rather than teach all seven about
// moderation and rely on the eighth remembering, the guard works on the DOM:
// sweep what is there, observe what arrives.
//
// The two properties worth pinning hardest are the ones that decide whether
// this is safe to ship at all:
//
//   * nothing flagged means nothing runs - no observer on any normal page
//   * a moderation table that cannot be read fails OPEN, because the failure
//     mode of guessing the other way is blanking every image on the wiki
const { test, expect } = require('@playwright/test');

const BUCKET = 'https://gtqswjspxymjdopljmfi.supabase.co/storage/v1/object/public/wiki-media';

// Installed before any script runs, so the guard's own fetch is intercepted
// rather than reaching a real table that does not exist until the migration
// is merged.
async function mockModeration(page, { flagged = [], fail = false } = {}) {
    await page.addInitScript(({ flagged, fail }) => {
        window.__moderationQueries = 0;
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
                            if (table !== 'media_moderation') return origFrom(table);
                            window.__moderationQueries += 1;
                            return {
                                select() { return this; },
                                eq: async () => (fail
                                    ? { data: null, error: { message: 'permission denied' } }
                                    : { data: flagged.map(path => ({ path })), error: null }),
                            };
                        };
                        return client;
                    };
                    lib.__patched = true;
                }
            },
        });
    }, { flagged, fail });
}

// A page that loads site_utils.js, with media added by hand so the test does
// not depend on what any particular character page happens to contain.
async function openWithMedia(page, sources) {
    await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
    await page.evaluate((srcs) => {
        const host = document.createElement('div');
        host.id = 'media-test-host';
        host.innerHTML = srcs.map(src => `<img src="${src}" class="wiki-block-image">`).join('');
        document.body.appendChild(host);
    }, sources);
}

test('a flagged file is replaced with a notice', async ({ page }) => {
    await mockModeration(page, { flagged: ['Bad.webp'] });
    await openWithMedia(page, [`${BUCKET}/Bad.webp`, `${BUCKET}/Fine.webp`]);

    await expect(page.locator('#media-test-host .media-blocked-notice')).toHaveCount(1);
    await expect(page.locator('#media-test-host .media-blocked-notice')).toContainText('removed by a moderator');

    // The one that was not flagged is untouched.
    const remaining = await page.locator('#media-test-host img').evaluateAll(els => els.map(e => e.getAttribute('src')));
    expect(remaining).toEqual([`${BUCKET}/Fine.webp`]);
});

test('media added after boot is caught too', async ({ page }) => {
    // Tab switches, mode toggles and lazy renders all build media long after
    // DOMContentLoaded. A sweep-once guard would miss every one of them.
    await mockModeration(page, { flagged: ['Later.webp'] });
    await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

    await page.evaluate((url) => {
        const host = document.createElement('div');
        host.id = 'late-host';
        host.innerHTML = `<img src="${url}" class="wiki-block-image">`;
        document.body.appendChild(host);
    }, `${BUCKET}/Later.webp`);

    await expect(page.locator('#late-host .media-blocked-notice')).toHaveCount(1);
    await expect(page.locator('#late-host img')).toHaveCount(0);
});

test('a lazy video is caught before it ever loads', async ({ page }) => {
    // Videos carry their real URL in data-lazy-src until something scrolls
    // them into view, so checking src alone would let a flagged clip sit on
    // the page until the moment it started playing.
    await mockModeration(page, { flagged: ['Clip.webm'] });
    await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

    await page.evaluate((url) => {
        const host = document.createElement('div');
        host.id = 'video-host';
        host.innerHTML = `<video data-lazy-src="${url}" preload="none"></video>`;
        document.body.appendChild(host);
    }, `${BUCKET}/Clip.webm`);

    await expect(page.locator('#video-host .media-blocked-notice')).toHaveCount(1);
    await expect(page.locator('#video-host video')).toHaveCount(0);
});

test('a percent-encoded url matches the file it points at', async ({ page }) => {
    // The same object is stored raw in some rows and encoded in others.
    await mockModeration(page, { flagged: ['Big Slam.webp'] });
    await openWithMedia(page, [`${BUCKET}/Big%20Slam.webp`]);

    await expect(page.locator('#media-test-host .media-blocked-notice')).toHaveCount(1);
});

test('a query string does not hide a flagged file', async ({ page }) => {
    await mockModeration(page, { flagged: ['Cached.webp'] });
    await openWithMedia(page, [`${BUCKET}/Cached.webp?v=12345`]);

    await expect(page.locator('#media-test-host .media-blocked-notice')).toHaveCount(1);
});

test('nothing flagged means no observer and no cost', async ({ page }) => {
    // The reason this is acceptable to run on every page of the site. If it
    // ever starts observing unconditionally, every page pays for a feature
    // almost nothing uses.
    await mockModeration(page, { flagged: [] });
    await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

    const guard = await page.evaluate(async () => await window.initBlockedMediaGuard());
    expect(guard).toBe(null);

    await openWithMedia(page, [`${BUCKET}/Anything.webp`]);
    await expect(page.locator('#media-test-host img')).toHaveCount(1);
    await expect(page.locator('.media-blocked-notice')).toHaveCount(0);
});

test('a moderation table it cannot read fails open, not closed', async ({ page }) => {
    // Deliberate: a policy regression or an outage must not blank every image
    // on the wiki. Flagged media staying visible is the lesser failure.
    await mockModeration(page, { fail: true });
    await openWithMedia(page, [`${BUCKET}/Whatever.webp`]);

    await expect(page.locator('#media-test-host img')).toHaveCount(1);
    await expect(page.locator('.media-blocked-notice')).toHaveCount(0);
});

test('the flagged list is fetched once, not once per caller', async ({ page }) => {
    await mockModeration(page, { flagged: ['Bad.webp'] });
    await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

    await page.evaluate(async () => {
        await Promise.all([window.fetchBlockedMedia(), window.fetchBlockedMedia(), window.fetchBlockedMedia()]);
    });

    // One query for the boot call, and the three above share it.
    expect(await page.evaluate(() => window.__moderationQueries)).toBe(1);
});

test('a file that merely contains a flagged name is not blocked', async ({ page }) => {
    // Matching on the trailing segment, not a substring of the whole URL -
    // otherwise flagging "Slam.webp" would take out "BigSlam.webp" as well.
    await mockModeration(page, { flagged: ['Slam.webp'] });
    await openWithMedia(page, [`${BUCKET}/BigSlam.webp`, `${BUCKET}/Slam.webp`]);

    await expect(page.locator('#media-test-host .media-blocked-notice')).toHaveCount(1);
    const remaining = await page.locator('#media-test-host img').evaluateAll(els => els.map(e => e.getAttribute('src')));
    expect(remaining).toEqual([`${BUCKET}/BigSlam.webp`]);
});
