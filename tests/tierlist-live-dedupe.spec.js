// Coverage for Workstream B Tier 5 (4/4): js/tierlist.js's LIVE RENDERER
// section (fetchTierRoster, getCharPortraitHTML, loadTierList,
// switchLiveTierTab) - the public tierlist page and the tier-list branch
// reused by history.html. The EDITOR BUILDER section (contributor
// drag-and-drop tier editor) is deliberately deferred as its own future
// pass, same precedent as editor.js in the original architecture plan.
//
// Real bug caught by the visual-regression suite itself: .tier-nav-overall-btn
// and .tier-nav-matchup-btn set `padding`/`border-color`, properties
// .btn-manga's own base rule also sets at the *same* specificity (both are
// single-class selectors) - a bare class rule only wins by source-order
// luck. It actually lost here: the "Overall" tab button rendered 16px
// shorter than intended (0.35rem base padding instead of the intended
// 0.85rem), shrinking the whole page. Fixed with compound selectors
// (.btn-manga.tier-nav-overall-btn) for a guaranteed, order-independent win.
//
// Also removed 5 confirmed-dead CSS classes (.tier-tabs/.tier-row/
// .tier-label/.tier-characters/.tier-char-tooltip) that had zero references
// anywhere in the codebase - leftover from an earlier iteration of this
// feature that current tierlist.js markup doesn't use.
//
// UPDATED 2026-08-13 (v0.14 item 3). The public tier list page no longer uses
// this renderer - it now shows N per-person lists via
// js/certified-tier-lists.js, covered by tests/certified-tier-lists.spec.js.
// The old renderer is still live for history.html and the admin preview, and
// the CSS specificity fix below is still exactly as load-bearing there, so
// these tests were re-pointed rather than deleted.
//
// They now build the markup themselves instead of waiting for a page to render
// it. That is what they were always about - a bare .tier-nav-overall-btn rule
// and .btn-manga's base rule are both single-class selectors, so the winner is
// decided by source order rather than intent - and asserting it directly means
// the coverage no longer depends on which page happens to draw these elements.
const { test, expect } = require('@playwright/test');

// Any page that loads Layout.css and Buttons.css proves the rule; the tier
// list page is used because it is the one these classes were written for.
const STYLED_PAGE = '/systems/tierlist/index.html';

async function withMarkup(page, html) {
  await page.goto(STYLED_PAGE, { waitUntil: 'domcontentloaded' });
  return page.evaluate((markup) => {
    const host = document.createElement('div');
    host.id = 'dedupe-harness';
    host.innerHTML = markup;
    document.body.appendChild(host);
  }, html);
}

test("tier-nav-overall-btn: compound selector wins over .btn-manga's base padding (the exact bug caught by the visual suite)", async ({ page }) => {
  // The original bug: the Overall tab rendered 16px shorter than intended
  // (0.35rem instead of 0.85rem) because .btn-manga's base rule won on source
  // order, shrinking the whole page.
  await withMarkup(page, '<button class="btn-manga tier-nav-overall-btn">Overall</button>');
  const padding = await page.locator('#dedupe-harness .tier-nav-overall-btn')
    .evaluate(el => getComputedStyle(el).paddingTop);
  expect(padding).toBe('13.6px'); // 0.85rem, not .btn-manga's base 0.35rem (5.6px)
});

test("tier-nav-matchup-btn: border-color comes from the per-character --tier-nav-color custom property, not .btn-manga's default", async ({ page }) => {
  await withMarkup(page, `
    <button class="btn-manga tier-nav-matchup-btn" style="--tier-nav-color: rgb(10, 20, 30)">A</button>
    <button class="btn-manga tier-nav-matchup-btn" style="--tier-nav-color: rgb(200, 100, 50)">B</button>
  `);
  const buttons = page.locator('#dedupe-harness .tier-nav-matchup-btn');
  const first = await buttons.first().evaluate(el => getComputedStyle(el).borderTopColor);
  const last = await buttons.last().evaluate(el => getComputedStyle(el).borderTopColor);
  // Different opponents have different character colors, so these must differ -
  // which proves the custom property drives the border rather than a shared
  // default from .btn-manga.
  expect(first).toBe('rgb(10, 20, 30)');
  expect(last).toBe('rgb(200, 100, 50)');
  expect(first).not.toBe(last);
});

test('tier portrait keeps its 60px size for the editor and history renderers', async ({ page }) => {
  // v0.14 raises this to 78px, but only under #tier-list-ui on the certified
  // page. The base size has to stay 60px everywhere else, because the editor's
  // drag-and-drop hit-testing was built around it.
  await withMarkup(page, '<div class="tier-portrait" style="background-color: rgb(1, 2, 3);"></div>');
  const portrait = page.locator('#dedupe-harness .tier-portrait');
  const styleAttr = await portrait.getAttribute('style');
  expect(styleAttr.trim()).toMatch(/^background-color: .+;$/);
  const size = await portrait.evaluate(el => ({ w: getComputedStyle(el).width, h: getComputedStyle(el).height }));
  expect(size.w).toBe('60px');
  expect(size.h).toBe('60px');
});

test('dead CSS cleanup: .tier-tabs/.tier-row/.tier-label/.tier-characters/.tier-char-tooltip no longer exist in the stylesheet', async ({ page }) => {
  await page.goto('/systems/tierlist/index.html', { waitUntil: 'networkidle' });
  const found = await page.evaluate(() => {
    const testEl = document.createElement('div');
    testEl.className = 'tier-row';
    document.body.appendChild(testEl);
    const bg = getComputedStyle(testEl).backgroundColor;
    testEl.remove();
    // The old .tier-row rule set background: var(--bg-secondary) - a real
    // background color. If the dead rule were still present this would not
    // be transparent.
    return bg;
  });
  expect(found).toBe('rgba(0, 0, 0, 0)');
});

test('the tier row label is coloured by the --tier-row-color custom property', async ({ page }) => {
  // Narrowed from what this test used to assert. It previously checked that
  // the RENDERER emitted exactly one inline custom property and no other
  // inline styles - a real claim, because it is what let a tier row be
  // recoloured without touching CSS. That claim is no longer observable from
  // this page: the certified page uses a different renderer, and asserting the
  // format of markup this test writes itself would be circular.
  //
  // What survives is the half that is still about the stylesheet: the label's
  // background has to come from the custom property rather than a hardcoded
  // rule. tests/certified-tier-lists.spec.js owns the new renderer's output,
  // and history.html still exercises the old one in the browser.
  await withMarkup(page, `
    <div class="tier-list-row">
      <div class="tier-list-row-label" style="--tier-row-color: rgb(9, 9, 9);"><span class="tier-list-row-label-text">S</span></div>
      <div class="tier-list-row-chars"></div>
    </div>
  `);

  const label = page.locator('#dedupe-harness .tier-list-row-label');
  const bg = await label.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(9, 9, 9)');
});
