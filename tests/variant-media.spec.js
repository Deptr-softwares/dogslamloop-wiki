// Media per Micro Variant (owner's board: "Skill Card media syncing across
// Variants selection"): "for every variants created for a Skill Card, there
// will be as many media slot for it as there are", and for a variant within a
// variant "the slots should only take all the bottom elements/leaf of the
// tree". So each timeline can carry its own media, and the Skill Card's media
// box follows the timeline on show. One without media shows the move's own.
const { test, expect } = require('@playwright/test');

const MOVE_MEDIA = '/medias/images/Boomcat.webp';
const HIT_MEDIA = '/medias/images/HmmCat.webp';
const DEEP_MEDIA = '/medias/images/JJS_Icon.webp';

const leaf = (label, media) => ({
  label, totalScale: 10,
  bars: [{ type: 'single', phases: [{ duration: 10, styleClass: 'bg-tick-start', label: 'Startup: 10f' }] }],
  ...(media ? { media: { src: media, alt: `${label} clip` } } : {}),
});

async function drawMove(page, move) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(async (move) => {
    window.cachedMasterFrameData = window.cachedMasterFrameData || {};
    window.cachedMasterFrameData['boomcat'] = { skills: [move] };
    await window.loadMoveSection('boomcat', 'skills');
  }, move);
  await page.locator('#nav-skills').click();
  const card = page.locator('#tab-skills .skill-entry-card').first();
  await expect(card).toBeVisible();
  return card;
}

const shown = (card) => card.locator('.skill-media-wrapper .skill-media-img');
const tab = (card, name) => card.locator('.skill-tab-bar button', { hasText: name });

test('the media box follows the Micro Variant on show, down to the deepest one', async ({ page }) => {
  const card = await drawMove(page, {
    id: 'slash', name: 'Slash', stats: [], media: { src: MOVE_MEDIA, alt: 'Slash' },
    variants: {
      hit: leaf('On Hit', HIT_MEDIA),
      whiff: leaf('On Whiff'),
      charged: { label: 'Charged', variants: { front: leaf('Front Hit', DEEP_MEDIA), back: leaf('Back Hit') } },
    },
  });

  // The first timeline is on show when the card is drawn, with its own media.
  await expect(shown(card)).toHaveAttribute('src', HIT_MEDIA);
  await expect(shown(card)).toHaveAttribute('alt', 'On Hit clip');

  // One without media of its own: the move's.
  await tab(card, 'On Whiff').click();
  await expect(shown(card)).toHaveAttribute('src', MOVE_MEDIA);
  await expect(shown(card)).toHaveAttribute('alt', 'Slash');

  // A branch has no slot: its first timeline's media shows.
  await tab(card, 'Charged').click();
  await expect(shown(card)).toHaveAttribute('src', DEEP_MEDIA);
  await tab(card, 'Back Hit').click();
  await expect(shown(card)).toHaveAttribute('src', MOVE_MEDIA);

  await tab(card, 'On Hit').click();
  await expect(shown(card)).toHaveAttribute('src', HIT_MEDIA);
  await expect(shown(card)).toHaveCount(1);
});

test('a timeline inside a tab that is not on show does not count', async ({ page }) => {
  // The branch comes first here, so its first timeline is never hidden itself:
  // only the tab above it is.
  const card = await drawMove(page, {
    id: 'slash', name: 'Slash', stats: [], media: { src: MOVE_MEDIA, alt: 'Slash' },
    variants: {
      charged: { label: 'Charged', variants: { front: leaf('Front Hit', DEEP_MEDIA), back: leaf('Back Hit') } },
      hit: leaf('On Hit', HIT_MEDIA),
    },
  });
  await expect(shown(card)).toHaveAttribute('src', DEEP_MEDIA);

  await tab(card, 'On Hit').click();
  await expect(shown(card)).toHaveAttribute('src', HIT_MEDIA);
});

test('switching between Micro Variants that share the media leaves it alone', async ({ page }) => {
  const card = await drawMove(page, {
    id: 'slash', name: 'Slash', stats: [], media: { src: MOVE_MEDIA, alt: 'Slash' },
    variants: { hit: leaf('On Hit'), whiff: leaf('On Whiff') },
  });

  // Marked, so a redraw (which would restart a video) is seen as a new element.
  await shown(card).evaluate(el => { el.dataset.kept = 'yes'; });
  await tab(card, 'On Whiff').click();
  await expect(card.locator('.view-section').nth(1)).toBeVisible();
  await expect(shown(card)).toHaveAttribute('data-kept', 'yes');
});

test('a move without media shows a Micro Variant\'s media, and the notice for the rest', async ({ page }) => {
  const card = await drawMove(page, {
    id: 'slash', name: 'Slash', stats: [],
    variants: { hit: leaf('On Hit'), whiff: leaf('On Whiff', HIT_MEDIA) },
  });
  const box = card.locator('.skill-media-wrapper');

  await expect(box).toContainText('[ Missing Media ]');
  await expect(box).toHaveClass(/skill-media-wrapper-empty/);

  await tab(card, 'On Whiff').click();
  await expect(shown(card)).toHaveAttribute('src', HIT_MEDIA);
  await expect(box).not.toHaveClass(/skill-media-wrapper-empty/);
  await expect(box).not.toContainText('[ Missing Media ]');

  await tab(card, 'On Hit').click();
  await expect(box).toContainText('[ Missing Media ]');
  await expect(box).toHaveClass(/skill-media-wrapper-empty/);
});

// --- THE EDITOR ---

function mockEditor(page) {
  return page.addInitScript(({ variants, moveMedia }) => {
    const frame = { m1s: [], specials: [], skills: [{ id: 'slash', name: 'Slash', stats: [], media: { src: moveMedia, alt: 'Slash' }, variants }] };
    const rowsFor = (table) => {
      if (table === 'page_data') return { data: { page_id: 'boomcat', desc_data: { overview: [] }, frame_data: frame }, error: null };
      if (['user_roles', 'site_settings', 'page_permissions', 'pending_revisions'].includes(table)) return { data: null, error: null };
      return { data: [], error: null };
    };
    const builder = (table) => {
      const result = rowsFor(table);
      const chain = {
        select() { return chain; }, eq() { return chain; }, in() { return chain; },
        order() { return chain; }, limit() { return chain; },
        single: async () => result, maybeSingle: async () => result,
        then: (res) => Promise.resolve(result).then(res),
      };
      return chain;
    };
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          lib.createClient = () => ({
            auth: {
              getSession: async () => ({ data: { session: { user: { id: 'c-1', email: 'c@b.c' }, access_token: 't' } } }),
              onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
              signOut: async () => ({}),
            },
            from: builder,
            rpc: async () => ({ data: null, error: null }),
            storage: { from: () => ({ list: async () => ({ data: [], error: null }) }) },
          });
          lib.__patched = true;
        }
      },
    });
  }, { variants: { hit: leaf('On Hit'), whiff: leaf('On Whiff') }, moveMedia: MOVE_MEDIA });
}

const storedMove = (page) => page.evaluate(() => window.cachedMasterFrameData.boomcat.skills[0]);

test('a timeline takes its own media in the editor, and gives it up when the fields are emptied', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockEditor(page);
  await page.goto('/edit.html?char=boomcat&type=character&tab=skills', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.daw-timeline-wrapper')).toBeVisible({ timeout: 45000 });

  const src = page.getByPlaceholder('Micro Variant Media Src');
  const alt = page.getByPlaceholder('Micro Variant Media Alt Text');
  await expect(src).toHaveValue('');

  await src.fill(HIT_MEDIA);
  await alt.fill('The hit');
  let move = await storedMove(page);
  expect(move.variants.hit.media).toMatchObject({ src: HIT_MEDIA, alt: 'The hit' });
  expect(move.variants.whiff, 'the other timeline is untouched').not.toHaveProperty('media');
  expect(move.media.src, 'and so is the move\'s own media').toBe(MOVE_MEDIA);

  // Its size is measured like the move's, so the card can shape the box
  // before the file loads.
  await expect.poll(async () => (await storedMove(page)).variants.hit.media.width, { timeout: 10000 }).toBeGreaterThan(0);

  // Each timeline shows its own fields.
  await page.locator('.daw-variant-wrapper .sub-tab', { hasText: 'On Whiff' }).click();
  await expect(page.getByPlaceholder('Micro Variant Media Src')).toHaveValue('');
  await page.locator('.daw-variant-wrapper .sub-tab', { hasText: 'On Hit' }).click();
  await expect(page.getByPlaceholder('Micro Variant Media Src')).toHaveValue(HIT_MEDIA);

  // Emptied: gone, so a timeline nobody gave media to and one that had it
  // removed are the same data.
  await page.getByPlaceholder('Micro Variant Media Src').fill('');
  await page.getByPlaceholder('Micro Variant Media Alt Text').fill('');
  move = await storedMove(page);
  expect(move.variants.hit).not.toHaveProperty('media');
});
