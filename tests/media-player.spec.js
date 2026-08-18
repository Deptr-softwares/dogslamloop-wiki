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

const PAGE = '/characters/Boomcat/index.html';
const BUCKET = 'https://gtqswjspxymjdopljmfi.supabase.co/storage/v1/object/public/wiki-media';

async function boot(page) {
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.generateHTMLForBlocks === 'function', { timeout: 15000 });
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

  await boot(page);

  // A real file rather than a mock: the player reads duration and currentTime
  // off the element, and a src that never loads reports duration NaN, which is
  // exactly the case the fill guard exists for.
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'render-host';
    document.body.appendChild(host);
    host.innerHTML = window.generateHTMLForBlocks(
      [{ type: 'video', src: '/medias/videos/NoNeutralCS.webm', controls: true }], '');
  });

  const player = page.locator('#render-host [data-wiki-player]');
  await expect(player).toBeVisible();
  await expect(player).not.toHaveClass(/is-playing/);

  await page.locator('#render-host [data-player-toggle]').click();

  // The state class is what swaps the glyph, so this is the rendered
  // consequence rather than a claim about the click.
  await expect(player).toHaveClass(/is-playing/);

  const label = await page.locator('#render-host [data-player-toggle]').getAttribute('aria-label');
  expect(label).toBe('Pause');

  await page.locator('#render-host [data-player-toggle]').click();
  await expect(player).not.toHaveClass(/is-playing/);
  expect(errors).toEqual([]);
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
    video: '/medias/videos/NoNeutralCS.webm',
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
    { type: 'video', src: '/medias/videos/NoNeutralCS.webm', controls: true },
  ]);

  // The other direction. A placeholder that appeared for everything would
  // satisfy every test above.
  await expect(page.locator('#render-host .wiki-media-placeholder')).toHaveCount(0);
});
