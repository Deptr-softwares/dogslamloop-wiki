// Profile Description on a character page (v1.1). Owner's list: "Add Profile
// Description (have: Quote, Trivia, Next, and Previous) to a Character Page".
// Scoped 2026-10-19: its own section under the portrait and the overview text;
// a quote with an optional speaker and trivia as a list, both taking format
// tags; Previous and Next in the Characters page order with base-only
// characters last and hidden ones left out, no wrap at the ends.
//
// The page data AND the character list are fixtures, so nothing here reads
// what the owner has written or which characters exist.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const NAV = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'navigation.json'), 'utf8'));
const BOOMCAT = NAV.Characters.find(c => (c.cms_config || {}).pageId === 'boomcat');

const fake = (id, name, extra = {}) => ({
  id, name, url: `characters/${id}/index.html`, cms_config: { pageType: 'character', pageId: id.toLowerCase() }, ...extra,
});
// Page order as listed: A, H (hidden), B (base-only), Boomcat, U (unpublished), C.
// The order Previous / Next follow: A, Boomcat, C, then B.
const ROSTER = [
  fake('Zzq_alpha', 'Zzq Alpha'),
  fake('Zzq_hidden', 'Zzq Hidden', { isHidden: true }),
  fake('Zzq_base', 'Zzq Base', { isBaseOnly: true }),
  BOOMCAT,
  fake('Zzq_unpub', 'Zzq Unpublished', { published: false }),
  fake('Zzq_charlie', 'Zzq Charlie'),
];

const para = (text) => ({ type: 'paragraph', content: [text], align: 'left' });
const DESC = {
  overview: [para('overview text')],
  strategy: [para('strategy text')],
  extras: [],
  profile: {
    stats: [{ label: 'Archetype', value: 'Zoner' }], image: '',
    quote: 'I [b]never[/b] miss.', quoteSpeaker: 'Zzq Speaker',
    trivia: ['First [b]fact[/b]', 'Second fact'],
  },
};
const FRAME = { m1s: [], specials: [], skills: [] };

function mockSite(page, desc = DESC) {
  return Promise.all([
    page.route(/data\/navigation\.json/, route => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ ...NAV, Characters: ROSTER }),
    })),
    page.addInitScript(({ desc, frame }) => {
      try {
        localStorage.setItem('dsl_editor_tutorial_seen', '1');
        localStorage.setItem('dsl_notice_seen_editor', '1');
      } catch (e) { /* ignore */ }
      const rowsFor = (table) => {
        if (table === 'page_data') return { data: { page_id: 'boomcat', desc_data: JSON.parse(JSON.stringify(desc)), frame_data: JSON.parse(JSON.stringify(frame)) }, error: null };
        if (['user_roles', 'site_settings', 'page_permissions', 'pending_revisions'].includes(table)) return { data: null, error: null };
        return { data: [], error: null };
      };
      const builder = (table) => {
        const result = rowsFor(table);
        const chain = {
          select() { return chain; }, eq() { return chain; }, in() { return chain; }, neq() { return chain; },
          order() { return chain; }, limit() { return chain; }, is() { return chain; }, or() { return chain; },
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
    }, { desc, frame: FRAME }),
  ]);
}

const section = (page) => page.locator('#tab-overview .profile-description');

test.beforeAll(() => {
  expect(BOOMCAT, 'the fixtures are built around the Boomcat page').toBeTruthy();
});

// --- THE READER PAGE ---

test('the Profile section sits under the portrait and overview, with the quote, trivia and Previous / Next', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await mockSite(page);
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'domcontentloaded' });
  await expect(section(page)).toBeVisible({ timeout: 20000 });

  // Under the top, before General Strategy.
  const order = await page.evaluate(() => {
    const kids = [...document.getElementById('tab-overview').children];
    const at = (sel) => kids.findIndex(k => k.matches(sel));
    return { top: at('.profile-top-split'), profile: at('.profile-description'), strategy: at('#overview-strategy-subnode') };
  });
  expect(order.profile).toBe(order.top + 1);
  expect(order.strategy).toBeGreaterThan(order.profile);

  await expect(section(page).locator('.profile-description-title')).toHaveText(/profile/i);
  await expect(section(page).locator('.profile-quote blockquote')).toContainText('I never miss.');
  await expect(section(page).locator('.profile-quote figcaption')).toContainText('Zzq Speaker');
  await expect(section(page).locator('.profile-trivia li')).toHaveCount(2);
  // Format tags work in both.
  await expect(section(page).locator('.profile-quote strong.sc-b')).toHaveText('never');
  await expect(section(page).locator('.profile-trivia strong.sc-b')).toHaveText('fact');

  // Previous / Next skip the hidden and unpublished pages around Boomcat.
  const prev = section(page).locator('.profile-pager-prev');
  const next = section(page).locator('.profile-pager-next');
  await expect(prev).toContainText('Zzq Alpha');
  await expect(next).toContainText('Zzq Charlie');
  await expect(prev).toHaveAttribute('href', /characters\/Zzq_alpha\/index\.html$/);
  await expect(next).toHaveAttribute('href', /characters\/Zzq_charlie\/index\.html$/);
  expect(errors).toEqual([]);
});

test('the order: base-only last, hidden and unpublished left out, no wrap at the ends', async ({ page }) => {
  await mockSite(page);
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'domcontentloaded' });
  await expect(section(page)).toBeVisible({ timeout: 20000 });

  const pagerFor = (pageId) => page.evaluate(async (pageId) => {
    const host = document.createElement('div');
    host.innerHTML = window.profileDescriptionHTML({ quote: 'q' });
    document.body.appendChild(host);
    await window.fillProfilePager(host, pageId);
    const nav = host.querySelector('[data-profile-pager]');
    const name = (sel) => { const a = nav.querySelector(sel); return a ? a.querySelector('.profile-pager-name').textContent : null; };
    const out = { shown: !nav.hidden, prev: name('.profile-pager-prev'), next: name('.profile-pager-next') };
    host.remove();
    return out;
  }, pageId);

  expect(await pagerFor('zzq_alpha'), 'the first has no Previous').toEqual({ shown: true, prev: null, next: 'Boomcat' });
  expect(await pagerFor('zzq_charlie'), 'base-only comes after everyone else').toEqual({ shown: true, prev: 'Boomcat', next: 'Zzq Base' });
  expect(await pagerFor('zzq_base'), 'the last has no Next, and nothing wraps').toEqual({ shown: true, prev: 'Zzq Charlie', next: null });
  expect(await pagerFor('zzq_hidden'), 'a hidden page gets none').toEqual({ shown: false, prev: null, next: null });
});

test('with no quote or trivia only Previous / Next show, and a hidden page shows no section at all', async ({ page }) => {
  await mockSite(page);
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'domcontentloaded' });
  await expect(section(page)).toBeVisible({ timeout: 20000 });

  const out = await page.evaluate(async () => {
    const run = async (pageId) => {
      const host = document.createElement('div');
      host.innerHTML = window.profileDescriptionHTML({ stats: [] });
      document.body.appendChild(host);
      await window.fillProfilePager(host, pageId);
      const s = host.querySelector('.profile-description');
      const r = {
        visible: getComputedStyle(s).display !== 'none',
        title: !!s.querySelector('.profile-description-title'),
        links: s.querySelectorAll('.profile-pager-link').length,
      };
      host.remove();
      return r;
    };
    return { shown: await run('boomcat'), hidden: await run('zzq_hidden') };
  });

  expect(out.shown).toEqual({ visible: true, title: false, links: 2 });
  expect(out.hidden.visible, 'nothing to show, so no empty card').toBe(false);
});

test('quote, speaker and trivia are shown as text, never as markup', async ({ page }) => {
  const hostile = JSON.parse(JSON.stringify(DESC));
  hostile.profile.quote = '<img src=x onerror="window.__PWN=1">quote';
  hostile.profile.quoteSpeaker = '<b>who</b>';
  hostile.profile.trivia = ['<script>window.__PWN=1</script>fact'];
  await mockSite(page, hostile);
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'domcontentloaded' });
  await expect(section(page)).toBeVisible({ timeout: 20000 });

  await expect(section(page).locator('.profile-quote blockquote')).toContainText('<img src=x');
  await expect(section(page).locator('.profile-quote figcaption')).toContainText('<b>who</b>');
  await expect(section(page).locator('.profile-trivia li')).toContainText('<script>');
  expect(await section(page).locator('img, b, script').count()).toBe(0);
  expect(await page.evaluate(() => window.__PWN)).toBeUndefined();
});

// --- THE EDITOR ---

async function openProfileCard(page, desc) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 900 });
  await mockSite(page, desc);
  await page.goto('/edit.html?char=boomcat&type=character&tab=overview', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#overview-nav-profile')).toBeVisible({ timeout: 45000 });
  await page.locator('#overview-nav-profile').click();
  await expect(page.locator('#profile-quote-input')).toBeVisible();
  return errors;
}

const NO_PROFILE_TEXT = { ...DESC, profile: { stats: [], image: '' } };
const profileNow = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.editorMasterDescData.profile)));
const profileDeltas = (page) => page.evaluate(async () =>
  (await window.collectEditorDeltas()).filter(d => d.scope === 'profile').map(d => d.payload));

test('the Profile Card form edits the quote, speaker and trivia, the preview shows them, and Submit carries them', async ({ page }) => {
  const errors = await openProfileCard(page, NO_PROFILE_TEXT);

  await page.locator('#profile-quote-input').fill('Typed [b]quote[/b]');
  await page.locator('#profile-quote-speaker-input').fill('Typed Speaker');
  await page.locator('#profile-trivia-input').fill('One\n\nTwo');

  await expect.poll(async () => {
    const p = await profileNow(page);
    return { quote: p.quote, quoteSpeaker: p.quoteSpeaker, trivia: p.trivia };
  }).toEqual({ quote: 'Typed [b]quote[/b]', quoteSpeaker: 'Typed Speaker', trivia: ['One', 'Two'] });

  const preview = page.locator('.live-preview-pane #tab-overview .profile-description');
  await expect(preview.locator('.profile-quote blockquote')).toContainText('Typed quote');
  await expect(preview.locator('.profile-trivia li')).toHaveCount(2);

  const deltas = await profileDeltas(page);
  expect(deltas).toHaveLength(1);
  expect(deltas[0]).toMatchObject({ quote: 'Typed [b]quote[/b]', quoteSpeaker: 'Typed Speaker', trivia: ['One', 'Two'] });
  expect(errors).toEqual([]);
});

test('emptying the fields leaves no change behind to submit', async ({ page }) => {
  await openProfileCard(page, NO_PROFILE_TEXT);

  await page.locator('#profile-quote-input').fill('temporary');
  await page.locator('#profile-trivia-input').fill('temporary');
  await page.locator('#profile-quote-input').fill('   ');
  await page.locator('#profile-trivia-input').fill('\n');

  await expect.poll(async () => Object.keys(await profileNow(page)).sort()).toEqual(['image', 'stats']);
  expect(await profileDeltas(page)).toEqual([]);
});

test('undo on the Profile Card puts the quote back', async ({ page }) => {
  await openProfileCard(page, NO_PROFILE_TEXT);

  await page.locator('#profile-quote-input').fill('first version');
  await expect.poll(async () => (await profileNow(page)).quote).toBe('first version');
  // History records on the same 400ms pause as the preview.
  await page.waitForTimeout(600);
  await page.locator('#profile-quote-input').fill('second version');
  await page.waitForTimeout(600);

  await page.locator('[data-form-undo]').click();
  await expect(page.locator('#profile-quote-input')).toHaveValue('first version');
  expect((await profileNow(page)).quote).toBe('first version');
});
