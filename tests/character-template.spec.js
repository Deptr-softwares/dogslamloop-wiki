// Coverage for Workstream B Tier 4: character page template dedupe.
// 9 of the 11 repeated inline-style blocks in characters/*/index.html were
// extracted to CSS classes in style/Layout.css. Two were deliberately left
// alone (see below). A real bug was caught while doing this: .character-nav
// is also reused by js/history.js and systems/tierlist/index.html's static
// nav with a *different* margin convention (margin-bottom, not margin-top)
// - a bare .character-nav rule would have leaked margin-top/align-items
// onto those unrelated elements, since inline styles only override the
// specific properties they set. Fixed by scoping to .character-header
// .character-nav, which only wraps a nav in the character page template.
const { test, expect } = require('@playwright/test');

test('character page: .character-nav inside .character-header gets margin-top and align-items from CSS', async ({ page }) => {
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  const nav = page.locator('header.character-header nav.character-nav');
  await expect(nav).toHaveAttribute('class', 'character-nav'); // no inline style attribute
  const cs = await nav.evaluate(el => ({ marginTop: getComputedStyle(el).marginTop, alignItems: getComputedStyle(el).alignItems }));
  expect(cs.marginTop).toBe('24px'); // 1.5rem
  expect(cs.alignItems).toBe('center');
});

test('tierlist system page: its own static .character-nav (not inside .character-header) is unaffected by the character-page rule', async ({ page }) => {
  await page.goto('/systems/tierlist/index.html', { waitUntil: 'networkidle' });
  const nav = page.locator('#tier-tabs-container.character-nav');
  // This element sets margin-bottom (not margin-top) inline; the shared
  // .character-header .character-nav rule must not add an unrequested
  // margin-top here (the regression this test guards against).
  const marginTop = await nav.evaluate(el => getComputedStyle(el).marginTop);
  expect(marginTop).toBe('0px');
});

test('previously-drifted Vessel/Template .character-nav now render identically to every other character page (align-items fix)', async ({ page }) => {
  for (const slug of ['Vessel', 'Template']) {
    await page.goto(`/characters/${slug}/index.html`, { waitUntil: 'networkidle' });
    const nav = page.locator('header.character-header nav.character-nav');
    const alignItems = await nav.evaluate(el => getComputedStyle(el).alignItems);
    expect(alignItems, `${slug} .character-nav align-items`).toBe('center');
  }
});

// Mobile-support pass: js/pagebuilder.js's initTabEditorButtons used to
// clone histBtn.style.cssText = sidebarBtn.style.cssText (and the mobile
// equivalent) instead of sharing a class. Real bug found and fixed: on
// system pages the mobile Edit button's static markup included an inline
// display: none (relied on an ID-specific !important CSS rule to become
// visible), which the clone carried onto the History button - but no
// matching override existed for that button's own ID, so
// #btn-history-current-tab-mobile stayed permanently display: none on
// every system page except tierlist (whose markup happened not to include
// the inline display: none, and so was hidden by nothing at all - not a
// correct fix, just a lucky miss). Both buttons now share
// .tab-editor-btn-sidebar/.tab-editor-btn-mobile directly, no cloning.
test('desktop sidebar: Edit and History buttons render via .tab-editor-btn-sidebar with no inline styles, equal flex width', async ({ page }) => {
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  const editBtn = page.locator('#btn-edit-current-tab');
  const histBtn = page.locator('#btn-history-current-tab');
  await expect(editBtn).toBeVisible();
  await expect(histBtn).toBeVisible();
  expect(await editBtn.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await histBtn.evaluate(el => el.hasAttribute('style'))).toBe(false);

  const editCs = await editBtn.evaluate(el => ({ display: getComputedStyle(el).display, fontSize: getComputedStyle(el).fontSize, flexGrow: getComputedStyle(el).flexGrow }));
  const histCs = await histBtn.evaluate(el => ({ display: getComputedStyle(el).display, fontSize: getComputedStyle(el).fontSize, flexGrow: getComputedStyle(el).flexGrow }));
  expect(editCs).toEqual(histCs); // identical sizing now that both share one class
  expect(editCs.display).toBe('flex');
  expect(editCs.fontSize).toBe('9.6px'); // 0.6rem
});

test('real bug fix: mobile nav History button is now visible on system pages (previously permanently display: none)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/systems/hud/index.html', { waitUntil: 'networkidle' });
  const editBtn = page.locator('#btn-edit-current-tab-mobile');
  const histBtn = page.locator('#btn-history-current-tab-mobile');
  expect(await editBtn.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await histBtn.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await editBtn.evaluate(el => getComputedStyle(el).display)).toBe('flex');
  expect(await histBtn.evaluate(el => getComputedStyle(el).display)).toBe('flex'); // was 'none' before the fix
});

test('mobile nav Edit/History buttons render identically on a character page and on tierlist (its embedded per-page <style> duplicate removed)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const url of ['/characters/Boomcat/index.html', '/systems/tierlist/index.html']) {
    await page.goto(url, { waitUntil: 'networkidle' });
    const editBtn = page.locator('#btn-edit-current-tab-mobile');
    const histBtn = page.locator('#btn-history-current-tab-mobile');
    expect(await editBtn.evaluate(el => el.hasAttribute('style')), url).toBe(false);
    expect(await editBtn.evaluate(el => getComputedStyle(el).display), url).toBe('flex');
    expect(await histBtn.evaluate(el => getComputedStyle(el).display), url).toBe('flex');
    expect(await editBtn.evaluate(el => getComputedStyle(el).fontSize), url).toBe('11.2px'); // 0.7rem
  }
});

test('real bug fix: mobile History button clone no longer leaks through as a phantom duplicate button at desktop width', async ({ page }) => {
  // The old style.cssText clone never set an explicit display on the
  // History button, and only #btn-edit-current-tab-mobile itself (not its
  // #btn-history-current-tab-mobile clone) had an ID-specific
  // "display: none !important" override - so on every character page, at
  // every viewport width, .btn-sys's own display: inline-flex leaked
  // through and the cloned History button rendered as a stray extra
  // button inside nav.character-nav, wrapping onto its own row below the
  // tabs. Now both buttons share .tab-editor-btn-mobile's single
  // display: none !important rule.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  const histBtnMobile = page.locator('#btn-history-current-tab-mobile');
  expect(await histBtnMobile.evaluate(el => getComputedStyle(el).display)).toBe('none'); // was 'inline-flex' before the fix
});

test('desktop width: mobile-exclusive Edit/History buttons stay hidden regardless of .is-active', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  const editBtn = page.locator('#btn-edit-current-tab-mobile');
  expect(await editBtn.evaluate(el => el.classList.contains('is-active'))).toBe(true);
  expect(await editBtn.evaluate(el => getComputedStyle(el).display)).toBe('none'); // the unconditional !important rule outside the media query
});
