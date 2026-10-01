// The corner play button on autoplaying clips (v0.20 V1), and the order clips
// load in (v0.20 V2 fix 3). Tested together because both change how a clip
// loads and plays.
//
// V1, in the owner's words: "On autoplaying video, give the option (as a small
// play button in the corner of that video) to open up a modal that play the
// video with controls on".
//
// V2 fix 3, measured on Puppet Master on 2026-09-28: clips started loading
// 300px ahead of the screen and a grid of them shared the connection, so a
// 0.31 MB clip waited 4.9s behind a 4.24 MB one. Now two start at a time,
// nearest first, from two screens ahead, and a loop plays only while it is on
// screen. A held response keeps a clip from ever being able to play through,
// so in these tests "started" and "downloading" are the same thing.
//
// Every clip is one committed file served through page.route, never through
// the shared dev server (media-player.spec.js has why). Supabase's REST API is
// refused, so the page renders no clips of its own: the queue belongs to the
// whole page, and one real clip in it would take a slot these tests count.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const PAGE = '/characters/Template/';
const CLIP_FILE = path.join(__dirname, '..', 'medias', 'videos', 'example-video5.webm');
const BASE = '/__clip-queue__/';

// Range-aware, for the reason media-player.spec.js gives: a plain 200 leaves a
// video unseekable, and a loop has to seek back to its start.
let clipBytes = null;
function serve(route) {
  if (!clipBytes) clipBytes = fs.readFileSync(CLIP_FILE);
  const total = clipBytes.length;
  const range = route.request().headers()['range'];
  if (!range) {
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'video/webm', 'Content-Length': String(total), 'Accept-Ranges': 'bytes' },
      body: clipBytes,
    });
  }
  const match = /bytes=(\d*)-(\d*)/.exec(range) || [];
  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? parseInt(match[2], 10) : total - 1;
  const chunk = clipBytes.slice(start, end + 1);
  return route.fulfill({
    status: 206,
    headers: {
      'Content-Type': 'video/webm',
      'Content-Length': String(chunk.length),
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
    },
    body: chunk,
  });
}

// Every clip request is recorded, once per name, in the order first asked for.
// A name in `hold` gets no answer until the test releases it: a download kept
// in progress for exactly as long as the test needs.
async function boot(page, { hold = [] } = {}) {
  const net = { requested: [], held: new Map(), holding: new Set(hold) };
  net.release = async (name) => {
    net.holding.delete(name);
    const route = net.held.get(name);
    net.held.delete(name);
    if (route) await serve(route);
  };

  await page.route('**/rest/v1/**', r => r.abort());
  await page.route(`**${BASE}**`, (route) => {
    const name = route.request().url().split('/').pop().replace(/\.webm$/, '');
    if (!net.requested.includes(name)) net.requested.push(name);
    if (net.holding.has(name)) { net.held.set(name, route); return; }
    return serve(route);
  });

  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.wikiClipHTML === 'function'
    && typeof window.initLazyMedia === 'function', { timeout: 45000 });
  return net;
}

// Clips in a fixed host, each placed at a top given in screen heights, so
// where a clip sits relative to the screen is exact and the page arriving
// underneath cannot move it. Below the video modal (10050), as page content is.
async function placeClips(page, clips) {
  await page.evaluate(({ clips, base }) => {
    let host = document.getElementById('cq-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'cq-host';
      Object.assign(host.style, { position: 'fixed', top: '0', left: '0', width: '100%', height: '0', zIndex: '10000' });
      document.body.appendChild(host);
    }
    const h = window.innerHeight;
    const batch = document.createElement('div');
    clips.forEach(({ name, at, left }) => {
      const slot = document.createElement('div');
      slot.className = 'cq-slot';
      slot.dataset.name = name;
      Object.assign(slot.style, { position: 'absolute', top: `${Math.round(at * h)}px`, left: `${left || 20}px`, width: '320px' });
      slot.innerHTML = window.wikiClipHTML(`${base}${name}.webm`);
      batch.appendChild(slot);
    });
    host.appendChild(batch);
    window.initLazyMedia(batch);
  }, { clips, base: BASE });
}

const clipVideo = (page, name) => page.locator(`.cq-slot[data-name="${name}"] video`);
const moveClip = (page, name, screens) => page.evaluate(({ name, screens }) => {
  document.querySelector(`.cq-slot[data-name="${name}"]`).style.top = `${Math.round(screens * window.innerHeight)}px`;
}, { name, screens });
const isPlaying = (video) => video.evaluate(v => !v.paused && v.currentTime > 0);

// --- 4.1: THE CORNER BUTTON ---

test('every place a clip renders gives it one corner button, and each opens its own clip', async ({ page }) => {
  await boot(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // Gallery pages have their own script, which a character page does not load.
  await page.addScriptTag({ url: '/js/gallery.js' });

  await page.evaluate(async (base) => {
    const host = document.createElement('div');
    host.id = 'cq-renderers';
    Object.assign(host.style, { position: 'fixed', top: '0', left: '0', zIndex: '10000', display: 'flex', gap: '12px', padding: '12px' });
    document.body.appendChild(host);
    const slot = (name) => {
      const s = document.createElement('div');
      s.className = 'cq-slot';
      s.dataset.name = name;
      s.style.width = '240px';
      host.appendChild(s);
      return s;
    };
    const tab = (id) => document.getElementById(id) || document.body.appendChild(Object.assign(document.createElement('div'), { id }));

    // The video block.
    slot('block').innerHTML = window.generateHTMLForBlocks([{ type: 'video', src: `${base}block.webm` }], '');

    // Skill-card media, through the real card renderer.
    tab('tab-skills');
    window.cachedMasterFrameData = window.cachedMasterFrameData || {};
    window.cachedMasterFrameData.cqchar = { skills: [{ id: 's', name: 'Clip', media: { src: `${base}skill.webm` }, stats: [] }] };
    await window.loadMoveSection('cqchar', 'skills', null, 'character');
    slot('skill').appendChild(document.querySelector('#tab-skills .skill-media-wrapper'));

    // The character Gallery tab.
    tab('tab-gallery');
    window.renderCharacterGalleryTab({ gallery: [{ name: 'Idle', src: `${base}char-gallery.webm` }] });
    slot('char-gallery').appendChild(document.querySelector('#tab-gallery .gallery-card'));

    // A gallery page's card.
    slot('gallery').appendChild(window.galleryInternals.buildGalleryCard({ name: 'Wave', src: `${base}gallery.webm` }));
  }, BASE);

  const modal = page.locator('#wiki-video-modal');
  for (const name of ['block', 'skill', 'char-gallery', 'gallery']) {
    const slot = page.locator(`#cq-renderers .cq-slot[data-name="${name}"]`);
    await expect(slot.locator('.wiki-clip > video'), name).toHaveCount(1);
    await expect(slot.locator('.wiki-clip > .wiki-clip-open'), name).toHaveCount(1);

    // A real click: Playwright refuses one that lands on anything else, so
    // this also proves nothing in the frame covers the button.
    await slot.locator('.wiki-clip-open').click();
    await expect(modal, name).toBeVisible();
    await expect(modal.locator('video'), name).toHaveAttribute('src', `${BASE}${name}.webm`);
    await expect(modal.locator('[data-player-toggle]'), 'the player has its controls').toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
  }
  expect(errors).toEqual([]);
});

test('the player plays with sound, and the clip keeps looping under it', async ({ page }) => {
  await boot(page);
  await placeClips(page, [{ name: 'loop', at: 0.1 }]);
  const loop = clipVideo(page, 'loop');
  await expect.poll(() => isPlaying(loop), { timeout: 15000 }).toBe(true);

  await page.locator('.cq-slot[data-name="loop"] .wiki-clip-open').click();
  const player = page.locator('#wiki-video-modal video');
  await expect.poll(() => isPlaying(player), { timeout: 15000 }).toBe(true);
  expect(await player.evaluate(v => v.muted), 'the clip is muted; the player is not').toBe(false);

  const t = await loop.evaluate(v => v.currentTime);
  await expect.poll(() => loop.evaluate((v, t) => !v.paused && v.currentTime !== t, t)).toBe(true);
});

// --- 4.2: THE LOAD ORDER ---

test('clips start two at a time, nearest first, from two screens ahead', async ({ page }) => {
  const net = await boot(page, { hold: ['near1', 'near2', 'mid', 'far'] });
  // Written in the reverse of their distance, so a queue that took clips in
  // page order would start the two farthest instead.
  await placeClips(page, [
    { name: 'beyond', at: 4 },
    { name: 'far', at: 2.6 },
    { name: 'mid', at: 1.6 },
    { name: 'near2', at: 0.5, left: 380 },
    { name: 'near1', at: 0.05 },
  ]);

  await expect.poll(() => net.requested.slice().sort()).toEqual(['near1', 'near2']);
  // Both slots are held until a download finishes, so nothing else can have
  // started. Read off the page, not inferred from a quiet network.
  for (const name of ['mid', 'far', 'beyond']) {
    await expect(clipVideo(page, name), `${name} waits its turn`).toHaveAttribute('data-lazy-src', /.+/);
  }

  // One slot frees; the nearer of the two waiting clips takes it.
  await net.release('near1');
  await expect.poll(() => net.requested).toContain('mid');
  expect(net.requested, 'far is further than mid').not.toContain('far');

  // 2.6 screens down is inside the reach, which the old 300px never was.
  await net.release('near2');
  await expect.poll(() => net.requested).toContain('far');

  // Four screens down is not. With every download finished, a slot is free
  // and the clip is still not asked for; the settle covers the moment between
  // a clip becoming ready and its slot being handed on.
  await net.release('mid');
  await net.release('far');
  for (const name of ['mid', 'far']) {
    await expect.poll(() => clipVideo(page, name).evaluate(v => v.readyState), { timeout: 15000 }).toBe(4);
  }
  await page.waitForTimeout(500);
  await expect(clipVideo(page, 'beyond')).toHaveAttribute('data-lazy-src', /.+/);
  expect(net.requested).not.toContain('beyond');

  // And it joins as soon as the reader comes within two screens of it.
  await moveClip(page, 'beyond', 2.5);
  await expect.poll(() => net.requested).toContain('beyond');
});

test('a loop plays only while it is on screen', async ({ page }) => {
  await boot(page);
  await placeClips(page, [{ name: 'loop', at: 0.1 }]);
  const loop = clipVideo(page, 'loop');
  await expect.poll(() => isPlaying(loop), { timeout: 15000 }).toBe(true);

  await moveClip(page, 'loop', 2);
  await expect.poll(() => loop.evaluate(v => v.paused)).toBe(true);
  const stoppedAt = await loop.evaluate(v => v.currentTime);

  await moveClip(page, 'loop', 0.1);
  await expect.poll(() => loop.evaluate((v, t) => !v.paused && v.currentTime !== t, stoppedAt)).toBe(true);
});

test('the button plays a clip the queue has not reached yet', async ({ page }) => {
  const net = await boot(page, { hold: ['busy1', 'busy2'] });
  await placeClips(page, [{ name: 'busy1', at: 0.05 }, { name: 'busy2', at: 0.05, left: 380 }]);
  await expect.poll(() => net.requested.slice().sort()).toEqual(['busy1', 'busy2']);

  // Both slots are taken and held, so this clip queues and stays queued.
  await placeClips(page, [{ name: 'waiting', at: 0.45 }]);
  await expect(clipVideo(page, 'waiting')).toHaveAttribute('data-lazy-src', /.+/);
  await page.locator('.cq-slot[data-name="waiting"] .wiki-clip-open').click();

  const player = page.locator('#wiki-video-modal video');
  await expect.poll(() => isPlaying(player), { timeout: 15000 }).toBe(true);
  expect(net.requested).toContain('waiting');
});
