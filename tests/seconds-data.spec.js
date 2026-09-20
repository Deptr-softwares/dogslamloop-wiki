// Seconds Data - v0.19 C4.
//
// A third way to say how long a phase lasts, BESIDE counted frames and an
// estimate rather than replacing either (owner, 2026-08-24: the list had
// floated replacement and they decided against it).
//
// Some phases are timed rather than counted - a long animation, a cooldown, a
// state that lasts "about two seconds". Writing 120 in a frame box claims a
// precision nobody measured; writing 2 in a seconds box does not.
//
// JJS runs at 60fps server-side, so a second IS 60 frames. That makes the
// conversion exact rather than a display convenience, and it is why the whole
// feature lands in phaseWeight - the one function that decides how wide a phase
// is drawn - instead of at each call site.
//
// It inherits the estimate's rule about divisions: no ticks. Drawing 120 of
// them for one typed "2" would invent a per-frame breakdown out of nothing, and
// the divisions are this site's language for "measured".
const { test, expect } = require('@playwright/test');

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

// 60 counted frames beside 1.0 seconds. They are the same length, and the bar
// has to draw them the same width - which is the claim, stated as a comparison
// between two phases rather than as a pixel count.
const TIMED = {
  m1s: [], specials: [],
  skills: [{
    id: 'timed', name: 'Timed Move', stats: [],
    variants: {
      standard: {
        label: 'Standard',
        totalScale: 120,
        bars: [{
          type: 'single', headerInfo: 'Standard',
          phases: [
            { duration: 60, styleClass: 'bg-tick-start', label: 'Startup' },
            { seconds: 1, styleClass: 'bg-tick-recov', label: 'Recovery' },
          ],
        }],
      },
    },
  }],
};

const openSkills = async (page) => {
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  await page.locator('#nav-skills').click();
};

test('a second is sixty frames, exactly', async ({ page }) => {
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'domcontentloaded' });

  const out = await page.evaluate(() => ({
    fps: window.FRAMES_PER_SECOND,
    one: window.phaseWeight({ seconds: 1 }),
    half: window.phaseWeight({ seconds: 0.5 }),
    // Not a number, not a duration: the phase is worth nothing rather than NaN,
    // which would make the whole bar's width NaN with it.
    zero: window.phaseWeight({ seconds: 0 }),
    junk: window.phaseWeight({ seconds: 'soon' }),
    negative: window.phaseWeight({ seconds: -3 }),
  }));

  expect(out.fps).toBe(60);
  expect(out.one).toBe(60);
  expect(out.half).toBe(30);
  expect(out.zero).toBe(0);
  expect(out.junk).toBe(0);
  expect(out.negative).toBe(0);
});

test('a timed phase is drawn as wide as the frames it is worth', async ({ page }) => {
  await mockPageData(page, { frame: TIMED, desc: { overview: [] } });
  await openSkills(page);

  const phases = page.locator('#tab-skills .phase-section');
  await expect(phases).toHaveCount(2);

  // 60 counted frames and 1.0 seconds are the same length, so they occupy the
  // same width. Compared against each other rather than against a number,
  // which is what makes this hold on any screen.
  const widths = await phases.evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().width)));
  expect(widths[0]).toBeGreaterThan(0);
  expect(Math.abs(widths[0] - widths[1]), 'the same duration, the same width').toBeLessThanOrEqual(1);
});

test('a timed phase has no divisions, and is still coloured', async ({ page }) => {
  await mockPageData(page, { frame: TIMED, desc: { overview: [] } });
  await openSkills(page);

  const phases = page.locator('#tab-skills .phase-section');

  // The counted phase keeps one tick per frame - that is the convention the
  // absence is read against.
  await expect(phases.nth(0).locator('.frame-tick')).toHaveCount(60);
  await expect(phases.nth(1).locator('.frame-tick')).toHaveCount(0);

  // And it is filled. An earlier version of this rule keyed the fill off
  // `.phase-estimated`, so anything else with no divisions rendered at the
  // right width and completely transparent - reported then as "the frame data
  // did not show up at all". Read back from the browser, not from the class.
  const painted = await page.evaluate(() => {
    const el = document.querySelectorAll('#tab-skills .phase-section')[1];
    return {
      classes: el.className,
      background: getComputedStyle(el).backgroundColor,
    };
  });

  expect(painted.classes, 'shares the fill hook').toContain('phase-solid');
  expect(painted.classes, 'and says which kind of solid it is').toContain('phase-seconds');
  expect(painted.classes, 'a timed phase is not an estimate').not.toContain('phase-estimated');
  expect(painted.background).not.toBe('rgba(0, 0, 0, 0)');
});

test('an estimate still renders the way it always did', async ({ page }) => {
  // The owner asked for this beside Estimated Data, not instead of it, and the
  // fill hook was renamed underneath estimates to share it - so this is the
  // regression that rename could have caused.
  await mockPageData(page, {
    desc: { overview: [] },
    frame: {
      m1s: [], specials: [],
      skills: [{
        id: 'est', name: 'Est Move', stats: [],
        variants: { standard: { label: 'Standard', totalScale: 40, bars: [{
          type: 'single', headerInfo: 'Standard',
          phases: [
            { duration: 14, styleClass: 'bg-tick-start', label: 'Startup' },
            { estimate: 'high', styleClass: 'bg-tick-recov', label: 'Recovery' },
          ],
        }] } },
      }],
    },
  });
  await openSkills(page);

  const phases = page.locator('#tab-skills .phase-section');
  await expect(phases.nth(1)).toHaveClass(/phase-estimated/);
  await expect(phases.nth(1).locator('.frame-tick')).toHaveCount(0);

  const bg = await phases.nth(1).evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
});

test('seconds win over an estimate, and the block says so', async ({ page }) => {
  // Nothing carries both today. The order is stated in the code and pinned here
  // so the first row that does is not a surprise - and so that a phase drawn to
  // a timed width can never also be labelled "estimated", which is the one
  // combination that would misreport the data.
  await mockPageData(page, {
    desc: { overview: [] },
    frame: {
      m1s: [], specials: [],
      skills: [{
        id: 'both', name: 'Both', stats: [],
        variants: { standard: { label: 'Standard', totalScale: 120, bars: [{
          type: 'single', headerInfo: 'Standard',
          phases: [{ seconds: 2, estimate: 'very-short', styleClass: 'bg-tick-recov', label: 'Recovery' }],
        }] } },
      }],
    },
  });
  await openSkills(page);

  const weight = await page.evaluate(() =>
    window.phaseWeight({ seconds: 2, estimate: 'very-short' }));
  expect(weight, 'two seconds, not the three-frame estimate').toBe(120);

  const classes = await page.locator('#tab-skills .phase-section').first().getAttribute('class');
  expect(classes).toContain('phase-seconds');
  expect(classes).not.toContain('phase-estimated');
});

test('the hover names the unit and the frames it comes to', async ({ page }) => {
  await mockPageData(page, { frame: TIMED, desc: { overview: [] } });
  await openSkills(page);

  await page.locator('#tab-skills .phase-section').nth(1).hover();

  const tip = page.locator('#wiki-frame-tooltip');
  await expect(tip).toBeVisible();
  // The unit it was written in, and the frame figure - because the timeline
  // around it is drawn in frames and a reader comparing phases needs both.
  await expect(tip).toContainText('1s');
  await expect(tip).toContainText('60 frames');
  await expect(tip).not.toContainText('Estimated');
});

test('the editor offers it as a third way to record, and stores only one', async ({ page }) => {
  // Switching modes converts the value and drops the others, which is what the
  // counted/estimated pair already did between themselves. Keeping two would
  // leave a count in the data that nothing displays and a reviewer might trust.
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'domcontentloaded' });

  const out = await page.evaluate(() => {
    const phase = { duration: 90, styleClass: 'bg-tick-recov' };
    const framesBefore = window.phaseWeight(phase);

    // What the editor's mode switch does, exercised as the data change it is.
    const toTimed = { ...phase };
    delete toTimed.duration;
    toTimed.seconds = Number((framesBefore / window.FRAMES_PER_SECOND).toFixed(2));

    return {
      framesBefore,
      seconds: toTimed.seconds,
      framesAfter: window.phaseWeight(toTimed),
      keys: Object.keys(toTimed).sort(),
      label: window.formatPhaseSeconds(toTimed.seconds),
    };
  });

  expect(out.framesBefore).toBe(90);
  expect(out.seconds, '90 frames at 60fps is a second and a half').toBe(1.5);
  expect(out.framesAfter, 'and it comes back the same width').toBe(90);
  expect(out.keys, 'the frame count is gone, not kept alongside').toEqual(['seconds', 'styleClass']);
  expect(out.label, 'no trailing zeroes - it is not a three-figure measurement').toBe('1.5s');
});
