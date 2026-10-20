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

// The colour drawn at one point of the page. A 1x1 PNG holds one row: a
// filter byte, then the pixel, and with nothing to the left or above it every
// filter leaves the pixel's bytes as they are.
async function pixel(page, x, y) {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  const chunks = [];
  for (let at = 8; at < png.length;) {
    const len = png.readUInt32BE(at);
    if (png.toString('ascii', at + 4, at + 8) === 'IDAT') chunks.push(png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  return [...zlib.inflateSync(Buffer.concat(chunks)).subarray(1, 4)];
}

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

test('the wipe is a bar of the page colour across the heading, and an outline with less motion', async ({ page }) => {
  const { target, id } = await farHeading(page);
  await page.evaluate(id => window.jumpToAnchor(id, { behavior: 'auto' }), id);
  await expect(target).toHaveClass(/\banchor-flash\b/);

  // Held before it starts, then at the moment the bar covers the heading.
  // Sampled inside the top-left corner, above the letters: a heading's own
  // text can be in the page colour too.
  const holdAt = ms => page.evaluate(ms => {
    const wipe = document.getAnimations().find(a => a.animationName === 'anchor-wipe');
    if (!wipe) return false;
    wipe.pause();
    wipe.currentTime = ms;
    return true;
  }, ms);
  const box = await target.boundingBox();
  const spot = [Math.round(box.x + 3), Math.round(box.y + 1)];
  const accent = await rgbOf(page, '--accent-blue');
  expect(await holdAt(0)).toBe(true);
  expect(near(await pixel(page, ...spot), accent, 6)).toBe(false);
  expect(await holdAt(315)).toBe(true);
  expect(near(await pixel(page, ...spot), accent, 6)).toBe(true);

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
