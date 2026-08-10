// Skill-card media in js/framedata.js. Reported two ways - "alt text does
// not persist" and "mp4 isn't supported in the skill card profile" - which
// turned out to be three separate defects in the same block of markup.
const { test, expect } = require('@playwright/test');

async function renderCards(page, moves) {
  await page.goto('/characters/Template/', { waitUntil: 'networkidle' });
  return page.evaluate(async (movesArg) => {
    if (!document.getElementById('tab-skills')) {
      const d = document.createElement('div');
      d.id = 'tab-skills';
      document.body.appendChild(d);
    }
    window.cachedMasterFrameData = window.cachedMasterFrameData || {};
    window.cachedMasterFrameData['mediachar'] = { skills: movesArg };

    await window.loadMoveSection('mediachar', 'skills', null, 'character');
    await new Promise(r => setTimeout(r, 200));

    return Array.from(document.querySelectorAll('#tab-skills .skill-media-wrapper')).map(w => {
      const v = w.querySelector('video');
      const img = w.querySelector('img');
      return {
        isVideo: !!v,
        isImage: !!img,
        // A video is armed for the lazy observer; an image carries a real src.
        videoLazySrc: v ? v.getAttribute('data-lazy-src') : null,
        ariaLabel: v ? v.getAttribute('aria-label') : null,
        imgSrc: img ? img.getAttribute('src') : null,
        imgAlt: img ? img.getAttribute('alt') : null,
        imgLoading: img ? img.getAttribute('loading') : null,
        filename: w.querySelector('.skill-media-filename')?.textContent.trim(),
      };
    });
  }, moves);
}

test('video media is detected by path, not by a raw endsWith on the URL', async ({ page }) => {
  // Only the first of these used to become a <video>. The rest fell through
  // to the <img> branch, which cannot play a video - the reported "mp4 isn't
  // supported in the skill card profile".
  const cards = await renderCards(page, [
    { id: 'a', name: 'Plain', media: { src: '/medias/videos/clip.mp4' }, stats: [] },
    { id: 'b', name: 'Query string', media: { src: '/medias/videos/clip.mp4?t=123' }, stats: [] },
    { id: 'c', name: 'Fragment', media: { src: '/medias/videos/clip.webm#t=2' }, stats: [] },
    { id: 'd', name: 'Uppercase', media: { src: '/medias/videos/CLIP.MP4' }, stats: [] },
    { id: 'e', name: 'QuickTime', media: { src: '/medias/videos/clip.mov' }, stats: [] },
    { id: 'f', name: 'Absolute', media: { src: 'https://cdn.example.test/x/clip.mp4' }, stats: [] },
  ]);

  expect(cards).toHaveLength(6);
  cards.forEach((c, i) => {
    expect(c.isVideo, `card ${i} should render as a video`).toBe(true);
    expect(c.isImage).toBe(false);
  });

  // The filename label reads the path, so a query string does not leak into it.
  expect(cards[1].filename).toBe('clip.mp4');
});

test('a still image still renders as an image, with a src that actually loads', async ({ page }) => {
  // These carried data-lazy-src, but initLazyMedia (js/description.js) only
  // ever promoted video[data-lazy-src] and iframe[data-lazy-src] - never img
  // - so every static skill-card image rendered with no source at all.
  const cards = await renderCards(page, [
    { id: 'a', name: 'PNG', media: { src: '/medias/images/m1.png', alt: 'M1 startup' }, stats: [] },
    { id: 'b', name: 'GIF', media: { src: '/medias/images/loop.gif' }, stats: [] },
  ]);

  expect(cards[0].isImage).toBe(true);
  expect(cards[0].imgSrc, 'a real src, not a data- attribute nothing promotes').toBe('/medias/images/m1.png');
  expect(cards[0].imgLoading, 'lazy loading kept, natively').toBe('lazy');

  // A GIF animates on its own, so it stays an image rather than becoming a video.
  expect(cards[1].isImage).toBe(true);
  expect(cards[1].isVideo).toBe(false);
});

test('alt text reaches the rendered card for both images and videos', async ({ page }) => {
  // <video> has no alt attribute, so alt text entered against a video-media
  // move used to render nowhere at all. It persisted fine in the data - it
  // just had nothing to land in, which is how it was reported as "alt text
  // does not persist".
  const cards = await renderCards(page, [
    { id: 'a', name: 'Image', media: { src: '/medias/images/m1.png', alt: 'M1 hitbox at frame 4' }, stats: [] },
    { id: 'b', name: 'Video', media: { src: '/medias/videos/clip.mp4', alt: 'Full combo route' }, stats: [] },
    { id: 'c', name: 'No alt', media: { src: '/medias/videos/bare.mp4' }, stats: [] },
  ]);

  expect(cards[0].imgAlt).toBe('M1 hitbox at frame 4');
  expect(cards[1].ariaLabel, 'aria-label is how a video carries it').toBe('Full combo route');
  expect(cards[2].ariaLabel, 'no empty aria-label when there is nothing to say').toBe(null);
});

test('contributor-submitted media and move fields cannot break out of their attributes', async ({ page }) => {
  const hostile = '" onerror="window.__cardXss=1" x="';

  const cards = await renderCards(page, [
    { id: 'a', name: 'Test', media: { src: '/medias/images/m1.png', alt: hostile }, stats: [] },
  ]);

  expect(cards[0].imgAlt, 'the text round-trips as text').toBe(hostile);

  const result = await page.evaluate(() => ({
    xss: !!window.__cardXss,
    strayHandler: !!document.querySelector('#tab-skills img[onerror]'),
  }));

  expect(result.xss).toBe(false);
  expect(result.strayHandler).toBe(false);
});

test('the Edit Move button is wired from a data attribute, not an inline onclick', async ({ page }) => {
  // move.id is contributor-submitted and used to be built straight into an
  // inline onclick, where a quote closed the handler - on every character
  // page. The project's own rule forbids that shape.
  await renderCards(page, [
    { id: "boom'-cat", name: 'Quoted id', media: { src: '/medias/images/m1.png' }, stats: [] },
  ]);

  const result = await page.evaluate(() => {
    const btn = document.querySelector('#tab-skills .skill-edit-move-btn');
    return {
      exists: !!btn,
      hasInlineOnclick: btn ? btn.hasAttribute('onclick') : true,
      moveId: btn ? btn.dataset.moveId : null,
    };
  });

  expect(result.exists).toBe(true);
  expect(result.hasInlineOnclick, 'no inline handler to break out of').toBe(false);
  expect(result.moveId, 'the id survives intact as data, quote and all').toBe("boom'-cat");
});
