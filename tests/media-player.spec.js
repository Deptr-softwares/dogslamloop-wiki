// The media surface - v0.15 items 10, 11 and 12.
//
//   10. A custom player for native <video>. Owner's call: native only, because
//       YouTube's controls cannot be restyled from outside the iframe. Sharp
//       play/pause and a duration bar, nothing else.
//   11. A wiki-media storage link pasted into a table cell renders as media -
//       an image sized down, a video as a button that opens a modal player.
//       The theorybox and the combo table's video column move to that button
//       too; both used to link straight out to the Supabase file.
//   12. Empty image and video blocks render a placeholder instead of a broken
//       box or, in the video case, nothing at all.
//
// Two claims carry the most risk and are tested hardest: that the player is
// only applied where the author asked for controls (a lot of existing pages
// rely on the silent autoplay loop), and that the storage-link check is a real
// allowlist rather than a substring match.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const PAGE = '/characters/Boomcat/index.html';
const CLIP = '/medias/videos/example-video5.webm';
const CLIP_FILE = path.join(__dirname, '..', 'medias', 'videos', 'example-video5.webm');

// Served from disk through Playwright rather than fetched from the dev server.
// playwright.config.js starts ONE python -m http.server that every worker
// shares, and it is single-threaded: four workers pulling a video through it
// at once made the playback tests fail under load and pass alone. Fulfilling
// per-context removes the shared bottleneck entirely.
// It answers RANGE requests, which is not optional. A plain 200 with the whole
// body leaves the element with `seekable` of [[0, 0]] - not seekable at all -
// so a seek test against it fails while the real site, where both the dev
// server and Supabase storage serve ranges, works perfectly. The harness was
// the thing that was broken.
let clipBytes = null;
async function serveClip(page) {
  if (!clipBytes) clipBytes = fs.readFileSync(CLIP_FILE);
  await page.route('**/example-video5.webm', (route) => {
    const total = clipBytes.length;
    const range = route.request().headers()['range'];

    if (!range) {
      return route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'video/webm',
          'Content-Length': String(total),
          'Accept-Ranges': 'bytes',
        },
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
  });
}
const BUCKET = 'https://gtqswjspxymjdopljmfi.supabase.co/storage/v1/object/public/wiki-media';

// A full character page, because the accent test needs js/site_meta.js to have
// themed :root for a real character. It is a heavy page and every worker
// shares one single-threaded dev server, so the wait is generous on purpose -
// the alternative is a spec that passes alone and scatters under load.
async function boot(page) {
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.generateHTMLForBlocks === 'function', { timeout: 45000 });
}

// Renders blocks through the real renderer into a host node, the way every
// caller does, and returns that node for querying.
async function render(page, blocks) {
  await page.evaluate((b) => {
    let host = document.getElementById('render-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'render-host';
      document.body.appendChild(host);
    }
    host.innerHTML = window.generateHTMLForBlocks(b, '');
  }, blocks);
  return page.locator('#render-host');
}

// --- ITEM 10: THE PLAYER ---

test('a video with controls on gets the player; one without keeps its silent loop', async ({ page }) => {
  await boot(page);

  const out = await page.evaluate(() => {
    const withControls = window.generateHTMLForBlocks([{ type: 'video', src: '/medias/a.webm', controls: true }], '');
    const without = window.generateHTMLForBlocks([{ type: 'video', src: '/medias/a.webm', controls: false }], '');
    const host = document.createElement('div');
    host.innerHTML = without;
    const loop = host.querySelector('video');
    return {
      withControlsHasPlayer: withControls.includes('data-wiki-player'),
      withoutHasPlayer: without.includes('data-wiki-player'),
      loopAutoplay: !!loop && loop.hasAttribute('autoplay'),
      loopMuted: !!loop && loop.hasAttribute('muted'),
      loopLoops: !!loop && loop.hasAttribute('loop'),
    };
  });

  expect(out.withControlsHasPlayer).toBe(true);
  // A block with controls off is a clip standing in for a GIF, and a great
  // many existing pages are built on that. Giving it a play button would be a
  // silent content change across the whole wiki.
  expect(out.withoutHasPlayer, 'an autoplay clip is left alone').toBe(false);
  expect(out.loopAutoplay).toBe(true);
  expect(out.loopMuted).toBe(true);
  expect(out.loopLoops).toBe(true);
});

test('youtube blocks are untouched', async ({ page }) => {
  await boot(page);

  const html = await page.evaluate(() =>
    window.generateHTMLForBlocks([{ type: 'youtube', videoId: 'dQw4w9WgXcQ' }], ''));

  // The owner chose native-only. YouTube keeps its iframe and its own
  // controls, so a change here is a change nobody asked for.
  expect(html).toContain('wiki-video-embed');
  expect(html).toContain('youtube.com/embed/dQw4w9WgXcQ');
  expect(html).not.toContain('data-wiki-player');
});

test('the play button drives the video and the duration bar fills', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await serveClip(page);
  await boot(page);

  // A file that REALLY EXISTS in the repo. The first version of this pointed
  // at a name that did not, so the video 404'd, play() rejected, and the whole
  // test rode on Chromium firing `play` before the error - green when run
  // alone and red under load. A player test on a video that never loads is
  // not a player test.
  await render(page, [{ type: 'video', src: CLIP, controls: true }]);

  // No metadata wait before the click: the source is lazy and `preload="none"`,
  // so nothing is loaded until the reader asks for it. Pressing play IS the
  // ask, and waiting for duration first would hang forever.
  const player = page.locator('#render-host [data-wiki-player]');
  await expect(player).toBeVisible();
  await expect(player).not.toHaveClass(/is-playing/);

  const glyphPaint = () => page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('#render-host .wiki-player-glyph'));
    return `${s.clipPath}|${s.backgroundImage}`;
  });
  const asPlay = await glyphPaint();

  await page.locator('#render-host [data-player-toggle]').click();

  await expect(player).toHaveClass(/is-playing/);

  // The class is only what should CAUSE the glyph to change. Read back what
  // the browser actually painted, because a rule that silently stopped
  // matching would leave a play triangle on a playing video and every
  // class-based assertion would still be green.
  const asPause = await glyphPaint();
  expect(asPause, 'the glyph really becomes a pause mark').not.toBe(asPlay);

  const label = await page.locator('#render-host [data-player-toggle]').getAttribute('aria-label');
  expect(label).toBe('Pause');

  // The duration bar is half the feature and the other half of this test's
  // name, and it was not being checked at all.
  await expect
    .poll(() => page.evaluate(() => {
      const fill = document.querySelector('#render-host [data-player-fill]');
      return parseFloat(fill.style.width) || 0;
    }), { timeout: 10000 })
    .toBeGreaterThan(0);

  await page.locator('#render-host [data-player-toggle]').click();
  await expect(player).not.toHaveClass(/is-playing/);
  expect(errors).toEqual([]);
});

test('clicking the duration bar seeks', async ({ page }) => {
  await serveClip(page);
  await boot(page);
  await render(page, [{ type: 'video', src: CLIP, controls: true }]);

  // Deliberately WITHOUT pressing play first. The source is lazy, so scrubbing
  // is a thing a reader can do to a video the browser has not opened yet - and
  // that used to be a no-op, which reads as a dead control.
  // locator.click with a position, NOT page.mouse.click with a bounding box:
  // the render host sits at the bottom of a full character page, so the bar
  // is below the viewport and raw coordinates land on nothing. A locator
  // scrolls to its target first.
  const track = page.locator('#render-host [data-player-track]');
  const width = await track.evaluate(el => el.getBoundingClientRect().width);
  await track.click({ position: { x: width * 0.6, y: 4 } });

  await expect
    .poll(() => page.evaluate(() => {
      const v = document.querySelector('#render-host video');
      if (!v || !isFinite(v.duration) || v.duration <= 0) return -1;
      return v.currentTime / v.duration;
    }), { timeout: 15000 })
    .toBeGreaterThan(0.4);

  const ratio = await page.evaluate(() => {
    const v = document.querySelector('#render-host video');
    return v.currentTime / v.duration;
  });
  // Loose bounds: a seek lands on the nearest keyframe, which is a property of
  // the file rather than of the code.
  expect(ratio).toBeLessThan(0.8);
});

test('the sound button mutes and unmutes', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await serveClip(page);
  await boot(page);
  await render(page, [{ type: 'video', src: CLIP, controls: true }]);

  const player = page.locator('#render-host [data-wiki-player]');
  const mute = page.locator('#render-host [data-player-mute]');

  await expect(player).not.toHaveClass(/is-muted/);
  expect(await page.evaluate(() => document.querySelector('#render-host video').muted)).toBe(false);

  await mute.click();

  // Both halves: the element is really muted, and the button says so.
  expect(await page.evaluate(() => document.querySelector('#render-host video').muted)).toBe(true);
  await expect(player).toHaveClass(/is-muted/);
  await expect(mute).toHaveAttribute('aria-label', 'Unmute');

  // The rendered consequence - the muted state draws a slash across the
  // speaker, and a class that stopped matching would leave a plain speaker on
  // a silent video.
  const slash = await page.evaluate(() => {
    const btn = document.querySelector('#render-host [data-player-mute]');
    const s = getComputedStyle(btn, '::after');
    return { content: s.content, width: parseFloat(s.width) || 0 };
  });
  expect(slash.content).not.toBe('none');
  expect(slash.width).toBeGreaterThan(0);

  await mute.click();
  expect(await page.evaluate(() => document.querySelector('#render-host video').muted)).toBe(false);
  await expect(player).not.toHaveClass(/is-muted/);
  await expect(mute).toHaveAttribute('aria-label', 'Mute');
  expect(errors).toEqual([]);
});

test('play, sound and the bar sit on one row', async ({ page }) => {
  await boot(page);
  await render(page, [{ type: 'video', src: CLIP, controls: true }]);

  // Owner's change: they were stacked, which read as two separate controls and
  // spent a line under every video. Asserted as overlapping vertical bands
  // rather than equal coordinates - font metrics differ by OS, but "on the
  // same row" is a structural claim that holds everywhere.
  const out = await page.evaluate(() => {
    const box = (sel) => {
      const r = document.querySelector(`#render-host ${sel}`).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, mid: r.top + r.height / 2 };
    };
    return { play: box('[data-player-toggle]'), sound: box('[data-player-mute]'), track: box('[data-player-track]') };
  });

  const overlaps = (a, b) => a.top < b.bottom && b.top < a.bottom;
  expect(overlaps(out.play, out.sound), 'play and sound share a row').toBe(true);
  expect(overlaps(out.play, out.track), 'and so does the bar').toBe(true);

  // Left to right, in that order, and none of them stacked underneath.
  expect(out.play.right).toBeLessThanOrEqual(out.sound.left);
  expect(out.sound.right).toBeLessThanOrEqual(out.track.left);

  // The bar takes the leftover width rather than being a fixed stub.
  expect(out.track.right - out.track.left).toBeGreaterThan(out.play.right - out.play.left);
});

test('the player paints itself in the character accent, not a fixed blue', async ({ page }) => {
  await boot(page);
  await render(page, [{ type: 'video', src: '/medias/a.webm', controls: true }]);

  // js/site_meta.js sets --accent-blue on :root per character page. Read the
  // resolved colour and compare against the token rather than a literal hex,
  // so the test follows the palette instead of pinning it.
  const out = await page.evaluate(() => {
    const glyph = document.querySelector('#render-host .wiki-player-glyph');
    const fill = document.querySelector('#render-host .wiki-player-fill');
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent-blue)';
    document.body.appendChild(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    return {
      accent,
      glyph: getComputedStyle(glyph).backgroundColor,
      fill: getComputedStyle(fill).backgroundColor,
    };
  });

  expect(out.glyph).toBe(out.accent);
  expect(out.fill).toBe(out.accent);
});

// --- ITEM 11: STORAGE LINKS IN A TABLE ---

test('a wiki-media image in a table cell renders as an image, sized down', async ({ page }) => {
  await boot(page);
  await render(page, [{
    type: 'table',
    headers: ['Move', 'Shot'],
    rows: [['M1', `${BUCKET}/Boomcat.webp`]],
  }]);

  const img = page.locator('#render-host .wiki-cell-media');
  await expect(img).toHaveAttribute('src', `${BUCKET}/Boomcat.webp`);

  // Sized down is the feature - full width would blow the row open.
  const width = await img.evaluate(el => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(0);
  expect(width).toBeLessThanOrEqual(140);
});

test('a wiki-media video in a table cell becomes a button, not a link', async ({ page }) => {
  await boot(page);
  await render(page, [{
    type: 'table',
    headers: ['Combo', 'Clip'],
    rows: [['M1 M1 Skill', `${BUCKET}/clip.webm`]],
  }]);

  const cell = page.locator('#render-host .wiki-cell-media-td');
  await expect(cell.locator('.wiki-video-btn')).toBeVisible();
  // The point of the change: no navigation away from the wiki.
  await expect(cell.locator('a')).toHaveCount(0);
});

test('the allowlist is a prefix on our own bucket, not a substring anywhere', async ({ page }) => {
  await boot(page);

  const out = await page.evaluate((bucket) => {
    const kinds = {};
    const check = (label, value) => { kinds[label] = window.wikiMediaKind(value); };

    check('ourImage', `${bucket}/Boomcat.webp`);
    check('ourVideo', `${bucket}/clip.webm`);
    // Everything below must be refused.
    check('plainText', 'Just a note about M1');
    check('otherHost', 'https://evil.example.com/storage/v1/object/public/wiki-media/x.webp');
    check('otherBucket', bucket.replace('/wiki-media', '/private-media') + '/x.webp');
    check('bucketInQuery', 'https://evil.example.com/x.webp?/storage/v1/object/public/wiki-media/y.webp');
    check('unknownExt', `${bucket}/notes.txt`);
    check('noExt', `${bucket}/whatever`);
    check('withSpace', `${bucket}/a b.webp`);
    return kinds;
  }, BUCKET);

  // Both directions: what must be accepted, and what must not. A check that
  // only ever refuses would pass the second half on its own.
  expect(out.ourImage).toBe('image');
  expect(out.ourVideo).toBe('video');

  expect(out.plainText, 'ordinary cell text').toBeNull();
  expect(out.otherHost, 'another host that copied the path').toBeNull();
  expect(out.otherBucket, 'a different bucket on our project').toBeNull();
  expect(out.bucketInQuery, 'the path smuggled into a query string').toBeNull();
  expect(out.unknownExt).toBeNull();
  expect(out.noExt).toBeNull();
  expect(out.withSpace).toBeNull();
});

test('clicking the button opens a modal that plays it, and closing empties it', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await boot(page);

  // Driven through the theorybox rather than a table cell: it is the same
  // button and the same delegated handler, and a theorybox takes any URL while
  // the table path only fires for a real bucket link.
  await render(page, [{
    type: 'theorybox',
    title: 'Corner BnB',
    sequence: ['M1'],
    video: '/medias/videos/example-video5.webm',
    content: [],
  }]);

  await expect(page.locator('#wiki-video-modal')).toHaveCount(0);

  await page.locator('#render-host .wiki-video-btn').click();

  const modal = page.locator('#wiki-video-modal');
  await expect(modal).not.toHaveClass(/hidden/);
  await expect(modal.locator('[data-wiki-player] video')).toHaveCount(1);

  await modal.locator('.wiki-video-modal-close').click();
  await expect(modal).toHaveClass(/hidden/);

  // Emptied, not just hidden: a paused video left behind keeps buffering and
  // flashes its last frame when a different clip is opened next.
  await expect(modal.locator('video')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the theorybox and the combo table no longer link out to storage', async ({ page }) => {
  await boot(page);

  const out = await page.evaluate((bucket) => {
    const box = window.generateHTMLForBlocks([{
      type: 'theorybox', title: 'BnB', sequence: [], video: `${bucket}/clip.webm`, content: [],
    }], '');

    // The combo table's own renderer, not a re-implementation of it: this is
    // the second surface the owner named, and testing the theorybox twice
    // would look like coverage without being any.
    const cellFn = window.renderComboCell;
    const cell = typeof cellFn === 'function'
      ? cellFn({ video: `${bucket}/clip.webm` }, { field: 'video', label: 'Video' })
      : null;

    return {
      boxHasButton: box.includes('wiki-video-btn'),
      boxHasAnchor: box.includes('theorybox-video'),
      boxHasRawHref: box.includes(`href="${bucket}/clip.webm"`),
      cell,
    };
  }, BUCKET);

  expect(out.boxHasButton).toBe(true);
  expect(out.boxHasAnchor, 'the old theorybox anchor is gone').toBe(false);
  expect(out.boxHasRawHref, 'and the storage URL is not a destination').toBe(false);

  expect(out.cell, 'renderComboCell must be reachable for this to test anything').not.toBeNull();
  expect(out.cell).toContain('wiki-video-btn');
  expect(out.cell, 'the combo table no longer links out either').not.toContain('<a ');
});

// --- ITEM 12: THE PLACEHOLDER ---

test('an empty image block shows the placeholder instead of a broken box', async ({ page }) => {
  await boot(page);
  await render(page, [{ type: 'image', src: '', alt: 'I am broken' }]);

  const holder = page.locator('#render-host .wiki-media-placeholder');
  await expect(holder).toBeVisible();
  await expect(holder.locator('.wiki-media-placeholder-label')).toHaveText('Placeholder');
  await expect(holder.locator('img')).toHaveAttribute('src', '/medias/images/DogslamloopIcon.webp');

  // The defect: `<img src="">` resolves to the page itself and draws as a
  // broken image showing the alt text.
  const strays = await page.evaluate(() =>
    [...document.querySelectorAll('#render-host img')].filter(i => !i.getAttribute('src')).length);
  expect(strays, 'no src-less image survives').toBe(0);
});

test('an empty video block shows the placeholder rather than vanishing', async ({ page }) => {
  await boot(page);
  await render(page, [
    { type: 'paragraph', content: 'before' },
    { type: 'video', src: '' },
    { type: 'paragraph', content: 'after' },
  ]);

  // It used to emit no markup at all, so the block disappeared from the page
  // and an author could not see there was anything to fix.
  await expect(page.locator('#render-host .wiki-media-placeholder')).toBeVisible();
});

test('an empty youtube block shows the placeholder too', async ({ page }) => {
  await boot(page);
  await render(page, [{ type: 'youtube', videoId: '' }]);

  await expect(page.locator('#render-host .wiki-media-placeholder')).toBeVisible();
});

test('the placeholder keeps its height instead of collapsing', async ({ page }) => {
  await boot(page);
  await render(page, [{ type: 'video', src: '' }]);

  // "Somehow get its Height compressed" was half the original report, so the
  // box having a real height is part of the fix rather than a side effect.
  const height = await page.locator('#render-host .wiki-media-placeholder')
    .evaluate(el => el.getBoundingClientRect().height);
  expect(height).toBeGreaterThan(100);
});

test('a filled image or video block does not get a placeholder', async ({ page }) => {
  await boot(page);
  await render(page, [
    { type: 'image', src: '/medias/images/DogslamloopIcon.webp', alt: 'icon' },
    { type: 'video', src: '/medias/videos/example-video5.webm', controls: true },
  ]);

  // The other direction. A placeholder that appeared for everything would
  // satisfy every test above.
  await expect(page.locator('#render-host .wiki-media-placeholder')).toHaveCount(0);
});
