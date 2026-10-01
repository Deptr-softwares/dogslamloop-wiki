// Media that fails to load shows "[ Missing Media ]" (v0.20 batch 3, item 3.5).
//
// 86 of the 466 files the wiki linked to did not exist on 2026-09-28. A reader
// saw a broken-image icon, or for a video an empty box that looked like it was
// still loading. The missing files here are answered by the local server with a
// real 404, so the failure is the browser's own, not a simulated event.
const { test, expect } = require('@playwright/test');

const PAGE = '/characters/Boomcat/index.html';
const MISSING_IMG = '/medias/images/__missing-media-probe__.webp';
const MISSING_VID = '/medias/images/__missing-media-probe__.webm';
const REAL_IMG = '/medias/images/DogslamloopIcon.webp';

async function boot(page) {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.generateHTMLForBlocks === 'function'
        && typeof window.initLazyMedia === 'function', { timeout: 45000 });
}

// A host pinned in the viewport, so the lazy loader sees the videos at once
// and the live page arriving underneath cannot move them.
async function renderHost(page, html) {
    await page.evaluate((html) => {
        const host = document.createElement('div');
        host.id = 'mm-host';
        Object.assign(host.style, { position: 'fixed', top: '60px', left: '300px', width: '600px',
            zIndex: '2147483000', background: '#000', maxHeight: '80vh', overflow: 'auto' });
        host.innerHTML = html;
        document.body.appendChild(host);
        window.initLazyMedia(host);
    }, html);
}

test('a failed image and a failed video become the notice; a working image stays', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await boot(page);

    const html = await page.evaluate(([missingImg, missingVid, realImg]) => window.generateHTMLForBlocks([
        { type: 'image', src: missingImg, alt: 'gone' },
        { type: 'image', src: missingImg, caption: 'captioned and gone' },
        { type: 'video', src: missingVid },
        { type: 'image', src: realImg, alt: 'here' },
    ], ''), ['/medias/images/__missing-media-probe__.webp', '/medias/images/__missing-media-probe__.webm', '/medias/images/DogslamloopIcon.webp']);
    await renderHost(page, html);

    const notices = page.locator('#mm-host .media-missing-notice');
    await expect(notices).toHaveCount(3);
    await expect(notices.first()).toHaveText('[ Missing Media ]');
    expect(await notices.evaluateAll(n => n.map(x => x.title).sort()))
        .toEqual(['__missing-media-probe__.webm', '__missing-media-probe__.webp', '__missing-media-probe__.webp']);

    // Painted as the notice: dashed, visible, not a zero-height leftover.
    const look = await notices.first().evaluate(el => {
        const cs = getComputedStyle(el);
        return { dashed: cs.borderTopStyle, height: el.getBoundingClientRect().height };
    });
    expect(look.dashed).toBe('dashed');
    expect(look.height).toBeGreaterThan(40);

    // No broken element survives, and the working image is untouched.
    await expect(page.locator(`#mm-host img[src="${MISSING_IMG}"]`)).toHaveCount(0);
    await expect(page.locator('#mm-host video')).toHaveCount(0);
    // The clip's corner button (v0.20 V1) goes with it: a player for a file
    // that does not exist would open onto nothing.
    await expect(page.locator('#mm-host .wiki-clip-open')).toHaveCount(0);
    await expect(page.locator('#mm-host .wiki-clip')).toHaveCount(0);
    const real = page.locator(`#mm-host img[src="${REAL_IMG}"]`);
    await expect(real).toHaveCount(1);
    await expect.poll(() => real.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
    expect(errors).toEqual([]);
});

test('in a skill card the notice fills the frame the video had', async ({ page }) => {
    await boot(page);
    await renderHost(page, `<div class="skill-media-wrapper" style="width: 320px">
        <video class="skill-media-img" data-lazy-src="${MISSING_VID}" autoplay loop muted playsinline preload="none"></video></div>`);

    const notice = page.locator('#mm-host .skill-media-wrapper > .media-missing-notice');
    await expect(notice).toHaveCount(1);
    const [frame, box] = await Promise.all([
        page.locator('#mm-host .skill-media-wrapper').evaluate(el => el.getBoundingClientRect().height),
        notice.evaluate(el => el.getBoundingClientRect().height),
    ]);
    expect(frame).toBeGreaterThan(40);
    // Fills it, less the frame's own border: structure, not pixels.
    expect(box).toBeGreaterThan(frame * 0.9);
    expect(box).toBeLessThanOrEqual(frame);
});

test('a missing thread image replaces its link, which would lead nowhere', async ({ page }) => {
    await boot(page);
    await renderHost(page, `<div class="discussion-media"><a class="discussion-media-link" href="${MISSING_IMG}">`
        + `<img class="discussion-media-img" src="${MISSING_IMG}" alt=""></a></div>`);

    await expect(page.locator('#mm-host .discussion-media > .media-missing-notice')).toHaveCount(1);
    await expect(page.locator('#mm-host a.discussion-media-link')).toHaveCount(0);
});

test('media with its own fallback, and media that never started, are left alone', async ({ page }) => {
    await boot(page);
    await renderHost(page, `
        <img class="profile-portrait" src="${MISSING_IMG}" alt="">
        <div style="height: 3000px"></div>
        <video class="wiki-video-native" data-lazy-src="${MISSING_VID}" preload="none"></video>`);

    // Give the portrait's 404 time to arrive and be ignored.
    await expect.poll(() => page.locator('#mm-host img.profile-portrait')
        .evaluate(el => el.complete)).toBe(true);
    await expect(page.locator('#mm-host .media-missing-notice')).toHaveCount(0);
    await expect(page.locator('#mm-host img.profile-portrait')).toHaveCount(1);
    // Far below the fold, never requested: not a failure.
    await expect(page.locator('#mm-host video.wiki-video-native')).toHaveCount(1);
});
