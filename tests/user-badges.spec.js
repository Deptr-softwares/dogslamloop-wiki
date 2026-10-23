// User badges, an early version (the Halloween update, owner, 2026-10-23).
//
// Two badges: "DSL Halloween 2026 - Gold Ver" for beating the minigame on the
// first try, "DSL Halloween 2026" for beating it later. A first try is a game
// played while dsl_halloween_done is unset, so clearing it earns Gold again,
// which the owner wants ("It is just fun"). They live in
// user_profiles.badges, a list (owner: "its own column ... in a list []"),
// and each one can be hidden (owner: "toggleable by users"). Shown ones sit
// after the flair beside a name, and in a BADGES box on the public profile,
// drawn as a skill slot with the owner's pumpkin in it.
//
// A win signed in is saved at once; signed out it waits on the device until
// the winner signs in, and a toast says which.
//
// RLS and grants are invisible to Playwright: the migration half here is
// static, and the local database and the preview branch probe the SQL.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const MIG = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261023000000_user_badges.sql'), 'utf8');
const CODE = MIG.replace(/--[^\n]*/g, ' ');
const GOLD = 'halloween-2026-gold';
const PLAIN = 'halloween-2026';
const THREAD = '/characters/Honored_one/index.html';

const SESSION = {
  access_token: 't',
  user: {
    id: 'u1', email: 'someone@site.test',
    user_metadata: { display_name: 'Boomcat' },
    app_metadata: { provider: 'email' }, identities: [{ provider: 'email' }],
  },
};

// supabase-js, with only the calls this feature makes answered.
async function mockSupabase(page, { session = null, profileRow = null, profiles = [], rows = [], claimError = null } = {}) {
  await page.addInitScript((o) => {
    window.__claims = [];
    window.__upserts = [];
    window.__updates = [];
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (!lib || !lib.createClient || lib.__patched) return;
        lib.__patched = true;
        const orig = lib.createClient.bind(lib);
        lib.createClient = (...args) => {
          const client = orig(...args);
          client.auth.getSession = async () => ({ data: { session: o.session } });
          client.auth.onAuthStateChange = () => ({ data: { subscription: { unsubscribe() {} } } });
          client.rpc = async (name, params) => {
            if (name === 'claim_badge') {
              window.__claims.push(params.badge_id);
              return o.claimError ? { data: null, error: o.claimError } : { data: [params.badge_id], error: null };
            }
            if (name === 'get_public_profiles') {
              return { data: o.profiles.filter(p => params.target_user_ids.includes(p.user_id)), error: null };
            }
            return { data: [], error: null };
          };
          const inert = new Proxy({}, {
            get(_t, prop) {
              if (prop === 'then') return (r) => r({ data: [], error: null });
              if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null });
              return () => inert;
            },
          });
          client.from = (table) => {
            if (table === 'page_discussions') {
              const q = { top: false, parents: null, head: false };
              const chain = {
                select(_c, opt) { if (opt && opt.head) q.head = true; return this; },
                eq() { return this; },
                is(c, v) { if (c === 'parent_id' && v === null) q.top = true; return this; },
                in(c, v) { if (c === 'parent_id') q.parents = v; return this; },
                order() { return this; }, range() { return this; },
                then(resolve) {
                  if (q.head) return resolve({ data: null, count: o.rows.length, error: null });
                  if (q.parents) return resolve({ data: o.rows.filter(r => q.parents.includes(r.parent_id)), error: null });
                  return resolve({ data: q.top ? o.rows.filter(r => r.parent_id === null) : o.rows, error: null });
                },
              };
              return chain;
            }
            if (table === 'user_profiles') {
              const chain = {
                select() { return chain; }, eq() { return chain; },
                single: () => o.profileRow
                  ? Promise.resolve({ data: o.profileRow, error: null })
                  : Promise.reject(new Error('no rows')),
                upsert(payload) {
                  window.__upserts.push(payload);
                  return Promise.resolve({ data: [payload], error: null });
                },
                update(payload) {
                  return { eq: (col, val) => { window.__updates.push({ payload, where: [col, val] }); return Promise.resolve({ data: null, error: null }); } };
                },
              };
              return chain;
            }
            return inert;
          };
          return client;
        };
      },
    });
  }, { session, profileRow, profiles, rows, claimError });
}

const post = (over = {}) => ({
  id: 'p1', page_id: 'honored_one', parent_id: null,
  author_id: 'u-other', author_name: 'mango_kun', body: 'Divergent Fist into Black Flash',
  status: 'visible', created_at: '2026-10-23T10:00:00Z', removed_at: null, removed_by: null,
  ...over,
});
const person = (over = {}) => ({
  user_id: 'u-other', display_name: 'mango_kun', bio: null, flair: null,
  is_private: false, standing: null, joined_at: null, badges: [], ...over,
});

async function openThread(page, profiles, rows = [post()]) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await mockSupabase(page, { rows, profiles });
  await page.goto(THREAD, { waitUntil: 'networkidle' });
  await page.waitForSelector('#discussion-section .discussion-title');
  return errors;
}

// --- THE MIGRATION ---

test('the badges the database hands out are exactly the ones the site can draw, both ways', async ({ page }) => {
  // claim_badge()'s list and window.SITE_BADGES must agree: an id the site
  // cannot draw would be earned and never seen, and one the database refuses
  // would be drawn and never kept.
  const listed = CODE.match(/"badge_id" = ANY \(ARRAY\[([^\]]+)\]\)/);
  expect(listed, 'claim_badge names its badges').not.toBeNull();
  const claimable = listed[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).sort();

  await page.goto('/404.html', { waitUntil: 'domcontentloaded' });
  const site = await page.evaluate(() => Object.entries(window.SITE_BADGES).map(([id, b]) => ({ id, icon: b.icon })));
  expect(site.map(b => b.id).sort()).toEqual(claimable);
  expect(claimable).toEqual([PLAIN, GOLD].sort());
  for (const b of site) expect(fs.existsSync(path.join(__dirname, '..', b.icon)), b.icon).toBe(true);
});

test('only claim_badge writes badges: a reader can write which they hide, never which they have', async () => {
  expect(CODE).toMatch(/REVOKE INSERT, UPDATE ON TABLE "public"\."user_profiles" FROM "authenticated"/);
  const grants = Object.fromEntries([...CODE.matchAll(/GRANT (INSERT|UPDATE) \(([^)]+)\)\s+ON TABLE "public"\."user_profiles" TO "authenticated"/g)]
    .map(g => [g[1], g[2].split(',').map(c => c.trim().replace(/"/g, ''))]));
  expect(Object.keys(grants).sort()).toEqual(['INSERT', 'UPDATE']);
  for (const [verb, cols] of Object.entries(grants)) {
    expect(cols, `${verb} still covers the profile save`).toEqual(expect.arrayContaining(['user_id', 'bio', 'flair', 'is_private']));
    expect(cols, `${verb} never covers badges`).not.toContain('badges');
  }
  // Hiding is an UPDATE: an upsert's would-be row has no badges to hide.
  expect(grants.UPDATE).toContain('hidden_badges');
  expect(grants.INSERT).not.toContain('hidden_badges');
  expect(CODE, 'only a badge you have can be hidden').toMatch(/CHECK \("hidden_badges" <@ "badges"/);
});

test('claim_badge checks its caller before it writes, and is not open to logged-out callers', async () => {
  const body = CODE.slice(CODE.indexOf('FUNCTION "public"."claim_badge"'));
  const guard = body.indexOf('IF "caller" IS NULL');
  const banned = body.indexOf("IS NOT DISTINCT FROM 'viewer'");
  const write = body.indexOf('INSERT INTO "public"."user_profiles"');
  expect(guard).toBeGreaterThan(-1);
  expect(banned).toBeGreaterThan(guard);
  expect(write).toBeGreaterThan(banned);
  expect(CODE).toMatch(/REVOKE ALL ON FUNCTION "public"\."claim_badge"\(text\) FROM "anon"/);
  expect(CODE).toMatch(/GRANT EXECUTE ON FUNCTION "public"\."claim_badge"\(text\) TO "authenticated"/);
});

test('the remade profile reader keeps its privacy rules and hands out only shown badges', async () => {
  const fn = CODE.slice(CODE.indexOf('CREATE FUNCTION "public"."get_public_profiles"'));
  expect(fn).toMatch(/CASE WHEN COALESCE\(up\."is_private", false\) THEN NULL ELSE up\."bio" END/);
  expect(fn).not.toMatch(/au\."email"|->>'email'/);
  expect(fn).toMatch(/target_user_ids"\[1:200\]/);
  expect(fn).toMatch(/IS DISTINCT FROM 'viewer'/);
  expect(fn, 'a hidden badge is filtered out in the database').toMatch(/NOT \(held\.id = ANY \(COALESCE\(up\."hidden_badges"/);
  expect(fn).toMatch(/GRANT EXECUTE ON FUNCTION "public"\."get_public_profiles"\(uuid\[\]\) TO "anon"/);
});

// --- BESIDE A NAME ---

test('shown badges sit after the flair as skill slots, named on hover, gold framed in gold', async ({ page }) => {
  const errors = await openThread(page, [person({ flair: 'Pro Player', badges: [GOLD, PLAIN, 'not-a-badge'] })]);
  const author = page.locator('.discussion-author-link').first();
  const slots = author.locator('.user-badge');
  await expect(slots).toHaveCount(2);

  const seen = await author.evaluate((a) => {
    const flair = a.querySelector('.discussion-flair');
    const [gold, plain] = a.querySelectorAll('.user-badge');
    const img = gold.querySelector('img');
    return {
      afterFlair: !!(flair.compareDocumentPosition(gold) & Node.DOCUMENT_POSITION_FOLLOWING),
      title: gold.title, alt: img.alt, src: img.getAttribute('src'),
      goldFrame: getComputedStyle(gold).borderTopColor, plainFrame: getComputedStyle(plain).borderTopColor,
      plainTitle: plain.title,
    };
  });
  expect(seen).toMatchObject({ afterFlair: true, title: 'DSL Halloween 2026 - Gold Ver', alt: 'DSL Halloween 2026 - Gold Ver', plainTitle: 'DSL Halloween 2026' });
  expect(seen.src).toMatch(/medias\/images\/GoldenPumpkin2026\.png$/);
  expect(seen.goldFrame).toBe('rgb(242, 201, 76)');
  expect(seen.plainFrame).not.toBe(seen.goldFrame);
  // The picture really loads from a page two folders deep.
  await expect.poll(() => slots.first().locator('img').evaluate(i => i.naturalWidth)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('a person with badges and no flair still shows them; one with none, or a site ahead of its database, shows none', async ({ page }) => {
  const errors = await openThread(page, [
    person({ badges: [PLAIN] }),
    person({ user_id: 'u-none', badges: [] }),
    // get_public_profiles before the release has no badges column at all.
    { user_id: 'u-old', display_name: 'old', bio: null, flair: null, is_private: false, standing: null, joined_at: null },
  ], [post(), post({ id: 'p2', author_id: 'u-none', author_name: 'nobody' }), post({ id: 'p3', author_id: 'u-old', author_name: 'old' })]);
  const author = (id) => page.locator(`.discussion-author-link[data-profile-user="${id}"]`);
  await expect(author('u-other').locator('.user-badge')).toHaveCount(1);
  await expect(author('u-other').locator('.user-badge')).toHaveAttribute('title', 'DSL Halloween 2026');
  await expect(author('u-other').locator('.discussion-flair')).toHaveCount(0);
  // Drawn by now: the badge above came from the same pass.
  await expect(author('u-none')).toHaveText('nobody');
  await expect(author('u-none').locator('.user-badge')).toHaveCount(0);
  await expect(author('u-old')).toHaveText('old');
  await expect(author('u-old').locator('.user-badge')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// --- ON A PROFILE ---

test('their profile names each badge they show and how it was earned', async ({ page }) => {
  await openThread(page, [person({ badges: [GOLD] })]);
  await page.locator('.discussion-author-link').first().click();
  const box = page.locator('#pubprofile-badges');
  await expect(box).toBeVisible();
  await expect(box.locator('.pubprofile-badge')).toHaveCount(1);
  await expect(box).toContainText('DSL Halloween 2026 - Gold Ver');
  await expect(box).toContainText('Hit the final Black Flash on the first try');
});

test('a profile with no badges shows no badge box, even after one that had them', async ({ page }) => {
  await openThread(page, [person({ badges: [GOLD] }), person({ user_id: 'u-none', display_name: 'nobody' })],
    [post(), post({ id: 'p2', author_id: 'u-none', author_name: 'nobody' })]);
  await page.locator('.discussion-author-link[data-profile-user="u-other"]').click();
  await expect(page.locator('#pubprofile-badges')).toBeVisible();
  await page.locator('#public-profile-overlay button', { hasText: 'CLOSE' }).click();
  await page.locator('.discussion-author-link[data-profile-user="u-none"]').click();
  await expect(page.locator('#pubprofile-name')).toHaveText('nobody');
  await expect(page.locator('#pubprofile-badges')).toBeHidden();
});

// --- YOUR OWN PROFILE: SHOW OR HIDE ---

async function openOwnProfile(page, profileRow) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await mockSupabase(page, { session: SESSION, profileRow });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#dock-btn-auth').click();
  await expect(page.locator('#profile-modal-overlay')).not.toHaveClass(/hidden/);
  return errors;
}

test('each badge has SHOW, and the save sends which ones are hidden', async ({ page }) => {
  const errors = await openOwnProfile(page, {
    user_id: 'u1', bio: null, flair: null, is_private: false,
    badges: [GOLD, PLAIN, 'future-badge'], hidden_badges: [PLAIN, 'future-badge'],
  });
  const rows = page.locator('#profile-badges-field .profile-badge-row');
  await expect(page.locator('#profile-badges-field')).toBeVisible();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('DSL Halloween 2026 - Gold Ver');
  const gold = rows.nth(0).locator('input[type="checkbox"]');
  const plain = rows.nth(1).locator('input[type="checkbox"]');
  await expect(gold).toBeChecked();
  await expect(plain).not.toBeChecked();

  // The whole row is the label: clicking its name flips it.
  await rows.nth(0).locator('strong').click();
  await expect(gold).not.toBeChecked();
  await plain.check();
  await page.locator('#btn-profile-save').click();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const [{ payload: saved, where }] = await page.evaluate(() => window.__updates);
  // An UPDATE of their own row: an upsert cannot carry hidden_badges.
  expect(where).toEqual(['user_id', 'u1']);
  expect(await page.evaluate(() => window.__upserts)).toEqual([]);
  // A badge this page cannot draw stays hidden; the one unticked is hidden now.
  expect(saved.hidden_badges).toEqual(['future-badge', GOLD]);
  expect(saved).not.toHaveProperty('badges');
  await expect(page.locator('#profile-feedback')).not.toHaveClass(/profile-feedback-bad/);
  expect(errors).toEqual([]);
});

test('before the release, with no badges column, the field stays away and the save sends nothing about badges', async ({ page }) => {
  await openOwnProfile(page, { user_id: 'u1', bio: 'hi', flair: null, is_private: false });
  await expect(page.locator('#profile-badges-field')).toBeHidden();
  await page.locator('#btn-profile-save').click();
  await expect.poll(() => page.evaluate(() => window.__upserts.length)).toBe(1);
  const [saved] = await page.evaluate(() => window.__upserts);
  expect(Object.keys(saved).sort()).toEqual(['bio', 'flair', 'is_private', 'user_id']);
});

// --- EARNING ONE: THE MINIGAME ---

test.describe('winning the minigame', () => {
  test.use({ timezoneId: 'UTC' });
  const DURING = new Date('2026-10-25T12:00:00Z');

  async function arm(page, { session = null, done = null, claimError = null, reducedMotion = false } = {}) {
    if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockSupabase(page, { session, claimError });
    await page.clock.install({ time: DURING });
    await page.clock.pauseAt(new Date(DURING.getTime() + 1000));
    await page.addInitScript(({ done }) => {
      Object.defineProperty(Navigator.prototype, 'webdriver', { configurable: true, get: () => false });
      Math.random = () => 0.01;
      HTMLMediaElement.prototype.play = () => Promise.resolve();
      HTMLMediaElement.prototype.pause = () => {};
      // Once, not on every load: a reload must see what the game wrote.
      if (!sessionStorage.getItem('armed')) {
        sessionStorage.setItem('armed', '1');
        localStorage.setItem('dsl_editor_tutorial_seen', '1');
        if (done) localStorage.setItem('dsl_halloween_done', done);
      }
    }, { done });
    await page.goto('/404.html', { waitUntil: 'domcontentloaded' });
  }
  const game = (page) => page.locator('.hw-game');
  async function fist(page, gap) {
    await page.keyboard.press('Space');
    await page.clock.runFor(gap);
    await page.keyboard.press('Space');
    await page.clock.runFor(650);
  }
  // Wakes it (a click, or Site settings), plays four fists, and lets it close.
  async function playThrough(page, { win = true, via = 'click' } = {}) {
    if (via === 'click') {
      await page.locator('h1').first().click();
    } else {
      await page.locator('#dock-btn-settings').click();
      await page.locator('[data-halloween-replay]').click();
    }
    await expect(game(page)).toHaveCount(1);
    await page.clock.runFor(1600);
    for (let i = 0; i < 4; i++) await fist(page, win ? 300 : 100);
    await page.clock.runFor(700 + (win ? 2600 : 7300) + 1000);
    await expect(game(page)).toHaveCount(0);
  }
  const toast = (page) => page.locator('.badge-toast');
  const pending = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('dsl_badges_pending') || '[]'));
  const claims = (page) => page.evaluate(() => window.__claims);

  test('a first-try win signed out earns Gold Ver, kept on the device until they sign in', async ({ page }) => {
    await arm(page);
    await playThrough(page);
    await expect(toast(page)).toBeVisible();
    await expect(toast(page)).toContainText('BADGE EARNED');
    await expect(toast(page)).toContainText('DSL Halloween 2026 - Gold Ver');
    await expect(toast(page)).toContainText('Sign in by November 7 to keep it.');
    expect(await pending(page)).toEqual([GOLD]);
    expect(await claims(page), 'nothing to claim with').toEqual([]);
    // LOGIN goes to signing in.
    await toast(page).getByRole('button', { name: 'LOGIN' }).click();
    await expect(page.locator('#auth-modal-overlay')).not.toHaveClass(/hidden/);
    await expect(toast(page)).toHaveCount(0);
  });

  test('a later win signed in earns the other one, saved straight away', async ({ page }) => {
    await arm(page, { session: SESSION, done: '1' });
    await playThrough(page, { via: 'settings' });
    await expect(toast(page)).toContainText('DSL Halloween 2026');
    await expect(toast(page)).not.toContainText('Gold Ver');
    await expect(toast(page)).toContainText('On your profile now.');
    await expect(toast(page).getByRole('button', { name: 'LOGIN' })).toHaveCount(0);
    expect(await claims(page)).toEqual([PLAIN]);
    expect(await pending(page)).toEqual([]);
  });

  test('clearing dsl_halloween_done makes the next game a first try again (the owner\'s cheese)', async ({ page }) => {
    await arm(page, { session: SESSION, done: '1' });
    await page.evaluate(() => localStorage.removeItem('dsl_halloween_done'));
    await playThrough(page, { via: 'settings' });
    expect(await claims(page)).toEqual([GOLD]);
  });

  test('a reader spared the surprise still gets a first try', async ({ page }) => {
    await arm(page, { session: SESSION, reducedMotion: true });
    expect(await page.evaluate(() => localStorage.getItem('dsl_halloween_done')), 'the look is on without a game played').toBe('spared');
    await playThrough(page, { via: 'settings' });
    expect(await claims(page)).toEqual([GOLD]);
  });

  test('losing earns nothing', async ({ page }) => {
    await arm(page, { session: SESSION });
    await playThrough(page, { win: false });
    expect(await claims(page)).toEqual([]);
    await expect(toast(page)).toHaveCount(0);
  });

  test('skipping the game earns nothing, skipping the whisper after a win still earns it', async ({ page }) => {
    await arm(page, { session: SESSION });
    await page.locator('h1').first().click();
    await page.clock.runFor(1600);
    await page.keyboard.press('x');
    await page.clock.runFor(1000);
    await expect(game(page)).toHaveCount(0);
    expect(await claims(page)).toEqual([]);

    // A replay, won, then x during the whisper. Not a first try any more.
    await page.locator('#dock-btn-settings').click();
    await page.locator('[data-halloween-replay]').click();
    await page.clock.runFor(1600);
    for (let i = 0; i < 4; i++) await fist(page, 300);
    await page.clock.runFor(700);
    await expect(page.locator('.hw-won')).toHaveCount(1);
    await page.keyboard.press('x');
    await page.clock.runFor(1000);
    await expect.poll(() => claims(page)).toEqual([PLAIN]);
  });
});

// --- EARNED SIGNED OUT, KEPT ON SIGNING IN ---

test.describe('a badge waiting on the device', () => {
  async function load(page, { session = SESSION, waiting = [GOLD], claimError = null } = {}) {
    await mockSupabase(page, { session, claimError });
    await page.addInitScript((waiting) => {
      if (sessionStorage.getItem('armed')) return;
      sessionStorage.setItem('armed', '1');
      localStorage.setItem('dsl_badges_pending', JSON.stringify(waiting));
    }, waiting);
    await page.goto('/404.html', { waitUntil: 'domcontentloaded' });
  }
  const pending = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('dsl_badges_pending') || '[]'));

  test('is kept the moment they are signed in, and says so', async ({ page }) => {
    await load(page);
    await expect(page.locator('.badge-toast')).toContainText('On your profile now.');
    expect(await page.evaluate(() => window.__claims)).toEqual([GOLD]);
    expect(await pending(page)).toEqual([]);
  });

  test('keeps waiting while they are signed out', async ({ page }) => {
    await load(page, { session: null });
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => window.__claims)).toEqual([]);
    expect(await pending(page)).toEqual([GOLD]);
  });

  test('stops waiting once the database refuses it, and keeps waiting when it could not ask', async ({ page }) => {
    await load(page, { claimError: { code: '22023', message: 'The Halloween 2026 badges can no longer be claimed.' } });
    await expect.poll(() => page.evaluate(() => window.__claims.length)).toBe(1);
    await expect.poll(() => pending(page)).toEqual([]);
    await expect(page.locator('.badge-toast')).toHaveCount(0);

    const offline = await page.context().newPage();
    await load(offline, { claimError: { code: '', message: 'TypeError: Failed to fetch' } });
    // Tried (twice, as the page asks after its account twice), and still waiting.
    await expect.poll(() => offline.evaluate(() => window.__claims.length)).toBeGreaterThanOrEqual(1);
    await offline.waitForLoadState('networkidle');
    expect(await pending(offline)).toEqual([GOLD]);
    await expect(offline.locator('.badge-toast')).toHaveCount(0);
  });
});
