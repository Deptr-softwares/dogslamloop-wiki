// The owner's pixel icons for the site's buttons and badges (v1.2).
//
// Owner, 2026-10-24: "most of the SVG arts used on the site are AI-generated
// media, which completely goes against what the Writing Guide, README, and
// Terms of Service say. So I plan to replace them with my own pixel art." They
// drew 21 (2026-11-19) into medias/icons/, named as the site uses them. In
// text they are [icon=ui/<name>] (tests/text-icons.spec.js).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ICON_FILES = fs.readdirSync(path.join(ROOT, 'medias', 'icons')).filter(f => f.endsWith('.png')).map(f => f.slice(0, -4));

// What an icon shows: which of the owner's files, how big, and the color it is
// painted in, beside the color of the button or link holding it.
const look = (icon) => icon.evaluate((el) => {
  const s = getComputedStyle(el);
  const box = el.getBoundingClientRect();
  return {
    file: (s.getPropertyValue('--px-icon').match(/medias\/icons\/([a-z0-9-]+)\.png/) || [])[1] || null,
    size: `${Math.round(box.width)}x${Math.round(box.height)}`,
    drawn: s.backgroundColor,
    holder: getComputedStyle(el.parentElement.closest('button, a') || el.parentElement).color,
  };
});

// Each icon in place: its file, 16px, and in its holder's color.
async function expectIcons(page, cases) {
  for (const [holder, file] of cases) {
    const icon = page.locator(holder).locator('.px-icon');
    await expect(icon, holder).toHaveCount(1);
    const seen = await look(icon);
    expect(seen, holder).toMatchObject({ file, size: '16x16' });
    expect(seen.drawn, `${holder} is painted in its button's color`).toBe(seen.holder);
  }
}

// Signed in with a role and an inbox, the way tests/profile-modal.spec.js is.
async function signIn(page, { role = null, notifications = [] } = {}) {
  await page.addInitScript(({ role, notifications }) => {
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
          client.auth.getSession = async () => ({
            data: { session: { access_token: 't', user: { id: 'u1', email: 'someone@site.test', user_metadata: { display_name: 'Tester' }, app_metadata: { provider: 'email' }, identities: [{ provider: 'email' }] } } },
          });
          const origFrom = client.from.bind(client);
          client.from = (table) => {
            const rows = table === 'user_roles' ? (role ? [{ role }] : [])
              : table === 'user_notifications' ? notifications
              : null;
            if (rows === null) return origFrom(table);
            const chain = {
              select() { return chain; }, eq() { return chain; }, order() { return chain; }, limit() { return chain; },
              update() { return chain; }, delete() { return chain; }, in() { return chain; },
              single: () => Promise.resolve({ data: rows[0] || null, error: rows[0] ? null : { code: 'PGRST116' } }),
              maybeSingle: () => Promise.resolve({ data: rows[0] || null, error: null }),
              then(r) { return Promise.resolve({ data: rows, count: rows.filter(n => !n.is_read).length, error: null }).then(r); },
            };
            return chain;
          };
          client.rpc = async () => ({ data: null, error: null });
          return client;
        };
      },
    });
  }, { role, notifications });
}

test('every site icon has its file, and every file in the folder is one of them', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  const icons = await page.evaluate(() => window.UI_ICONS.map(i => ({ ...i })));
  const ids = icons.map(i => i.id);
  expect(new Set(ids).size, 'no id twice').toBe(ids.length);
  expect([...ids].sort()).toEqual([...ICON_FILES].sort());
  for (const icon of icons) expect(icon.name, `${icon.id} has a name for screen readers`).toMatch(/\w/);
});

test("the site draws no SVG of its own any more, only the sign-in buttons' brand marks, and names no missing icon", () => {
  const files = [path.join(ROOT, 'scripts', 'generate-pages.js')];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'vendor') walk(p); } else if (e.name.endsWith('.js')) files.push(p);
    }
  };
  walk(path.join(ROOT, 'js'));
  for (const f of fs.readdirSync(ROOT)) if (f.endsWith('.html')) files.push(path.join(ROOT, f));
  for (const f of fs.readdirSync(path.join(ROOT, 'style'))) if (f.endsWith('.css')) files.push(path.join(ROOT, 'style', f));

  // Discord's, GitHub's and Google's marks on the sign-in buttons are theirs,
  // and stay as they are.
  const BRANDS = ['M107.7,8.07', 'M12 0c-6.626', 'M12.48 10.92'];
  const drawings = [];
  const missing = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    for (const m of src.matchAll(/<svg[\s\S]*?<\/svg>|data:image\/svg/g)) {
      if (!BRANDS.some(b => m[0].includes(b))) drawings.push(`${rel}: ${m[0].slice(0, 70)}`);
    }
    for (const m of src.matchAll(/medias\/icons\/([a-z0-9_/-]+\.png)/g)) {
      if (!fs.existsSync(path.join(ROOT, 'medias', 'icons', m[1]))) missing.push(`${rel}: ${m[1]}`);
    }
  }
  expect(drawings, 'an SVG drawing is left').toEqual([]);
  expect(missing, 'an icon file named that does not exist').toEqual([]);
});

test('signed out, the dock and Ko-fi wear the owner icons, in their button color, and black on hover', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await expectIcons(page, [
    ['#dock-btn-auth', 'role--guest'],
    ['#dock-btn-settings', 'dock-site-settings'],
    ['a.kofi-btn-full', 'kofi'],
  ]);
  // A button turns its text black on hover, and the icon with it.
  const settings = page.locator('#dock-btn-settings');
  await settings.hover();
  await expect.poll(async () => (await look(settings.locator('.px-icon'))).drawn).toBe('rgb(0, 0, 0)');
});

test("signed in, the dock wears the owner icons, and so does a notification's delete button", async ({ page }) => {
  await signIn(page, { role: 'reviewer', notifications: [{ id: 'n1', message: 'Your edit was approved.', is_read: false, created_at: '2026-11-19T10:00:00Z' }] });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#dock-btn-inbox')).toBeVisible({ timeout: 20000 });
  await expectIcons(page, [
    ['#dock-btn-edit', 'dock-overseer'],
    ['#dock-btn-inbox', 'dock-inbox'],
    ['#dock-btn-submissions', 'dock-submissions'],
    ['#dock-btn-auth', 'role-reviewer'],
  ]);
  await page.locator('#dock-btn-inbox').click();
  await expectIcons(page, [['[data-notif-delete="n1"]', 'delete']]);
});

test("each role has its own badge in the dock, and the profile shows it at twice the size", async ({ browser }) => {
  // viewer is a soft ban and wears the member's badge, as signed in with no role.
  const roles = [['owner', 'role-owner'], ['admin', 'role-admin'], ['reviewer', 'role-reviewer'],
    ['trusted_editor', 'role-trusted-editor'], [null, 'role--member'], ['viewer', 'role--member']];
  for (const [role, file] of roles) {
    const page = await browser.newPage();
    await signIn(page, { role });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await expect.poll(async () => (await look(page.locator('#dock-btn-auth .px-icon'))).file, `${role}'s badge`).toBe(file);
    if (role === 'owner') {
      await page.locator('#dock-btn-auth').click();
      const badge = page.locator('#profile-standing-icon .px-icon');
      await expect(badge).toBeVisible();
      const seen = await look(badge);
      expect(seen).toMatchObject({ file, size: '32x32' });
      // Each of the owner's pixels a whole 2x2 block: the mask is the badge's size.
      expect(await badge.evaluate(el => getComputedStyle(el).maskSize)).toBe('32px 32px');
    }
    await page.close();
  }
});

test("a character page's Edit, discussion and Ko-fi buttons, and a skill card's Edit Move", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  await expectIcons(page, [
    ['#btn-edit-current-tab', 'edit'],
    ['#btn-jump-discussion', 'discussion'],
    ['a.kofi-btn-full', 'kofi'],
  ]);
  if (await page.locator('#btn-history-current-tab').count()) await expectIcons(page, [['#btn-history-current-tab', 'history']]);

  await page.evaluate(async () => {
    window.cachedMasterFrameData = window.cachedMasterFrameData || {};
    window.cachedMasterFrameData.boomcat = { specials: [{ id: 'swipe', name: 'Swipe', input: 'M1', type: 'Attack', stats: [] }] };
    await window.loadMoveSection('boomcat', 'specials');
  });
  await page.locator('#nav-specials').click();
  await expectIcons(page, [['#tab-specials .skill-edit-move-btn >> nth=0', 'edit']]);
});

test("the mobile bar's Search, Ko-fi, Settings and account buttons", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await expectIcons(page, [
    ['#mobile-bottom-bar [data-bottom="search"]', 'search'],
    ['#mobile-bottom-bar [data-bottom="kofi"]', 'kofi'],
    ['#mobile-bottom-bar [data-bottom="settings"]', 'dock-site-settings'],
    ['#mobile-bottom-bar [data-bottom="account"]', 'role--guest'],
  ]);
});

test("the editor's align buttons, a ticked box and a dropdown's arrow", async ({ page }) => {
  await page.goto('/edit.html?char=testchar&tab=overview', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.initStrategyBlockBuilder === 'function', { timeout: 15000 });
  await page.evaluate(() => {
    document.body.innerHTML = '<div id="block-host"></div>'
      + '<input type="checkbox" id="ticked" checked><select class="editor-select" id="dropdown"><option>One</option></select>';
    window.initStrategyBlockBuilder('block-host', [{ type: 'paragraph', content: 'Hi.' }]);
    (window.getActiveBlocks() || []).forEach(b => window.setEditorBlockExpanded(b, true));
    window.renderBlockList();
  });
  await expectIcons(page, ['left', 'center', 'right'].map(side => [`#block-list .align-btn[data-val="${side}"] >> nth=0`, `align-${side}`]));

  // Drawn by the stylesheet, so their own 8px, white as drawn.
  const background = (sel) => page.locator(sel).evaluate(el => {
    const s = getComputedStyle(el);
    return { image: s.backgroundImage, size: s.backgroundSize, rendering: s.imageRendering };
  });
  const tick = await background('#ticked');
  expect(tick.image).toContain('/medias/icons/check.png');
  expect(tick).toMatchObject({ size: '8px 8px', rendering: 'pixelated' });
  const arrow = await background('#dropdown');
  expect(arrow.image).toContain('/medias/icons/dropdown.png');
  expect(arrow).toMatchObject({ size: '8px 8px', rendering: 'pixelated' });
});
