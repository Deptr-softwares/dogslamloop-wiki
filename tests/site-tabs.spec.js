// The site's tab strip for what sits inside a page (.sub-tabs, style/Buttons.css):
// one look, the folder tabs a Section Box had (the owner's pick, "Folder tabs").
// The editor's sub-tabs were filled blue, the Overseer's queues and the owner tools'
// groups were bordered boxes, the QA box and the Combo Card sections were system
// buttons, and the Sign In box had its own. The page tabs and the mode chips keep
// their own looks and are not checked here.
const { test, expect } = require('@playwright/test');

// A signed-in owner, so the owner tools and the Overseer let the page stay.
async function asOwner(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('dsl_notice_seen_editor', '1'); } catch (e) { /* ignore */ }
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          const orig = lib.createClient.bind(lib);
          lib.createClient = (...args) => {
            const client = orig(...args);
            client.auth.getSession = async () => ({
              data: { session: { user: { id: 'u-owner', email: 'o@site.test' }, access_token: 't' } },
            });
            const origFrom = client.from.bind(client);
            client.from = (table) => {
              if (table === 'user_roles') {
                return { select() { return this; }, eq: async () => ({ data: [{ role: 'owner' }], error: null }) };
              }
              return origFrom(table);
            };
            return client;
          };
          lib.__patched = true;
        }
      },
    });
  });
}

// The look of a strip, its picked tab and one other, and the colours they should be.
function lookOf(strip) {
  return strip.evaluate((el) => {
    const resolve = (value) => {
      const probe = document.createElement('span');
      probe.style.color = value;
      el.appendChild(probe);
      const out = getComputedStyle(probe).color;
      probe.remove();
      return out;
    };
    const tabs = [...el.querySelectorAll('.sub-tab')].filter(t => t.closest('.sub-tabs') === el && t.offsetParent);
    const picked = tabs.find(t => t.classList.contains('is-active'));
    const other = tabs.find(t => t !== picked);
    const s = getComputedStyle(el);
    const look = (t) => {
      const c = getComputedStyle(t);
      return { color: c.color, edge: c.borderTopColor, edgeWidth: c.borderTopWidth, under: c.borderBottomStyle,
        background: c.backgroundColor, font: c.fontFamily, transform: c.textTransform };
    };
    return {
      picked: picked && look(picked), other: other && look(other),
      line: `${s.borderBottomWidth} ${s.borderBottomStyle} ${s.borderBottomColor}`,
      want: {
        accent: resolve('var(--sub-tab-accent)'), muted: resolve('var(--text-muted)'),
        edge: resolve('var(--border-color)'),
        line: `2px solid ${resolve('var(--border-color)')}`, groundColour: resolve('var(--bg-main)'),
      },
    };
  });
}

function expectFolderTabs(look, name) {
  expect(look.picked, `${name}: a picked tab`).toBeTruthy();
  expect(look.other, `${name}: another tab`).toBeTruthy();
  expect(look.line, `${name}: the strip's line`).toBe(look.want.line);
  expect(look.picked.color, `${name}: the picked tab in the accent`).toBe(look.want.accent);
  expect(look.picked.edge, `${name}: and edged in it`).toBe(look.want.accent);
  expect(look.picked.under, `${name}: open to its panel`).toBe('none');
  expect(look.picked.background, `${name}: on the page's ground`).toBe(look.want.groundColour);
  expect(look.other.color, `${name}: an unpicked tab in the muted grey`).toBe(look.want.muted);
  expect(look.other.edge, `${name}: edged in grey`).toBe(look.want.edge);
  expect(look.other.edgeWidth).toBe('1px');
  expect(look.other.under).toBe('none');
  expect(look.other.transform).toBe('uppercase');
  expect(look.other.font, `${name}: in the mono face`).toMatch(/mono|Consolas|Menlo/i);
}

test('the Sign In box\'s LOGIN and REGISTER are the site\'s tab strip, and a click moves the look', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/search.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.openAuthModal === 'function' && window.supabaseClient);
  await page.evaluate(() => window.openAuthModal());
  const strip = page.locator('#auth-modal-overlay .sub-tabs');
  await expect(strip).toBeVisible();
  expectFolderTabs(await lookOf(strip), 'Sign In');

  await page.locator('#auth-tab-register').click();
  await expect(page.locator('#auth-view-register')).toBeVisible();
  const after = await lookOf(strip);
  expect(await page.locator('#auth-tab-register').evaluate(el => getComputedStyle(el).color)).toBe(after.want.accent);
  expect(await page.locator('#auth-tab-login').evaluate(el => getComputedStyle(el).color)).toBe(after.want.muted);
  expect(errors).toEqual([]);
});

test('the owner tools\' groups are the site\'s tab strip, at the touch-target floor, Danger Zone in red', async ({ page }) => {
  await asOwner(page);
  await page.goto('/owner.html', { waitUntil: 'domcontentloaded' });
  const strip = page.locator('#owner-nav');
  await expect(strip).toBeVisible();
  expectFolderTabs(await lookOf(strip), 'owner groups');
  expect((await page.locator('.owner-nav-btn').first().boundingBox()).height).toBeGreaterThanOrEqual(44);

  const danger = page.locator('.owner-nav-btn[data-group="danger"]');
  await danger.click();
  await expect(page.locator('.owner-group[data-group="danger"]')).toBeVisible();
  expect(await danger.evaluate(el => getComputedStyle(el).borderTopColor)).toBe('rgb(239, 68, 68)');
});

test('the Overseer\'s queues are the site\'s tab strip, and a click moves the look', async ({ page }) => {
  await asOwner(page);
  await page.goto('/overseer.html', { waitUntil: 'domcontentloaded' });
  const strip = page.locator('#admin-queue-tabs');
  await expect(strip).toBeVisible({ timeout: 30000 });
  expectFolderTabs(await lookOf(strip), 'Overseer queues');

  const reports = page.locator('[data-queue-tab="reports"]');
  await reports.click();
  const after = await lookOf(strip);
  expect(await reports.evaluate(el => getComputedStyle(el).color)).toBe(after.want.accent);
  expect(await page.locator('[data-queue-tab="revisions"]').evaluate(el => getComputedStyle(el).color)).toBe(after.want.muted);
});

test('the editor\'s sub-tabs are the site\'s tab strip, and a click moves the look', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await asOwner(page);
  await page.goto('/edit.html?playground', { waitUntil: 'domcontentloaded' });
  const strip = page.locator('#interactive-builder .sub-tabs.editor-nav-row').first();
  await expect(strip).toBeVisible({ timeout: 45000 });
  expectFolderTabs(await lookOf(strip), 'the editor\'s Overview sections');
  // The editor's rows scroll sideways rather than wrap.
  expect(await strip.evaluate(el => getComputedStyle(el).overflowX)).toBe('auto');

  await page.locator('#overview-nav-playstyle').click();
  const after = await lookOf(strip);
  expect(await page.locator('#overview-nav-playstyle').evaluate(el => getComputedStyle(el).color)).toBe(after.want.accent);
  expect(await page.locator('#overview-nav-overview').evaluate(el => getComputedStyle(el).color)).toBe(after.want.muted);
  expect(errors).toEqual([]);
});

test('the QA box\'s Short, Long and Technical are the site\'s tab strip, and a click moves the look', async ({ page }) => {
  await asOwner(page);
  await page.goto('/edit.html?playground', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.openQAModal === 'function', null, { timeout: 45000 });
  await page.evaluate(() => { window.openQAModal(false); });
  const strip = page.locator('#dynamic-qa-modal-overlay .qa-tabs-row');
  await expect(strip).toBeVisible();
  expectFolderTabs(await lookOf(strip), 'QA form');

  await page.locator('#qa-tab-technical').click();
  await expect(page.locator('#qa-tab-technical')).toHaveClass(/\bis-active\b/);
  // The whole look again: a system button in the same blue would pass on colour.
  expectFolderTabs(await lookOf(page.locator('#dynamic-qa-modal-overlay .qa-tabs-row')), 'QA form, Technical picked');
});

test('a Section Box on a reader page draws the site\'s tab strip, and a click moves the look', async ({ page }) => {
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.generateHTMLForBlocks === 'function', null, { timeout: 45000 });
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'render-host';
    host.innerHTML = window.generateHTMLForBlocks([{ type: 'sectionedbox', title: 'Neutral', sections: [
      { title: 'Poking', content: [] }, { title: 'Whiff Punish', content: [] }] }], '');
    document.querySelector('main').prepend(host);
  });
  const strip = page.locator('#render-host .sbox-tabs');
  expectFolderTabs(await lookOf(strip), 'Section Box');
  await page.locator('#render-host .sbox-tab', { hasText: 'Whiff Punish' }).click();
  expectFolderTabs(await lookOf(strip), 'Section Box, second tab picked');
  await expect(page.locator('#render-host .sbox-tab.is-active')).toHaveText('Whiff Punish');
});

// A signed-in contributor on a page answered from a fixture: two skills.
function mockTwoMoves(page) {
  return page.addInitScript(() => {
    try { localStorage.setItem('dsl_notice_seen_editor', '1'); localStorage.setItem('dsl_editor_tutorial_seen', '1'); } catch (e) { /* ignore */ }
    const desc = { overview: [], strategy: [], extras: [], profile: { stats: [], image: '' }, matchups: [], counterplay: [], comboGroups: [], moveStrategies: {} };
    const frame = { m1s: [], specials: [], skills: [{ id: 'skill_1', name: 'Skill One' }, { id: 'skill_2', name: 'Skill Two' }] };
    const rowsFor = (table) => {
      if (table === 'page_data') return { data: { page_id: 'boomcat', desc_data: desc, frame_data: frame }, error: null };
      if (['user_roles', 'site_settings', 'page_permissions', 'pending_revisions'].includes(table)) return { data: null, error: null };
      return { data: [], error: null };
    };
    const builder = (table) => {
      const result = rowsFor(table);
      const chain = {
        select() { return chain; }, eq() { return chain; }, in() { return chain; }, neq() { return chain; },
        order() { return chain; }, limit() { return chain; },
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
  });
}

test('picking another move gives its tab the look, and the editor opens that move', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await mockTwoMoves(page);
  await page.goto('/edit.html?char=boomcat&type=character&tab=skills', { waitUntil: 'domcontentloaded' });
  const strip = page.locator('#interactive-builder .sub-tabs.editor-nav-row').first();
  await expect(page.locator('#move-nav-skill_1')).toBeVisible({ timeout: 45000 });
  expectFolderTabs(await lookOf(strip), 'moves');

  await page.locator('#move-nav-skill_2').click();
  await expect(page.locator('#move-nav-skill_2')).toHaveClass(/\bis-active\b/);
  await expect(page.locator('#move-nav-skill_1')).not.toHaveClass(/\bis-active\b/);
  expectFolderTabs(await lookOf(strip), 'moves, the second picked');
  expect(errors).toEqual([]);
});

// The strips no page above draws without content (a Section Box, the Combo Card's
// sections in both editors, the tier editor's documents): each keeps its own hook
// class, and that class never goes out without the strip's.
test('every strip\'s own class travels with the site\'s tab strip classes', () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..');
  const files = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach(d => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) { if (!['vendor', 'node_modules'].includes(d.name)) walk(p); } else if (/\.(js|html)$/.test(d.name)) files.push(p);
  });
  walk(path.join(root, 'js'));
  ['edit.html', 'overseer.html', 'owner.html', 'tier-editor.html'].forEach(f => files.push(path.join(root, f)));

  const HOOKS = { tab: ['sbox-tab', 'cardsec-tab', 'qa-tab-btn', 'tier-doc-btn', 'owner-nav-btn', 'admin-queue-tab'],
    strip: ['sbox-tabs', 'cardsec-tabs', 'qa-tabs-row', 'tier-doc-switch', 'owner-nav', 'admin-queue-tabs'] };
  const loose = [];
  let seen = 0;
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/class="([^"]*)"/g)) {
      const classes = m[1].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/);
      for (const [kind, want] of [['tab', 'sub-tab'], ['strip', 'sub-tabs']]) {
        const hook = HOOKS[kind].find(h => classes.includes(h));
        if (!hook) continue;
        seen++;
        if (!classes.includes(want)) loose.push(`${path.relative(root, file)}: .${hook} without .${want}`);
      }
    }
  }
  expect(seen, 'found the strips').toBeGreaterThanOrEqual(12);
  expect(loose).toEqual([]);
});
