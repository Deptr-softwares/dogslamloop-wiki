// v0.16 bug 2: "A workspace with many Blocks shakes violently when scrolling -
// moves up and down very fast."
//
// The cause was arithmetic, not the scroll handling. js/editor-blocks.js runs a
// virtualization engine: an IntersectionObserver that, when a card leaves the
// builder's 800px margin, measures it with getBoundingClientRect() and pins
// `card.style.height` to that number while display:none-ing its children.
//
// getBoundingClientRect().height is a BORDER-box height. This project has no
// global box-sizing reset, so .block-card was laying out as content-box and
// that assignment made the card 18px TALLER than it had just been - its 0.5rem
// top and bottom padding plus the two 1px borders, counted twice.
//
// So every card crossing the boundary changed the height of the content above
// the reader, the browser corrected the scroll position to compensate, that
// correction moved other cards across the boundary, and the workspace bounced.
// The trace that found it: content height cycling 10325 / 10307 / 10289 / 10271
// while scrollTop drifted off every value it was set to.
//
// The tests below assert measured geometry rather than the class, because the
// class was never wrong - .virtual-unloaded applied correctly the whole time.
const { test, expect } = require('@playwright/test');

const EDITOR = '/edit.html?char=boomcat&type=character&tab=overview';
const LONG = Array.from({ length: 40 }, (_, i) => `Line ${i} of a long paragraph block.`).join('\n');

// A workspace big enough that the virtualizer actually engages. Blocks are
// built here rather than read from a real page: the owner edits real pages, and
// a spec that depends on how much they have written is a spec that breaks when
// they write more.
async function buildBigWorkspace(page, count = 25) {
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto(EDITOR, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  await page.evaluate(({ count, LONG }) => {
    window.currentEditorPageType = 'character';
    window.currentEditorCharId = 'testchar';
    window.currentOverviewSection = null;
    window.currentEditorDescData = {
      overview: [],
      strategy: Array.from({ length: count }, (_, i) => ({
        type: 'paragraph', content: `#${i}\n${LONG}`,
      })),
      extras: [], matchups: [], counterplay: [], moveStrategies: {},
      profile: { image: '', stats: [] },
      playstyle: { likes: [], dislikes: [] },
    };
    window.currentEditorFrameData = { m1s: [], skills: [], specials: [] };
    initFullTabEditor('testchar', 'overview', window.currentEditorDescData, window.currentEditorFrameData);
    window.loadOverviewSectionIntoEditor('strategy');
  }, { count, LONG });
  await page.waitForTimeout(800);

  // Blocks collapse by default since v0.16 fine-tuning. A collapsed card is
  // under the engine's 50px floor and never virtualizes, so the bug only
  // exists in an expanded workspace - which is the one people write in.
  await page.evaluate(() => {
    (window.getActiveBlocks() || []).forEach(b => window.setEditorBlockExpanded(b, true));
    window.renderBlockList();
  });
  await page.waitForTimeout(600);
}

test('a card that scrolls out of view keeps exactly the height it had', async ({ page }) => {
  await buildBigWorkspace(page);

  const seen = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const builder = document.getElementById('interactive-builder');
    const card = document.querySelectorAll('#block-list .block-card')[1];
    const natural = card.offsetHeight;

    builder.scrollTop = builder.scrollHeight;
    await wait(700);
    const unloaded = card.classList.contains('virtual-unloaded');
    const pinned = card.offsetHeight;

    builder.scrollTop = 0;
    await wait(700);
    return { natural, pinned, restored: card.offsetHeight, unloaded };
  });

  // Without this the engine is switched off and the rest proves nothing.
  expect(seen.unloaded, 'setup: the card really did unload').toBe(true);
  expect(seen.natural, 'setup: a card tall enough to be virtualized').toBeGreaterThan(50);

  expect(seen.pinned, 'unloading holds the card at its own height, not 18px more').toBe(seen.natural);
  expect(seen.restored, 'and reloading puts it back').toBe(seen.natural);
});

test('the workspace does not change height while you scroll through it', async ({ page }) => {
  // The symptom the owner reported, measured directly: scroll in wheel-sized
  // steps and watch the content height. Every distinct value in this list was
  // a jolt under the reader's cursor.
  await buildBigWorkspace(page);

  const seen = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const builder = document.getElementById('interactive-builder');
    builder.scrollTop = 0;
    await wait(500);

    const heights = [];
    const asked = [];
    const landed = [];
    for (let i = 0; i < 12; i++) {
      const target = builder.scrollTop + 220;
      builder.scrollTop = target;
      await wait(90);
      asked.push(Math.round(target));
      landed.push(Math.round(builder.scrollTop));
      heights.push(builder.scrollHeight);
    }
    return {
      heights, asked, landed,
      unloaded: document.querySelectorAll('.block-card.virtual-unloaded').length,
    };
  });

  expect(seen.unloaded, 'setup: the engine is engaged during the scroll').toBeGreaterThan(0);
  expect([...new Set(seen.heights)],
    `the workspace height held still (saw ${JSON.stringify(seen.heights)})`).toHaveLength(1);

  // The other half of the same defect: when content above the viewport changes
  // height, the browser moves the scroll position to compensate. That is what
  // "moves up and down very fast" actually looks like from the outside.
  expect(seen.landed,
    'the scroll position stayed where it was put').toEqual(seen.asked);
});

test('the virtualization engine is still doing its job', async ({ page }) => {
  // The control. Deleting the observer would make both tests above pass
  // perfectly, and would quietly hand every large workspace back the render
  // cost the engine exists to avoid.
  await buildBigWorkspace(page);

  const seen = await page.evaluate(async () => {
    const builder = document.getElementById('interactive-builder');
    builder.scrollTop = builder.scrollHeight;
    await new Promise(r => setTimeout(r, 700));
    const far = document.querySelectorAll('#block-list .block-card')[0];
    return {
      unloadedCount: document.querySelectorAll('.block-card.virtual-unloaded').length,
      total: document.querySelectorAll('#block-list .block-card').length,
      // The point of unloading: the card's contents stop being laid out.
      childHidden: far.firstElementChild
        ? getComputedStyle(far.firstElementChild).display === 'none' : null,
      stillOpen: far.offsetHeight > 50,
    };
  });

  expect(seen.unloadedCount, 'far-away cards unload').toBeGreaterThan(0);
  expect(seen.unloadedCount, 'and nearby ones do not').toBeLessThan(seen.total);
  expect(seen.childHidden, 'an unloaded card stops rendering its contents').toBe(true);
  expect(seen.stillOpen, 'while still holding its space open').toBe(true);
});
