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
// a documentation page wearing a character page's clothes (5 tabs instead of
// 7, extra prose) and must never be routed.
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

// The 7 character tabs, in source order, with the class list each div carries.
// The classes are not uniform (#tab-skills is .vessel-content.space-y-8 while
// #tab-overview is .tab-content) and that asymmetry is load-bearing for
// framedata.js/description.js, so it is asserted exactly rather than loosely.
const EXPECTED_CHARACTER_TABS = [
  { id: 'tab-overview', classes: ['tab-content'] },
  { id: 'tab-m1s', classes: ['tab-content', 'hidden'] },
  { id: 'tab-skills', classes: ['vessel-content', 'space-y-8', 'hidden'] },
  { id: 'tab-specials', classes: ['tab-content', 'hidden'] },
  { id: 'tab-matchups', classes: ['vessel-content', 'hidden'] },
  { id: 'tab-counterplay', classes: ['vessel-content', 'hidden'] },
  { id: 'tab-gallery', classes: ['vessel-content', 'hidden'] },
];

// Ids the shared chrome in js/pagebuilder.js, js/description.js and
// js/framedata.js look up directly. A router that omits any of them fails
// silently - most of these lookups bail without throwing.
const REQUIRED_CHROME_IDS = [
  'master-sidebar', 'global-sidebar-nav', 'sidebar-dynamic-dock',
  'mobile-menu-toggle', 'mobile-backdrop', 'dynamic-toc',
  'character-alerts-container', 'btn-edit-current-tab', 'btn-edit-current-tab-mobile',
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
      tabs: Array.from(document.querySelectorAll('[id^="tab-"]')).map(el => ({
        id: el.id,
        classes: Array.from(el.classList),
      })),
      chrome: Object.fromEntries(
        ['master-sidebar', 'global-sidebar-nav', 'sidebar-dynamic-dock',
         'mobile-menu-toggle', 'mobile-backdrop', 'dynamic-toc',
         'character-alerts-container', 'btn-edit-current-tab', 'btn-edit-current-tab-mobile']
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
      expect(sig.tabs.filter(t => t.id !== 'tab-ultimateAtk')).toEqual(EXPECTED_CHARACTER_TABS);
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
