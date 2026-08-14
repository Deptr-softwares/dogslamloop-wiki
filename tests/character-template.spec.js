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

// THE MOBILE PAIR IS GONE, 2026-08-14, and four tests went with it.
//
// They guarded a real historical bug - initTabEditorButtons cloned
// style.cssText onto the History button, which carried a stale inline
// display:none and hid it on every system page but one - and they guarded the
// phantom-duplicate follow-on at desktop width. Both were fixed by giving the
// two buttons one shared class.
//
// The buttons themselves now do not exist. They only ever existed because the
// sidebar holding the real pair was display:none below 1024px; the contents
// became a drawer and carry that pair with them, so the copies in the page
// body were a second set of the same two controls, a tab row wide on the
// narrowest screen the site serves.
//
// Tests for DOM that is gone assert nothing, so what remains is the claim that
// matters: they do not come back. That a phone can still REACH Edit and
// History is asserted in mobile-drawers.spec.js, against the drawer.
test('no page re-introduces a second Edit/History pair in the body', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });

  for (const url of ['/characters/Boomcat/index.html', '/systems/hud/index.html', '/systems/tierlist/index.html']) {
    await page.goto(url, { waitUntil: 'networkidle' });

    await expect(page.locator('#btn-edit-current-tab-mobile'), url).toHaveCount(0);
    await expect(page.locator('#btn-history-current-tab-mobile'), url).toHaveCount(0);
    await expect(page.locator('.tab-editor-btn-mobile'), url).toHaveCount(0);
    await expect(page.locator('#mobile-btn-group'), url).toHaveCount(0);
  }
});

// The stylesheet has to lose the rules too. Dead CSS outliving its markup is
// what tierlist-live-dedupe.spec.js exists to police, and this is the same
// shape one file over.
test('the stylesheet drops the rules for the buttons that were removed', async ({ page, request }) => {
  const css = await (await request.get('/style/Layout.css')).text();

  // The comment recording the removal is allowed to name them; a rule is not.
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  expect(rules).not.toContain('.tab-editor-btn-mobile');
  expect(rules).not.toContain('#mobile-btn-group');
});
