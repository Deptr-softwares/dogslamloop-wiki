// The Halloween event (owner's list for the Halloween update, 2026-10-23; no
// version). Once a reader has been through the Black Flash minigame the site
// turns "Pumpkin Night" for them: orange where the blue accent was, links
// still blue, cobwebs in the screen's corners. Character pages keep their own
// colours (owner: "Character page colors don't get affected"). All of it ends
// by itself on November 1 (owner).
//
// EVERY DATE HERE IS THE TEST'S OWN, on a fixed clock in a fixed time zone, so
// nothing in this file turns red when November comes. A red test stops the
// nightly regeneration.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
test.use({ timezoneId: 'UTC' });
const DURING = new Date('2026-10-25T12:00:00Z');
const AFTER = new Date('2026-11-01T00:00:01Z');

async function visit(page, url, { played = false, at = DURING, blocked = false } = {}) {
  await page.clock.setFixedTime(at);
  await page.addInitScript(({ played, blocked }) => {
    if (blocked) {
      Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
      return;
    }
    try { if (played) localStorage.setItem('dsl_halloween_done', '1'); } catch (e) { /* ignore */ }
  }, { played, blocked });
  await page.goto(url, { waitUntil: 'networkidle' });
}

// The page's colours as the browser resolves them, and the cobwebs.
const look = (page) => page.evaluate(() => {
  const resolve = (value) => {
    const s = document.createElement('span');
    s.style.color = value;
    document.body.appendChild(s);
    const c = getComputedStyle(s).color;
    s.remove();
    return c;
  };
  const link = document.createElement('a');
  link.className = 'wiki-link';
  link.href = '#';
  document.body.appendChild(link);
  const linkColor = getComputedStyle(link).color;
  link.remove();
  return {
    on: document.documentElement.classList.contains('halloween'),
    accent: resolve('var(--accent-blue)'),
    border: resolve('var(--border-color)'),
    muted: resolve('var(--text-muted)'),
    link: linkColor,
    webs: document.querySelectorAll('.hw-webs .hw-web').length,
    spider: document.querySelectorAll('.hw-webs .hw-spider').length,
  };
});

test('a reader who has played gets Pumpkin Night: orange accent, warm borders, links still blue, cobwebs', async ({ browser }) => {
  const usual = await browser.newPage();
  await visit(usual, '/');
  const before = await look(usual);

  const page = await browser.newPage();
  await visit(page, '/', { played: true });
  const after = await look(page);

  expect(before).toMatchObject({ on: false, webs: 0, spider: 0 });
  expect(after.on).toBe(true);
  expect(after.accent, 'the accent changes').not.toBe(before.accent);
  expect(after.border, 'the borders change').not.toBe(before.border);
  // Orange: more red than blue, where the usual accent is the reverse.
  const [r, , b] = after.accent.match(/\d+/g).map(Number);
  expect(r).toBeGreaterThan(b);
  expect(after.link, 'links keep the usual blue').toBe(before.accent);
  expect(after).toMatchObject({ webs: 2, spider: 1 });
});

test('the cobwebs never take a click', async ({ page }) => {
  await visit(page, '/', { played: true });
  const hits = await page.evaluate(() => [...document.querySelectorAll('.hw-web, .hw-spider')].map(w => {
    const r = w.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!(hit && hit.closest('.hw-webs'));
  }));
  expect(hits).toEqual([false, false, false]);
});

// Owner, 2026-10-23: "next to the sidebars (stay in the middle main area),
// instead of being inside the sidebars", and the spider still.
test('the cobwebs and the spider sit in the middle area, against the sidebars, and follow a collapsed one', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 800 });
  await visit(page, '/', { played: true });
  const place = () => page.evaluate(() => {
    const box = (el) => el.getBoundingClientRect();
    const left = box(document.querySelector('.global-sidebar-left'));
    const right = box(document.querySelector('.local-sidebar-right'));
    const bits = [...document.querySelectorAll('.hw-web, .hw-spider')].map(box);
    return {
      leftEdge: Math.round(left.right),
      rightEdge: Math.round(right.left),
      inside: bits.every(b => b.left >= left.right - 1 && b.right <= right.left + 1),
      bottomWebLeft: Math.round(box(document.querySelector('.hw-web-bottom')).left),
      topWebRight: Math.round(box(document.querySelector('.hw-web-top')).right),
      spiderMoves: getComputedStyle(document.querySelector('.hw-spider')).animationName,
    };
  });

  const open = await place();
  expect(open.inside, 'in the middle area, not over a sidebar').toBe(true);
  expect(open.bottomWebLeft).toBe(open.leftEdge);
  expect(open.topWebRight).toBe(open.rightEdge);
  expect(open.spiderMoves).toBe('none');

  await page.locator('.global-sidebar-left .sidebar-toggle-btn').click();
  await expect.poll(async () => (await place()).leftEdge).toBeLessThan(open.leftEdge);
  const collapsed = await place();
  expect(collapsed.bottomWebLeft, 'the web follows the narrower sidebar').toBe(collapsed.leftEdge);
});

// Owner, 2026-10-23: the bottom web "weirdly clip over the footer ... it would
// be better if cobweb is hidden under the footer".
test('at the end of a page the footer covers the bottom web', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 800 });
  await visit(page, '/', { played: true });
  await page.locator('#site-footer').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const onTop = await page.evaluate(() => {
    // The webs never take a click, so to ask which is painted on top they are
    // made hittable here for a moment.
    const webs = document.querySelector('.hw-webs');
    webs.style.pointerEvents = 'auto';
    webs.querySelectorAll('*').forEach(el => { el.style.pointerEvents = 'auto'; });
    const web = document.querySelector('.hw-web-bottom').getBoundingClientRect();
    const foot = document.getElementById('site-footer').getBoundingClientRect();
    const top = Math.max(web.top, foot.top);
    const bottom = Math.min(web.bottom, foot.bottom);
    if (bottom <= top) return 'no overlap';
    // Anywhere in the overlap: a hittable .hw-web box is hit across all of it,
    // not only on its strands.
    const hit = document.elementFromPoint(web.left + web.width / 2, (top + bottom) / 2);
    return hit && hit.closest('#site-footer') ? 'footer' : (hit && hit.closest('.hw-webs') ? 'web' : String(hit && hit.tagName));
  });
  expect(onTop).toBe('footer');
});

test('a character page keeps its own colours, cobwebs and all', async ({ browser }) => {
  const usual = await browser.newPage();
  await visit(usual, '/characters/Boomcat/');
  await usual.waitForFunction(() => document.documentElement.style.getPropertyValue('--accent-blue'));
  const before = await look(usual);

  const page = await browser.newPage();
  await visit(page, '/characters/Boomcat/', { played: true });
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--accent-blue'));
  const after = await look(page);

  expect(after.on).toBe(true);
  expect({ accent: after.accent, border: after.border, muted: after.muted })
    .toEqual({ accent: before.accent, border: before.border, muted: before.muted });
  expect(after.webs).toBe(2);
});

test('from November 1 nothing is left of it, even for a reader who played', async ({ page }) => {
  await visit(page, '/', { played: true, at: AFTER });
  expect(await look(page)).toMatchObject({ on: false, webs: 0, spider: 0 });
  expect(await page.evaluate(() => typeof window.halloween)).toBe('undefined');
});

test('a browser that blocks storage gets the look, since the game could never be remembered', async ({ page }) => {
  await visit(page, '/', { blocked: true });
  expect(await look(page)).toMatchObject({ on: true, webs: 2 });
});

test('every reader page loads the Halloween script and style in its head; the editor, admin and owner pages do not', () => {
  // Derived from the files, so a new page cannot be missed. In <head> so a
  // reader who has played gets the look on the first paint, not after it.
  const SKIP = new Set(['node_modules', '.git', 'test-results', 'playwright-report', '.claude']);
  const WORKSPACES = new Set(['admin.html', 'edit.html', 'owner.html', 'post-editor.html', 'tier-editor.html']);
  const pages = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.html')) pages.push(full);
    }
  };
  walk(ROOT);

  const missing = [];
  const unwanted = [];
  for (const file of pages) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const src = fs.readFileSync(file, 'utf8');
    const head = src.split('</head>')[0];
    const has = /<script src="[^"]*js\/halloween\.js(\?v=[0-9a-f]+)?"><\/script>/.test(head)
      && /<link rel="stylesheet" href="[^"]*style\/halloween\.css">/.test(head);
    const generated = src.includes('GENERATED by scripts/generate-pages.js');
    // An archived page's notice is not a page anyone reads the wiki on.
    const archived = generated && src.includes('<h1 class="home-main-title">Page archived</h1>');
    const reader = generated ? !archived : src.includes('class="local-sidebar-right"');
    if (WORKSPACES.has(rel)) { if (src.includes('halloween.js')) unwanted.push(rel); }
    else if (reader && !has) missing.push(rel);
  }
  expect(missing, 'reader pages without it in <head>').toEqual([]);
  expect(unwanted, 'workspaces stay as they are').toEqual([]);
});
