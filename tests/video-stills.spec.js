// Video stills on the page (v1.2; the owner's performance card, 2026-11-17).
//
// Owner: "For videos that takes time to load, there should be a thumbnail that
// stands in place for those videos with the exact dimension it has." The
// nightly job saves each video's first frame and size (video-stills-mirror.
// spec.js has the job). Here, the page: a video in the list gets its real
// shape before any of it arrives, and its still once it is within three
// screens.
//
// Every video request is held and never answered, so a still is the only
// picture a reader could be seeing. The list and the stills are this test's
// own, and the database is refused, so the page renders no videos of its own.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const PAGE = '/characters/Template/';
// A real clip, for the one test that lets a video arrive. Range-aware, for
// the reason clip-corner-and-queue.spec.js gives.
const CLIP = fs.readFileSync(path.join(__dirname, '..', 'medias', 'videos', 'example-video5.webm'));
function serveClip(route) {
    const range = route.request().headers()['range'];
    if (!range) return route.fulfill({ status: 200, headers: { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes' }, body: CLIP });
    const [, from, to] = /bytes=(\d*)-(\d*)/.exec(range) || [];
    const start = from ? parseInt(from, 10) : 0;
    const end = to ? parseInt(to, 10) : CLIP.length - 1;
    return route.fulfill({
        status: 206,
        headers: { 'Content-Type': 'video/webm', 'Content-Range': `bytes ${start}-${end}/${CLIP.length}`, 'Accept-Ranges': 'bytes' },
        body: CLIP.subarray(start, end + 1),
    });
}
const STORE = 'https://example.supabase.co/storage/v1/object/public/wiki-media/';
const still = (c) => `medias/stills/${c.repeat(16)}.webp`;

// A still the shape its list entry says, as the job makes them. A poster that
// has loaded gives a video its shape too, so a still of the wrong shape would
// hide whether the list did.
async function stillBytes(page, [width, height]) {
    await page.setContent('<!doctype html><html><body></body></html>');
    const b64 = await page.evaluate(async ({ width, height }) => {
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#c03030';
        ctx.fillRect(0, 0, width, height);
        const view = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/webp' })).arrayBuffer());
        let s = '';
        for (const b of view) s += String.fromCharCode(b);
        return btoa(s);
    }, { width, height });
    return Buffer.from(b64, 'base64');
}

async function boot(page, { list = {}, listStatus = 200, holdList = false, arrives = [], stillShape = [64, 36], holdStills = false } = {}) {
    const body = await stillBytes(page, stillShape);
    const net = { stills: [], errors: [], listAsked: 0 };
    page.on('pageerror', (e) => net.errors.push(e.message));

    let releaseList = () => {};
    const listReady = holdList ? new Promise((resolve) => { releaseList = resolve; }) : Promise.resolve();
    net.releaseList = () => releaseList();

    await page.route('**/rest/v1/**', (route) => route.abort());
    // Held, so the video never arrives, unless the test names it in `arrives`.
    await page.route(`${STORE}**`, (route) => {
        if (arrives.includes(decodeURIComponent(route.request().url().split('/').pop()))) return serveClip(route);
    });
    await page.route('**/medias/stills/*.webp', (route) => {
        net.stills.push(new URL(route.request().url()).pathname.split('/').pop());
        if (holdStills) return; // asked for, never answered
        return route.fulfill({ status: 200, contentType: 'image/webp', body });
    });
    await page.route('**/data/video-stills.json*', async (route) => {
        net.listAsked++;
        await listReady;
        if (listStatus !== 200) return route.fulfill({ status: listStatus, body: '' });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) });
    });

    await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.wikiClipHTML === 'function'
        && typeof window.initLazyMedia === 'function', null, { timeout: 45000 });
    return net;
}

// Videos in a fixed host, each 320px wide at a top given in screen heights,
// so where one sits relative to the screen is exact. `skill` puts it in a
// skill card's media box, the way js/framedata.js does.
async function place(page, items) {
    await page.evaluate(({ items }) => {
        let host = document.getElementById('vs-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'vs-host';
            Object.assign(host.style, { position: 'fixed', top: '0', left: '0', width: '100%', height: '0', zIndex: '10000' });
            document.body.appendChild(host);
        }
        const h = window.innerHeight;
        const batch = document.createElement('div');
        items.forEach(({ name, url, at, left = 20, skill = false }) => {
            const slot = document.createElement('div');
            slot.className = 'vs-slot';
            slot.dataset.name = name;
            Object.assign(slot.style, { position: 'absolute', top: `${Math.round(at * h)}px`, left: `${left}px`, width: '320px' });
            slot.innerHTML = skill
                ? `<div class="skill-media-wrapper">${window.wikiClipHTML(url, { className: 'skill-media-img' })}</div>`
                : window.wikiClipHTML(url);
            batch.appendChild(slot);
        });
        host.appendChild(batch);
        window.initLazyMedia(batch);
    }, { items });
}

const video = (page, name) => page.locator(`.vs-slot[data-name="${name}"] video`);
// Height over width of the video's box, as drawn.
const shapeOf = async (locator) => {
    const box = await locator.boundingBox();
    return Math.round(box.height / box.width * 1000) / 1000;
};
// A video the browser knows nothing about yet keeps its default height,
// 150px, whatever its width.
const heightOf = async (locator) => Math.round((await locator.boundingBox()).height);
const DEFAULT_HEIGHT = 150;
const moveTo = (page, name, screens) => page.evaluate(({ name, screens }) => {
    document.querySelector(`.vs-slot[data-name="${name}"]`).style.top = `${Math.round(screens * window.innerHeight)}px`;
}, { name, screens });
// Long enough for the observers to have answered: two frames, then a beat.
const settle = (page) => page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 150)))));

test('a video in the list has its real shape before any of it arrives, and its still stands in for it', async ({ page }) => {
    // The still is asked for and held back too: a poster that has loaded
    // gives a video its shape, so here only the list can.
    const net = await boot(page, { list: { 'Wide Clip.webm': { still: still('a'), w: 1920, h: 1080, etag: '"1"' } }, holdStills: true });
    await place(page, [
        { name: 'listed', url: `${STORE}Wide%20Clip.webm`, at: 0.1 },
        { name: 'unlisted', url: `${STORE}Not%20Listed.webm`, at: 0.1, left: 380 },
    ]);

    const listed = video(page, 'listed');
    await expect(listed).toHaveAttribute('poster', new RegExp(`${still('a')}$`));
    await expect.poll(() => shapeOf(listed), 'the video\'s own 16:9').toBeCloseTo(1080 / 1920, 2);
    expect((await listed.boundingBox()).width, 'still the width the page gives it').toBeCloseTo(320, 0);
    // Nothing of the video has arrived, so what the reader sees is the still.
    expect(await listed.evaluate((v) => v.readyState)).toBe(0);
    await expect.poll(() => net.stills).toEqual([`${'a'.repeat(16)}.webp`]);

    // A video the list does not have draws as before: the browser's default
    // 150px box until its own size arrives, which is the jump this removes.
    const unlisted = video(page, 'unlisted');
    expect(await unlisted.getAttribute('poster')).toBeNull();
    expect(await heightOf(unlisted)).toBe(DEFAULT_HEIGHT);
    expect(net.errors).toEqual([]);
});

test('a video far down the page gets its shape at once, and its still only when the reader comes within three screens', async ({ page }) => {
    const net = await boot(page, { list: { 'Far.webm': { still: still('b'), w: 640, h: 480, etag: '"1"' } }, stillShape: [64, 48] });
    await place(page, [{ name: 'far', url: `${STORE}Far.webm`, at: 6 }]);

    const far = video(page, 'far');
    await expect.poll(() => shapeOf(far), 'its shape at once').toBeCloseTo(480 / 640, 2);
    await settle(page);
    expect(await far.getAttribute('poster'), 'six screens down: not yet').toBeNull();
    expect(net.stills).toEqual([]);

    await moveTo(page, 'far', 2.5);
    await expect(far).toHaveAttribute('poster', new RegExp(`${still('b')}$`));
    await expect.poll(() => net.stills).toEqual([`${'b'.repeat(16)}.webp`]);
});

test('a list that arrives after the page has drawn still gives each video its shape and its still', async ({ page }) => {
    const net = await boot(page, { list: { 'Late.webm': { still: still('c'), w: 1280, h: 720, etag: '"1"' } }, holdList: true });
    await place(page, [{ name: 'late', url: `${STORE}Late.webm`, at: 0.1 }]);

    const late = video(page, 'late');
    await settle(page);
    expect(await heightOf(late), 'drawn while the list is on its way').toBe(DEFAULT_HEIGHT);

    net.releaseList();
    await expect.poll(() => shapeOf(late)).toBeCloseTo(720 / 1280, 2);
    await expect(late).toHaveAttribute('poster', new RegExp(`${still('c')}$`));
});

test('a skill card\'s clip keeps its card\'s shape, with the still inside it', async ({ page }) => {
    // The card's box is set in CSS (16:9 here), which wins over the video's
    // own size: a square clip must not stretch the card.
    await boot(page, { list: { 'Square.webm': { still: still('d'), w: 1000, h: 1000, etag: '"1"' } }, stillShape: [36, 36] });
    await place(page, [{ name: 'card', url: `${STORE}Square.webm`, at: 0.1, skill: true }]);

    const clip = video(page, 'card');
    await expect(clip).toHaveAttribute('poster', new RegExp(`${still('d')}$`));
    const box = await clip.boundingBox();
    expect(Math.abs(box.height - box.width * 9 / 16), `the card's 16:9, not the clip's 1:1 (${box.width}x${box.height})`).toBeLessThan(2);
});

test('once a video arrives, its own shape wins over a list that is out of date', async ({ page }) => {
    // The list is a night old at worst: a file replaced today keeps
    // yesterday's size in it until the next run. Here it says square, and so
    // does its still, so only the video itself can make the box any other shape.
    await boot(page, { list: { 'Real.webm': { still: still('f'), w: 1000, h: 1000, etag: '"1"' } }, arrives: ['Real.webm'], stillShape: [36, 36] });
    await place(page, [{ name: 'real', url: `${STORE}Real.webm`, at: 0.1 }]);

    const real = video(page, 'real');
    await expect.poll(() => real.evaluate((v) => v.readyState), { timeout: 15000 }).toBeGreaterThan(0);
    const own = await real.evaluate((v) => v.videoHeight / v.videoWidth);
    expect(Math.abs(own - 1), 'the clip itself is not square').toBeGreaterThan(0.1);
    await expect.poll(() => shapeOf(real)).toBeCloseTo(own, 2);
});

test('an entry that names anything but a still of ours, or has no size, is ignored', async ({ page }) => {
    await boot(page, { list: {
        'Elsewhere.webm': { still: 'https://elsewhere.example/x.webp', w: 100, h: 100 },
        'Climbing.webm': { still: '../../../x.webp', w: 100, h: 100 },
        'NoSize.webm': { still: still('e'), w: 0, h: 100 },
    } });
    await place(page, [
        { name: 'elsewhere', url: `${STORE}Elsewhere.webm`, at: 0.1 },
        { name: 'climbing', url: `${STORE}Climbing.webm`, at: 0.1, left: 360 },
        { name: 'nosize', url: `${STORE}NoSize.webm`, at: 0.1, left: 700 },
    ]);
    await settle(page);
    for (const name of ['elsewhere', 'climbing', 'nosize']) {
        expect(await video(page, name).getAttribute('poster'), name).toBeNull();
        expect(await heightOf(video(page, name)), name).toBe(DEFAULT_HEIGHT);
    }
});

test('a page with none of the wiki\'s own videos never asks for the list', async ({ page }) => {
    // The home page draws its posts through initLazyMedia too, and has a
    // speed target of its own.
    const net = await boot(page, { list: { 'Ours.webm': { still: still('a'), w: 640, h: 360, etag: '"1"' } } });
    await page.route('**/__elsewhere__/**', () => { /* held */ });
    await place(page, [{ name: 'other', url: '/__elsewhere__/clip.webm', at: 0.1 }]);
    await settle(page);
    expect(net.listAsked, 'no video of ours on the page yet').toBe(0);

    await place(page, [{ name: 'ours', url: `${STORE}Ours.webm`, at: 0.1, left: 380 }]);
    await expect.poll(() => net.listAsked).toBe(1);
    await expect.poll(() => shapeOf(video(page, 'ours'))).toBeCloseTo(360 / 640, 2);
});

test('without the list, every video draws as it did before', async ({ page }) => {
    const net = await boot(page, { listStatus: 404 });
    await place(page, [{ name: 'plain', url: `${STORE}Plain.webm`, at: 0.1 }]);
    await settle(page);
    expect(await video(page, 'plain').getAttribute('poster')).toBeNull();
    expect(await heightOf(video(page, 'plain'))).toBe(DEFAULT_HEIGHT);
    expect(net.errors).toEqual([]);
});
