// Media framing: the box matches the source rather than the source being
// cropped to match the box.
//
// The owner's rule is "square only when it fits" - a 16:9 clip keeps its 16:9
// box and loses nothing, a near-square still gets a square box, a phone-shaped
// capture gets a 3:4 box. Character portraits are the exception: they are
// always square, because a roster of mismatched portrait shapes is the most
// visible inconsistency on the site, and a portrait has one obvious subject so
// the crop can be aimed instead.
const { test, expect } = require('@playwright/test');

// An SVG data URI reports naturalWidth/naturalHeight from its own attributes,
// which is exactly what the framing measurement reads.
const img = (w, h) =>
  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'%3E%3C/svg%3E`;

function mockPageData(page, { desc = {}, frame = {} } = {}) {
  return page.addInitScript(({ desc, frame }) => {
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
              if (table !== 'page_data') return origFrom(table);
              const chain = {
                select() { return chain; }, eq() { return chain; },
                single: async () => ({ data: { desc_data: desc, frame_data: frame }, error: null }),
              };
              return chain;
            };
            client.auth.getSession = async () => ({ data: { session: null } });
            return client;
          };
          lib.__patched = true;
        }
      },
    });
  }, { desc, frame });
}

test('the thresholds are the rule the owner chose, not an approximation of it', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const framing = await page.evaluate(() => ({
    ultrawide: window.framingForRatio(21 / 9),
    sixteenNine: window.framingForRatio(16 / 9),
    threeTwo: window.framingForRatio(3 / 2),
    fourThree: window.framingForRatio(4 / 3),
    square: window.framingForRatio(1),
    fourFive: window.framingForRatio(4 / 5),
    threeFour: window.framingForRatio(3 / 4),
    phone: window.framingForRatio(9 / 16),
    nonsense: window.framingForRatio(0),
  }));

  // 16:9 keeps 16:9 - that is the whole point of the choice. 3:2 is the
  // boundary and stays wide; anything narrower than that fits a square.
  expect(framing.ultrawide).toBe('wide');
  expect(framing.sixteenNine).toBe('wide');
  expect(framing.threeTwo).toBe('wide');
  expect(framing.fourThree).toBe('square');
  expect(framing.square).toBe('square');
  expect(framing.fourFive).toBe('square');
  expect(framing.threeFour).toBe('tall');
  expect(framing.phone).toBe('tall');
  expect(framing.nonsense, 'an unmeasurable source leaves the box alone').toBe(null);
});

test('each skill card gets the box its own media needs', async ({ page }) => {
  await mockPageData(page, {
    frame: {
      m1s: [], specials: [],
      skills: [
        { id: 'wide-move', name: 'Wide Move', media: { src: img(320, 180) } },
        { id: 'square-move', name: 'Square Move', media: { src: img(200, 200) } },
        { id: 'tall-move', name: 'Tall Move', media: { src: img(90, 160) } },
      ],
    },
    desc: { overview: [] },
  });

  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  // Skill media is lazy AND lives in a tab that starts hidden, so nothing in
  // it loads until a reader opens the tab. Measuring is therefore the *late*
  // path by design - the test drives the real control to reach it.
  await page.locator('#nav-skills').click();

  const cards = page.locator('#tab-skills .skill-entry-card');
  await expect(cards).toHaveCount(3);

  // Retrying assertions, not a synchronous read: the class lands on the image's
  // load event, which has no guaranteed timing relative to the render.
  await expect(cards.nth(0).locator('.skill-media-wrapper')).not.toHaveClass(/is-square|is-tall/);
  await expect(cards.nth(1).locator('.skill-media-wrapper')).toHaveClass(/is-square/);
  await expect(cards.nth(2).locator('.skill-media-wrapper')).toHaveClass(/is-tall/);

  // The consequence that matters, not the class name.
  const boxes = await cards.locator('.skill-media-wrapper').evaluateAll(
    els => els.map(el => +(el.getBoundingClientRect().width / el.getBoundingClientRect().height).toFixed(2))
  );
  expect(boxes[0]).toBeCloseTo(16 / 9, 1);
  expect(boxes[1]).toBeCloseTo(1, 1);
  expect(boxes[2]).toBeCloseTo(3 / 4, 1);
});

test('an explicit framing beats the measurement', async ({ page }) => {
  // For media whose subject sits off to one side: the measurement is right
  // about the shape and wrong about what matters in it.
  await mockPageData(page, {
    frame: {
      m1s: [], specials: [],
      skills: [{ id: 'forced', name: 'Forced', media: { src: img(320, 180), framing: 'square' } }],
    },
    desc: { overview: [] },
  });

  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  // No click and no wait: an explicit framing applies at render, which is the
  // whole point of being able to set one.
  await expect(page.locator('#tab-skills .skill-media-wrapper')).toHaveClass(/is-square/);
});

test('stored dimensions frame the box before the media has loaded', async ({ page }) => {
  // The reflow this avoids is real: a lazy image inside a hidden tab does not
  // load at all until the tab is opened, so without stored dimensions the box
  // corrects itself in front of the reader on their first click.
  await mockPageData(page, {
    frame: {
      m1s: [], specials: [],
      skills: [{ id: 'known', name: 'Known', media: { src: img(200, 200), width: 200, height: 200 } }],
    },
    desc: { overview: [] },
  });

  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  const wrapper = page.locator('#tab-skills .skill-media-wrapper');
  await expect(wrapper).toHaveClass(/is-square/);

  // Still unloaded - proving the class came from the stored numbers.
  const loaded = await page.locator('#tab-skills .skill-media-img').evaluate(el => el.complete && el.naturalWidth > 0);
  expect(loaded, 'the tab was never opened, so the image has not loaded').toBe(false);
});

test('a character portrait is square and the crop can be aimed', async ({ page }) => {
  await mockPageData(page, {
    frame: { m1s: [], skills: [], specials: [] },
    desc: {
      overview: [],
      profile: { image: img(400, 900), imageFocus: 'center top', stats: [] },
    },
  });

  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  const portrait = page.locator('.profile-portrait');
  await expect(portrait).toBeVisible();

  const applied = await portrait.evaluate(el => {
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return {
      fit: cs.objectFit,
      position: cs.objectPosition,
      ratio: +(box.width / box.height).toFixed(2),
    };
  });

  expect(applied.fit, 'cover, or a tall source would be squashed rather than cropped').toBe('cover');
  expect(applied.ratio).toBeCloseTo(1, 1);
  // "center top" resolves to a percentage pair in computed style.
  expect(applied.position).toBe('50% 0%');
});

test('a portrait with no focus set is centred, not broken', async ({ page }) => {
  await mockPageData(page, {
    frame: { m1s: [], skills: [], specials: [] },
    desc: { overview: [], profile: { image: img(400, 900), stats: [] } },
  });

  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  await expect(page.locator('.profile-portrait')).toHaveCSS('object-position', '50% 50%');
});

test('a crafted focus value cannot escape the style attribute', async ({ page }) => {
  // imageFocus lands inside style="", where escaping alone would not stop a
  // value closing the declaration and adding its own. It is whitelisted.
  await mockPageData(page, {
    frame: { m1s: [], skills: [], specials: [] },
    desc: {
      overview: [],
      profile: { image: img(400, 400), imageFocus: 'center top; background: url(https://evil.test/x)', stats: [] },
    },
  });

  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  const portrait = page.locator('.profile-portrait');
  await expect(portrait).toHaveCSS('object-position', '50% 50%');
  expect(await portrait.getAttribute('style'), 'a rejected value writes no style at all').toBe(null);
});

test('a character with no portrait keeps its card shape', async ({ page }) => {
  // The placeholder had no CSS rule at all before; now that the portrait beside
  // it is a fixed square, an unstyled div would collapse the profile card.
  await mockPageData(page, {
    frame: { m1s: [], skills: [], specials: [] },
    desc: { overview: [], profile: { stats: [{ label: 'Archetype', value: 'TBD' }] } },
  });

  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  const placeholder = page.locator('.profile-portrait-missing');
  await expect(placeholder).toBeVisible();
  const ratio = await placeholder.evaluate(el => {
    const b = el.getBoundingClientRect();
    return +(b.width / b.height).toFixed(2);
  });
  expect(ratio).toBeCloseTo(1, 1);
});

// --- THE EDITOR CONTROLS ---
// The renderer can only honour what someone can actually set.

async function openProfileForm(page, profile) {
  // Mocked so the editor's own page_data fetch resolves immediately. Left
  // unmocked it lands mid-test and re-renders the builder, which replaces the
  // custom dropdown wrappers between a click and the click that follows it.
  await mockPageData(page, { desc: { overview: [] }, frame: { m1s: [], skills: [], specials: [] } });
  await page.goto('/edit.html?char=testchar&tab=overview', { waitUntil: 'networkidle' });
  await page.evaluate((profile) => {
    window.currentEditorPageType = 'character';
    window.currentEditorCharId = 'testchar';
    window.currentOverviewSection = null;
    window.currentMatchupIndex = undefined;
    window.currentCounterplayIndex = undefined;
    window.currentEditorDescData = {
      overview: [], strategy: [], extras: [], matchups: [], counterplay: [], moveStrategies: {},
      profile, playstyle: { likes: [], dislikes: [] },
    };
    window.currentEditorFrameData = { m1s: [], skills: [], specials: [] };
    initFullTabEditor('testchar', 'overview', window.currentEditorDescData, window.currentEditorFrameData);
    window.loadOverviewSectionIntoEditor('profile');
  }, profile);
}

// The custom dropdown (initializeMangaSelects) hides the native select behind a
// wrapper, and keeps its options display:none until the wrapper has the `open`
// class. Two things make a naive click-then-click flaky, and both bit in CI:
//
//   - The editor re-renders on its own schedule, and the MutationObserver that
//     builds these wrappers replaces the node - so the wrapper opened by the
//     first click may not be the wrapper the second click lands in.
//   - `force: true` does not rescue it. Force skips actionability checks, but a
//     display:none element still has no box to click, which is exactly the
//     "Element is not visible" CI reported.
//
// So: assert the open state between the clicks, and re-open once if the
// wrapper was swapped underneath us. Deterministic rather than hopeful.
async function openMangaDropdown(wrapper) {
  await wrapper.locator('.manga-select-trigger').click();
  try {
    await expect(wrapper).toHaveClass(/open/, { timeout: 2000 });
  } catch {
    await wrapper.locator('.manga-select-trigger').click();
    await expect(wrapper).toHaveClass(/open/);
  }
}

async function pickFraming(page, label) {
  const wrapper = page.locator('#move-media-framing + .manga-select-wrapper');
  await openMangaDropdown(wrapper);
  await wrapper.locator('.manga-option', { hasText: label }).first().click();
}

test('the crop focus picker writes the value the renderer reads', async ({ page }) => {
  await openProfileForm(page, { image: img(400, 900), stats: [] });

  const grid = page.locator('#portrait-focus-grid');
  await expect(grid.locator('.portrait-focus-dot')).toHaveCount(9);
  // Centre by default - the middle of a three-by-three grid.
  await expect(grid.locator('.portrait-focus-dot.active')).toHaveAttribute('data-focus', 'center center');

  await grid.locator('[data-focus="center top"]').click();

  await expect(grid.locator('.portrait-focus-dot.active')).toHaveAttribute('data-focus', 'center top');
  const stored = await page.evaluate(() => window.currentEditorDescData.profile.imageFocus);
  expect(stored).toBe('center top');

  // The preview is the real thing, so what it shows is what the page shows.
  await expect(page.locator('#portrait-focus-img')).toHaveCSS('object-position', '50% 0%');
});

test('the picker offers exactly the nine values the renderer will accept', async ({ page }) => {
  // A tenth option here would render as nothing on the live page, silently.
  await openProfileForm(page, { image: img(400, 400), stats: [] });

  const offered = await page.locator('#portrait-focus-grid .portrait-focus-dot').evaluateAll(
    els => els.map(el => el.dataset.focus)
  );
  const accepted = await page.evaluate(() => window.PORTRAIT_FOCUS_VALUES);
  expect(offered).toEqual(accepted);
});

test('the move editor can override a box shape', async ({ page }) => {
  await page.goto('/edit.html?char=testchar&tab=skills', { waitUntil: 'networkidle' });

  await page.evaluate(() => {
    window.currentEditorPageType = 'character';
    window.currentEditorCharId = 'testchar';
    window.currentEditorDescData = { moveStrategies: {} };
    window.currentEditorFrameData = {
      m1s: [], specials: [],
      skills: [{ id: 'm', name: 'Move', stats: [], media: { src: 'x.webp', alt: '' } }],
    };
    initFullTabEditor('testchar', 'skills', window.currentEditorDescData, window.currentEditorFrameData);
  });

  await expect(page.locator('#move-media-framing')).toHaveValue('auto');
  await pickFraming(page, 'Square');

  const stored = await page.evaluate(() => window.currentEditorFrameData.skills[0].media.framing);
  expect(stored).toBe('square');
});

test('the media box shape selector uses the site dropdown, not the browser one', async ({ page }) => {
  // It shipped as a bare .editor-input, so it rendered as an OS select while
  // every other control on the page used the custom one. Moving it to
  // .editor-select also moves it off the .meta-inp `input` handler, because
  // the custom dropdown only ever dispatches `change` - so the binding has to
  // move with it or the choice silently stops being recorded.
  await mockPageData(page, { desc: { overview: [] }, frame: { m1s: [], skills: [], specials: [] } });
  await page.goto('/edit.html?char=testchar&tab=skills', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    window.currentEditorPageType = 'character';
    window.currentEditorCharId = 'testchar';
    window.currentEditorDescData = { moveStrategies: {} };
    window.currentEditorFrameData = {
      m1s: [], specials: [],
      skills: [{ id: 'm', name: 'Move', stats: [], media: { src: 'x.webp', alt: '' } }],
    };
    initFullTabEditor('testchar', 'skills', window.currentEditorDescData, window.currentEditorFrameData);
  });

  await expect(page.locator('#move-media-framing + .manga-select-wrapper')).toHaveCount(1);
  await pickFraming(page, 'Square');

  expect(await page.evaluate(() => window.currentEditorFrameData.skills[0].media.framing)).toBe('square');
});

test('the media library filter uses the site dropdown too', async ({ page }) => {
  await page.goto('/edit.html?char=testchar&tab=overview', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#media-filter-select + .manga-select-wrapper')).toHaveCount(1);
});

test('the editor says a submission covers one tab', async ({ page }) => {
  // Surprising enough to be worth stating: the editor keeps work across tabs,
  // but Submit only sends the tab you are on. Multi-tab submission is v0.13.
  await page.goto('/edit.html?char=testchar&tab=overview', { waitUntil: 'domcontentloaded' });
  const tip = page.locator('.editor-scope-tip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('One tab per submission');
});
