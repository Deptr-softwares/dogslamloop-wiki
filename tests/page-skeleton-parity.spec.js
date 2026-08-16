// Equivalence harness for the v0.9 page router (phase R0).
//
// 22 character pages and 8 system pages are hand-authored files that differ
// from each other only in a handful of id/title lines. v0.9 replaces them with
// generated stubs that build the same DOM from a shared router module. This
// spec captures the structural contract those pages satisfy TODAY, so the
// router can be proven equivalent rather than assumed to be.
//
// Written and made green BEFORE any page is converted. Its assertions are the
// baseline: if converting a page forces an assertion to change, that is a real
// behaviour difference that needs a deliberate decision, not a spec tweak.
//
// Deliberately asserts structure, not content. These pages fetch their real
// content from Supabase at runtime, so anything that hashes rendered output
// would be flaky and would fail for reasons unrelated to the router.
const { test, expect } = require('@playwright/test');

// 22 of the 23 character directories. Template is excluded on purpose - it is
// a documentation page wearing a character page's clothes (its own shorter tab
// strip, extra prose) and must never be routed.
const CHARACTER_PAGES = [
  'Aspiring_mangaka', 'Black_death', 'Blood_manipulator', 'Boomcat', 'Crow_charmer',
  'Cursed_partners', 'Defense_attorney', 'Disaster_plants', 'Head_hei', 'Honored_one',
  'Locust_guy', 'Lucky_coward', 'Perfection', 'Puppet_master', 'Register',
  'Restless_gambler', 'Salaryman', 'Star_rage', 'Switcher', 'Ten_shadows',
  'True_cannon', 'Vessel',
];

// 8 of the 12 system directories. The other four are bespoke and stay
// hand-authored: collaborators (own fetch engine), tierlist (own pageType +
// tierlist.js), updatelog (home_widgets.js), color-codes (hand-authored
// swatch markup).
const SYSTEM_PAGES = [
  'evasive', 'framedata', 'fundamentals', 'hud',
  'm1-trading', 'starter-guide', 'terminologies', 'writing_guide',
];

// Every page the router must NOT touch. A generator bug that swallowed one of
// these would be silent and destructive, so it gets an explicit guard.
const NEVER_ROUTED = [
  '/characters/Template/index.html',
  '/systems/collaborators/index.html',
  '/systems/tierlist/index.html',
  '/systems/updatelog/index.html',
  '/systems/color-codes/index.html',
  '/characters/index.html',
  '/systems/index.html',
];

// The character tabs, in source order, with the class list each div carries.
// The classes are not uniform (#tab-skills is .vessel-content.space-y-8 while
// #tab-overview is .tab-content) and that asymmetry is load-bearing for
// framedata.js/description.js, so it is asserted exactly rather than loosely.
//
// Derived from js/character_tabs.js rather than restated here. This spec's
// claim is that the router builds what the vocabulary declares; a second copy
// would only ever assert that two hand-maintained lists agree with each other,
// and it was that copy - not the router - that broke when v0.15 added the
// Combos and Starter Guide tabs.
const EXPECTED_CHARACTER_TABS = (() => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'js', 'character_tabs.js'), 'utf8');
  const fakeWindow = {};
  new Function('window', src)(fakeWindow);
  return fakeWindow.getCharacterTabs().map(t => ({
    id: `tab-${t.id}`,
    classes: t.isDefault ? t.panelClass.split(' ') : t.panelClass.split(' ').concat('hidden'),
  }));
})();

// Ids the shared chrome in js/pagebuilder.js, js/description.js and
// js/framedata.js look up directly. A router that omits any of them fails
// silently - most of these lookups bail without throwing.
const REQUIRED_CHROME_IDS = [
  'master-sidebar', 'global-sidebar-nav', 'sidebar-dynamic-dock',
  'mobile-menu-toggle', 'mobile-backdrop', 'dynamic-toc',
  'character-alerts-container', 'btn-edit-current-tab',
];

async function captureSignature(page) {
  return page.evaluate(() => {
    const layout = document.querySelector('.site-layout');
    return {
      // Direct children of .site-layout, e.g. ["ASIDE.global-sidebar-left",
      // "MAIN.main-content-area", "ASIDE.local-sidebar-right"].
      layoutChildren: layout
        ? Array.from(layout.children).map(el =>
            el.tagName + (el.className ? '.' + el.className.trim().split(/\s+/).join('.') : ''))
        : null,
      // Direct children of the content area only. A bare [id^="tab-"] also
      // matches the nested variant tabs js/framedata.js builds inside a skill
      // card (tab-<move>-<variant>), so whether this passed depended on
      // whether the live frame data happened to arrive before the snapshot -
      // it failed CI intermittently on one character at a time. The router's
      // panels are the only tab elements it owns, and they are always direct
      // children.
      tabs: Array.from(document.querySelectorAll('.main-content-area > [id^="tab-"]')).map(el => ({
        id: el.id,
        classes: Array.from(el.classList),
      })),
      chrome: Object.fromEntries(
        ['master-sidebar', 'global-sidebar-nav', 'sidebar-dynamic-dock',
         'mobile-menu-toggle', 'mobile-backdrop', 'dynamic-toc',
         'character-alerts-container', 'btn-edit-current-tab']
          .map(id => [id, !!document.getElementById(id)])
      ),
      // js/pagebuilder.js:120 resolves the active tab through this exact
      // selector. It is the single most brittle contract the router inherits.
      activeNavButton: !!document.querySelector('nav.character-nav .btn-manga.active'),
      hasSidebarToggle: !!document.querySelector('.sidebar-toggle-btn'),
      // Non-empty proves the stylesheets were parsed before this ran.
      accentBlue: getComputedStyle(document.documentElement)
        .getPropertyValue('--accent-blue').trim(),
      // js/site_meta.js reads --frame-color-* via getComputedStyle at
      // script-parse time. If CSS ever became async these silently go blank
      // and every frame-data tick loses its colour.
      frameColorsPopulated: window.FRAME_COLORS
        ? Object.values(window.FRAME_COLORS).every(v => typeof v === 'string' && v !== '')
        : null,
      rootPath: typeof window.getRootPath === 'function' ? window.getRootPath() : null,
      kofiLink: !!document.querySelector('.kofi-btn-wrapper a'),
    };
  });
}

test.describe('character pages', () => {
  for (const dir of CHARACTER_PAGES) {
    test(`${dir}: skeleton contract`, async ({ page }) => {
      await page.goto(`/characters/${dir}/index.html`, { waitUntil: 'domcontentloaded' });
      const sig = await captureSignature(page);

      expect(sig.layoutChildren).toEqual([
        'ASIDE.global-sidebar-left',
        'MAIN.main-content-area.space-y-6',
        'ASIDE.local-sidebar-right',
      ]);
      // js/character_modes.js appends an Ultimate tab at runtime for
      // base-only characters, once it has read the page registry - so whether
      // it is present here depends on a network response, not on the router.
      // This spec is about what the router builds, so that tab is filtered
      // out rather than asserted either way. tests/character-modes.spec.js
      // owns the claim that it appears when it should.
      const routerTabs = sig.tabs.filter(t => t.id !== 'tab-ultimateAtk');

      // Ids and their order are the router's alone, and asserted exactly.
      expect(routerTabs.map(t => t.id)).toEqual(EXPECTED_CHARACTER_TABS.map(t => t.id));

      // Classes are asserted as a superset, not an exact match, and this is a
      // race fix rather than a loosening.
      //
      // loadPageDescriptions (js/description.js:740/827/881) adds
      // 'vessel-content space-y-6' to #tab-overview, #tab-matchups and
      // #tab-counterplay once the page's data arrives. The boot fires it
      // without awaiting, so whether it has run by the time this snapshot is
      // taken depends on how fast a network response came back - which made
      // this test fail on a different two or three characters every run, and
      // pass on the rest for no reason anyone could point at.
      //
      // The router's own classes are still asserted individually, including
      // the load-bearing asymmetry (#tab-skills gets space-y-8 while
      // #tab-overview gets plain .tab-content). What is no longer asserted is
      // the absence of classes the render layer legitimately adds afterwards,
      // which was never this spec's claim to make.
      EXPECTED_CHARACTER_TABS.forEach((expectedTab, i) => {
        expect(routerTabs[i].classes, `#${expectedTab.id} lost a router class`)
          .toEqual(expect.arrayContaining(expectedTab.classes));
      });
      for (const id of REQUIRED_CHROME_IDS) {
        expect(sig.chrome[id], `missing #${id}`).toBe(true);
      }
      expect(sig.activeNavButton).toBe(true);
      expect(sig.hasSidebarToggle).toBe(true);
      expect(sig.accentBlue).not.toBe('');
      expect(sig.frameColorsPopulated).toBe(true);
      expect(sig.rootPath).toBe('../../');
      expect(sig.kofiLink).toBe(true);
    });
  }
});

test.describe('system pages', () => {
  for (const dir of SYSTEM_PAGES) {
    test(`${dir}: skeleton contract`, async ({ page }) => {
      await page.goto(`/systems/${dir}/index.html`, { waitUntil: 'domcontentloaded' });
      const sig = await captureSignature(page);

      expect(sig.layoutChildren).toEqual([
        'ASIDE.global-sidebar-left',
        'MAIN.main-content-area.space-y-6',
        'ASIDE.local-sidebar-right',
      ]);
      // System pages ship no tab divs of their own - description.js creates
      // them from desc_data.tabs[] at runtime. Asserted at domcontentloaded,
      // before that fetch resolves.
      expect(sig.tabs).toEqual([]);
      // No #character-alerts-container check difference: system pages carry it
      // too, despite the name.
      for (const id of REQUIRED_CHROME_IDS) {
        expect(sig.chrome[id], `missing #${id}`).toBe(true);
      }
      expect(sig.hasSidebarToggle).toBe(true);
      expect(sig.accentBlue).not.toBe('');
      expect(sig.rootPath).toBe('../../');
      expect(sig.kofiLink).toBe(true);
    });
  }
});

test('system pages expose the container description.js requires', async ({ page }) => {
  // js/description.js:494 queries .main-content-area by CLASS and returns
  // early if absent - a router that renamed it would render nothing at all,
  // with no error anywhere.
  await page.goto('/systems/m1-trading/index.html', { waitUntil: 'domcontentloaded' });
  const found = await page.evaluate(() => ({
    contentArea: !!document.querySelector('.main-content-area'),
    // Nav is inserted afterend of this, falling back to afterbegin.
    header: !!document.querySelector('.main-content-area .home-main-header'),
    titleEl: !!document.getElementById('system-main-title'),
  }));
  expect(found).toEqual({ contentArea: true, header: true, titleEl: true });
});

test('bespoke and hub pages are never routed', async ({ page }) => {
  for (const url of NEVER_ROUTED) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const routed = await page.evaluate(() => typeof window.PAGE_ROUTE !== 'undefined');
    expect(routed, `${url} must not define window.PAGE_ROUTE`).toBe(false);
  }
});
