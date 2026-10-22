// Small touches to parts every page shares (v1.1, owner's picks 2026-10-20,
// from a page of mockups): selected text and the scrollbar in the page
// colour, slanted bars on loading messages, a slanted wipe on the heading a
// jump lands on, a bar on panel headings that stretches to the end of the
// words, a punch on a clicked tab, and halftone dots behind a character's
// name that fade out by the middle of it.
//
// Read back from what the browser draws (pixels, computed styles), not from
// class names.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// The colours drawn in a box of the page, as rows of [r, g, b]. A screenshot
// is an 8-bit RGB or RGBA PNG; each row starts with a filter byte (None, Sub,
// Up, Average, Paeth) that is undone against the row above and the pixel to
// the left.
async function region(page, clip) {
  const png = await page.screenshot({ clip });
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  const bpp = png[25] === 6 ? 4 : 3;
  const chunks = [];
  for (let at = 8; at < png.length;) {
    const len = png.readUInt32BE(at);
    if (png.toString('ascii', at + 4, at + 8) === 'IDAT') chunks.push(png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const stride = width * bpp;
  const rows = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const add = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1
        : filter === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      line[i] = (line[i] + add) & 255;
    }
    const row = [];
    for (let x = 0; x < width; x++) row.push([...line.subarray(x * bpp, x * bpp + 3)]);
    rows.push(row);
    prev = line;
  }
  return rows;
}

const pixel = async (page, x, y) => (await region(page, { x, y, width: 1, height: 1 }))[0][0];

// A CSS colour (or custom property) as the browser resolves it on this page.
const rgbOf = (page, css) => page.evaluate(c => {
  const d = document.createElement('div');
  d.style.color = c.startsWith('--') ? `var(${c})` : c;
  document.body.appendChild(d);
  const v = getComputedStyle(d).color;
  d.remove();
  return v.match(/\d+/g).slice(0, 3).map(Number);
}, css);

const near = (a, b, tolerance = 4) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);

// --------------------------------------------------------------------------
// Selected text
// --------------------------------------------------------------------------

test('selected text takes the page colour, with white ink on a dark page', async ({ page }) => {
  // Ten Shadows is a dark character colour, so its ink is white.
  await page.goto('/characters/Ten_shadows/index.html', { waitUntil: 'networkidle' });
  const title = page.locator('.character-title');
  await expect(title).toBeVisible();
  const box = await title.evaluate(el => {
    const r = document.createRange();
    r.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    return r.getBoundingClientRect().toJSON();
  });
  const accent = await rgbOf(page, '--accent-blue');
  // The top edge of the selected line, above the letters.
  expect(near(await pixel(page, Math.round(box.left + 3), Math.round(box.top + 1)), accent)).toBe(true);
  const ink = await title.evaluate(el => getComputedStyle(el, '::selection').color);
  expect(ink).toBe('rgb(255, 255, 255)');
});

// --------------------------------------------------------------------------
// Loading messages
// --------------------------------------------------------------------------

test('a loading message has the slanted bars and an error message does not', async ({ page }) => {
  // Nothing from the database ever answers, so the page stays loading.
  await page.route('**/rest/v1/**', () => {});
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/systems/hud/index.html');
  const loading = page.locator('#dynamic-toc .loading-msg-busy');
  await expect(loading).toBeVisible();

  const bars = await loading.evaluate(el => {
    const cs = getComputedStyle(el, '::before');
    return { content: cs.content, width: cs.width };
  });
  expect(bars.content).toBe('""');
  expect(bars.width).toBe('20px');

  // Held still with less motion: the first bar lit, the second not.
  const box = await loading.boundingBox();
  const accent = await rgbOf(page, '--accent-blue');
  const border = await rgbOf(page, '--border-color');
  const midY = Math.round(box.y + box.height / 2);
  expect(near(await pixel(page, Math.round(box.x + 2), midY), accent, 12)).toBe(true);
  expect(near(await pixel(page, Math.round(box.x + 10), midY), border, 12)).toBe(true);

  const plain = await page.evaluate(() => {
    const p = document.createElement('p');
    p.className = 'loading-msg';
    p.textContent = 'Failed to load: nope';
    document.body.appendChild(p);
    return getComputedStyle(p, '::before').content;
  });
  expect(plain).toBe('none');
});

// --------------------------------------------------------------------------
// Halftone behind a character's name
// --------------------------------------------------------------------------

test('halftone dots sit behind a character\'s name and are gone by its middle', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  // Not networkidle: at this width the page kept the network busy past 30s.
  await page.goto('/characters/Ten_shadows/index.html');
  const title = page.locator('.character-header .character-title');
  await expect(title).toBeVisible();
  // Nothing of the page's own above the name, whatever notices it carries.
  await page.evaluate(() => document.getElementById('character-alerts-container').replaceChildren());
  await page.waitForTimeout(600); // the dots slide in over 0.45s
  const box = await title.boundingBox();
  const bg = await rgbOf(page, '--bg-main');
  const tinted = rows => rows.flat().filter(p => p.some((v, i) => v - bg[i] > 8)).length;
  // A band just above the letters: the patch starts 0.45rem above the title.
  const y = Math.round(box.y - 6);
  expect(tinted(await region(page, { x: Math.round(box.x), y, width: 28, height: 5 }))).toBeGreaterThan(0);
  expect(tinted(await region(page, { x: Math.round(box.x + box.width / 2 + 15), y, width: 40, height: 5 }))).toBe(0);
});

test('the halftone patch ends at the middle of the name, however long the name is', async ({ page }) => {
  await page.goto('/characters/Ten_shadows/index.html', { waitUntil: 'networkidle' });
  const title = page.locator('.character-header .character-title');
  await expect(title).toBeVisible();
  const measure = () => title.evaluate(el => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const dots = getComputedStyle(el, '::before');
    return { width: el.getBoundingClientRect().width, words: r.getBoundingClientRect().width, end: parseFloat(dots.left) + parseFloat(dots.width) };
  });
  const short = await measure();
  expect(Math.abs(short.width - short.words)).toBeLessThan(2);
  expect(Math.abs(short.end - short.width / 2)).toBeLessThan(1);

  await title.evaluate(el => { el.textContent = 'A Much Longer Name Than That'; });
  const long = await measure();
  expect(long.width).toBeGreaterThan(short.width + 50);
  expect(Math.abs(long.end - long.width / 2)).toBeLessThan(1);
});

test('other pages titled with the same class get no dots', async ({ page }) => {
  await page.goto('/history.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#history-page-title')).toBeAttached();
  expect(await page.locator('#history-page-title').evaluate(el => getComputedStyle(el, '::before').content)).toBe('none');
});

// --------------------------------------------------------------------------
// Panel headings
// --------------------------------------------------------------------------

test('a panel heading\'s bar stretches to the end of its words when the panel is hovered', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  const title = page.locator('.wiki-section .section-title[data-heading-key="about"]');
  await expect(title).not.toHaveText(/^\s*$/);
  const box = await title.boundingBox();
  const words = await title.evaluate(el => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width; });
  expect(words).toBeGreaterThan(70);
  const accent = await rgbOf(page, '--accent-blue');
  // A pixel row wholly inside the 4px bar: the heading can end on a fraction.
  const lineY = Math.floor(box.y + box.height - 3);
  const start = [Math.round(box.x + 6), lineY];
  const end = [Math.round(box.x + words - 8), lineY];

  await page.mouse.move(5, 5);
  expect(near(await pixel(page, ...start), accent, 6)).toBe(true);
  expect(near(await pixel(page, ...end), accent, 6)).toBe(false);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 40);
  await expect.poll(async () => near(await pixel(page, ...end), accent, 6)).toBe(true);
  // To the end of the words, not across the whole line.
  expect(near(await pixel(page, Math.round(box.x + words + 30), lineY), accent, 6)).toBe(false);
});

test('a heading on a row\'s accent line gets no bar', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  const contents = await page.locator('.section-title-clean, .section-title-flex').evaluateAll(els =>
    els.map(el => getComputedStyle(el, '::after').content));
  expect(contents.length).toBeGreaterThan(0);
  contents.forEach(c => expect(c).toBe('none'));
});

// --------------------------------------------------------------------------
// Tabs
// --------------------------------------------------------------------------

// Every punch from the page's first moment, since one is over in 0.2s: which
// element, and how far it was scaled out as it started.
async function recordPunches(page) {
  await page.addInitScript(() => {
    window.__punches = [];
    document.addEventListener('animationstart', e => {
      if (e.animationName !== 'tab-punch') return;
      const punch = e.target.getAnimations().find(a => a.animationName === 'tab-punch');
      let scale = null;
      if (punch) {
        punch.pause();
        punch.currentTime = 0;
        const m = new DOMMatrix(getComputedStyle(e.target).transform);
        scale = Math.hypot(m.a, m.b);
        punch.finish();
      }
      window.__punches.push({ id: e.target.id, scale });
    }, true);
  });
}
const punches = page => page.evaluate(() => window.__punches);

test('a clicked tab punches out and settles; the tab a page opens on does not', async ({ page }) => {
  await recordPunches(page);
  await page.goto('/characters/Ten_shadows/index.html', { waitUntil: 'networkidle' });
  const tabs = page.locator('.character-nav .btn-manga-slanted:visible');
  await expect(tabs.nth(1)).toBeVisible();
  expect(await punches(page)).toEqual([]);

  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveClass(/\bactive\b/);
  await expect.poll(() => punches(page)).toHaveLength(1);
  const [punch] = await punches(page);
  expect(punch.id).toBe(await tabs.nth(1).getAttribute('id'));
  expect(punch.scale).toBeGreaterThan(1.05);
});

test('a filter punches when switched on and stays still when switched off', async ({ page }) => {
  await recordPunches(page);
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  const filter = page.locator('#filter-ea');
  await expect(filter).toBeVisible();
  await filter.click();
  await expect(filter).toHaveClass(/\bactive\b/);
  await expect.poll(() => punches(page)).toHaveLength(1);
  expect((await punches(page))[0].scale).toBeGreaterThan(1.05);

  await filter.click();
  await expect(filter).not.toHaveClass(/\bactive\b/);
  await page.waitForTimeout(150);
  expect(await punches(page)).toHaveLength(1);
});

// --------------------------------------------------------------------------
// Landing on a section
// --------------------------------------------------------------------------

// A contents link to a heading pushed far down the page, so the jump is a
// real smooth scroll whatever the page's own content happens to be.
async function farHeading(page) {
  await page.goto('/characters/Ten_shadows/index.html', { waitUntil: 'networkidle' });
  const link = page.locator('#dynamic-toc a.toc-link-major').last();
  await expect(link).toBeVisible();
  const id = (await link.getAttribute('href')).slice(1);
  await page.evaluate(id => {
    const spacer = document.createElement('div');
    spacer.style.height = '4000px';
    const target = document.getElementById(id);
    target.parentElement.insertBefore(spacer, target);
    window.scrollTo(0, 0);
  }, id);
  return { link, target: page.locator(`[id="${id}"]`), id };
}

test('the heading a jump lands on is wiped once the scroll has stopped', async ({ page }) => {
  const { link, target, id } = await farHeading(page);
  // Where the page was when the mark went on, and where it ended up.
  await page.evaluate(id => {
    window.__markedAt = null;
    const t = document.getElementById(id);
    new MutationObserver(() => {
      if (window.__markedAt === null && t.classList.contains('anchor-flash')) window.__markedAt = scrollY;
    }).observe(t, { attributes: true, attributeFilter: ['class'] });
  }, id);
  await link.click();
  await expect.poll(() => page.evaluate(() => window.__markedAt)).not.toBeNull();
  await page.waitForTimeout(400);
  const [markedAt, finalY] = await page.evaluate(() => [window.__markedAt, scrollY]);
  expect(finalY).toBeGreaterThan(2000);
  expect(Math.abs(markedAt - finalY)).toBeLessThan(2);
});

test('the wipe is a bar of the page colour across the heading\'s words only, and an outline with less motion', async ({ page }) => {
  // Caught as it starts and held there: under load the 0.7s wipe could be
  // over before the test looked.
  await page.addInitScript(() => {
    document.addEventListener('animationstart', e => {
      if (e.animationName !== 'anchor-wipe') return;
      window.__wipe = document.getAnimations().find(a => a.animationName === 'anchor-wipe');
      if (window.__wipe) window.__wipe.pause();
    }, true);
  });
  // A heading Block, which spans its panel with the words at the left: the
  // case where the wipe used to run the whole width (owner, 2026-10-20).
  const far = await farHeading(page);
  await far.target.evaluate(el => {
    const h = document.createElement('h3');
    h.className = 'wiki-block-heading';
    h.id = 'wipe-test-heading';
    h.textContent = 'Matchup Notes';
    el.parentElement.insertBefore(h, el);
  });
  const target = page.locator('#wipe-test-heading');
  const id = 'wipe-test-heading';
  await page.evaluate(id => window.jumpToAnchor(id, { behavior: 'auto' }), id);
  await expect.poll(() => page.evaluate(() => !!window.__wipe)).toBe(true);
  const holdAt = ms => page.evaluate(ms => { window.__wipe.currentTime = ms; }, ms);

  // Sampled along the heading's top edge, above the letters: a heading's own
  // text can be in the page colour.
  const box = await target.boundingBox();
  const words = await target.evaluate(el => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().toJSON(); });
  expect(box.width).toBeGreaterThan(words.width + 80);
  const y = Math.round(box.y + 1);
  const onWords = [Math.round(words.left + 3), y];
  const pastWords = [Math.round(words.right + 50), y];
  const accent = await rgbOf(page, '--accent-blue');

  await holdAt(0);
  expect(near(await pixel(page, ...onWords), accent, 6)).toBe(false);
  await holdAt(315);
  expect(near(await pixel(page, ...onWords), accent, 6)).toBe(true);
  expect(near(await pixel(page, ...pastWords), accent, 6)).toBe(false);
  await page.evaluate(() => window.__wipe.finish());

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(id => window.jumpToAnchor(id, { behavior: 'auto' }), id);
  await expect.poll(() => target.evaluate(el => el.classList.contains('anchor-flash') && getComputedStyle(el).outlineStyle)).toBe('solid');
  expect(await target.evaluate(el => getComputedStyle(el, '::before').content)).toBe('none');
});

// Every "Loading..." in the source carries the class, so a new one written
// without it fails here instead of quietly showing no bars.
test('every loading, fetching, searching or saving message has the bars', () => {
  const root = path.join(__dirname, '..');
  const files = [];
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(d => {
    if (['node_modules', '.git', 'test-results', 'supabase'].includes(d.name)) return;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p);
    else if (/\.(html|js)$/.test(d.name)) files.push(p);
  });
  walk(path.join(root, 'js'));
  fs.readdirSync(root).filter(f => f.endsWith('.html')).forEach(f => files.push(path.join(root, f)));
  ['characters', 'systems', 'others'].forEach(d => fs.existsSync(path.join(root, d)) && walk(path.join(root, d)));

  const missing = [];
  let found = 0;
  const busyWords = /^\s*(Loading|Fetching|Searching|Saving|Granting|Revoking)/;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/class="(loading-msg(?: [a-z-]+)*)"[^>]*>([^<]*)/g)) {
      if (!busyWords.test(m[2])) continue;
      found++;
      if (!m[1].split(' ').includes('loading-msg-busy')) missing.push(`${path.relative(root, f)}: ${m[2].trim()}`);
    }
  }
  expect(found).toBeGreaterThan(0);
  expect(missing).toEqual([]);
});
