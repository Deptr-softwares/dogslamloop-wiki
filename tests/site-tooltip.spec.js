// The site's tooltip (window.showTooltipFor, bindTooltip and data-tip hints in
// site_media.js). Until v1.3 it trailed the mouse, which can never reach it, a tap
// showed it where the finger was, and nothing showed it to a keyboard: callouts are
// spans and Frame Track phases are divs, which Tab never reaches.
const { test, expect } = require('@playwright/test');

const PAGE = '/characters/Boomcat/index.html';
const tip = (page) => page.locator('#wiki-frame-tooltip');

// A fixed spot of the test's own on a real page, so the tooltip's place is known.
async function addSpot(page, { id = 'spot', top = 300, left = 400, html = 'Frames before the hitbox comes out.', hint = null, now = false } = {}) {
  await page.evaluate(({ id, top, left, html, hint, now }) => {
    const spot = document.createElement('span');
    spot.id = id;
    spot.textContent = 'Startup';
    spot.style.cssText = `position: fixed; top: ${top}px; left: ${left}px; width: 120px; height: 24px; z-index: 50; background: #222;`;
    document.body.appendChild(spot);
    if (hint !== null) {
      spot.dataset.tip = hint;
      if (now) spot.setAttribute('data-tip-now', '');
    } else {
      window.bindTooltip(spot, html);
    }
  }, { id, top, left, html, hint, now });
  return page.locator(`#${id}`);
}

const boxes = (page, id) => page.evaluate((id) => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, mid: b.left + b.width / 2 }; };
  return { spot: r(document.getElementById(id)), tip: r(document.getElementById('wiki-frame-tooltip')) };
}, id);

async function openPage(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'networkidle' });
  return errors;
}

test('the tooltip sits centred above what it explains, and stays there while the mouse moves', async ({ page }) => {
  const errors = await openPage(page);
  const spot = await addSpot(page);
  await spot.hover({ position: { x: 10, y: 12 } });
  await expect(tip(page)).toHaveText('Frames before the hitbox comes out.');

  const first = await boxes(page, 'spot');
  expect(first.tip.bottom).toBeLessThanOrEqual(first.spot.top);
  expect(Math.abs(first.tip.mid - first.spot.mid)).toBeLessThan(1);

  await spot.hover({ position: { x: 110, y: 12 } });
  const second = await boxes(page, 'spot');
  expect(second.tip).toEqual(first.tip);
  expect(errors).toEqual([]);
});

test('with no room above, the tooltip sits below', async ({ page }) => {
  await openPage(page);
  const spot = await addSpot(page, { top: 0 });
  await spot.hover();
  await expect(tip(page)).toBeVisible();
  const b = await boxes(page, 'spot');
  expect(b.tip.top).toBeGreaterThanOrEqual(b.spot.bottom);
});

test('the mouse can move onto the tooltip to read it, and leaving it closes it', async ({ page }) => {
  await openPage(page);
  const spot = await addSpot(page, { html: 'A long note about this phase. '.repeat(6) });
  await spot.hover();
  await expect(tip(page)).toBeVisible();
  const b = await boxes(page, 'spot');
  // Up out of the spot, across the gap and into the tooltip.
  await page.mouse.move(b.spot.mid, b.spot.top - 2);
  await page.mouse.move(b.tip.mid, b.tip.bottom - 10, { steps: 3 });
  await page.waitForTimeout(400);
  await expect(tip(page)).toBeVisible();

  await page.mouse.move(5, 5);
  await expect(tip(page)).toBeHidden();
});

test('a callout or a phase is reached by Tab, and focus shows its tooltip', async ({ page }) => {
  await openPage(page);
  const spot = await addSpot(page);
  expect(await spot.evaluate(el => el.tabIndex)).toBe(0);

  await page.keyboard.press('Shift');
  await spot.focus();
  await expect(tip(page)).toHaveText('Frames before the hitbox comes out.');
  // A screen reader hears it as the spot's description while it shows.
  await expect(spot).toHaveAttribute('aria-describedby', 'wiki-frame-tooltip');
  await expect(tip(page)).toHaveAttribute('role', 'tooltip');

  await page.keyboard.press('Tab');
  await expect(tip(page)).toBeHidden();
  await expect(spot).not.toHaveAttribute('aria-describedby', /./);
});

test('Escape closes the tooltip', async ({ page }) => {
  await openPage(page);
  const spot = await addSpot(page);
  await spot.hover();
  await expect(tip(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tip(page)).toBeHidden();
});

test('the tooltip\'s look is the stylesheet\'s: only its place is set by the script', async ({ page }) => {
  await openPage(page);
  const spot = await addSpot(page);
  await spot.hover();
  await expect(tip(page)).toBeVisible();
  const look = await tip(page).evaluate(el => ({
    inline: [...el.style].sort(),
    position: getComputedStyle(el).position,
    border: getComputedStyle(el).borderTopWidth,
    pointer: getComputedStyle(el).pointerEvents,
  }));
  expect(look).toEqual({ inline: ['left', 'top'], position: 'fixed', border: '2px', pointer: 'auto' });
});

test('a data-tip hint waits half a second on hover, and data-tip-now shows at once', async ({ page }) => {
  await openPage(page);
  const slow = await addSpot(page, { id: 'slow', hint: 'Drag to reorder' });
  const fast = await addSpot(page, { id: 'fast', top: 400, hint: 'Right now', now: true });

  await slow.hover();
  await page.waitForTimeout(250);
  await expect(tip(page)).toBeHidden();
  await expect(tip(page)).toHaveText('Drag to reorder', { timeout: 1500 });

  await fast.hover();
  await expect(tip(page)).toHaveText('Right now', { timeout: 200 });

  // A hint is text, never markup.
  await page.evaluate(() => { document.getElementById('fast').dataset.tip = '<b>bold</b>'; });
  await page.mouse.move(5, 5);
  await fast.hover();
  await expect(tip(page)).toHaveText('<b>bold</b>');
  await expect(tip(page).locator('b')).toHaveCount(0);
});

test('focus on an in-page link shows where it goes', async ({ page }) => {
  await openPage(page);
  await page.evaluate(() => {
    const panel = [...document.querySelectorAll('[id^="tab-"]')].find(p => !p.classList.contains('hidden'));
    const h = document.createElement('h2');
    h.className = 'section-title';
    h.textContent = 'Zzq Neutral Game';
    panel.appendChild(h);
    window.assignSectionAnchors();
    const p = document.createElement('p');
    p.className = 'wiki-text';
    p.textContent = `[url=#${h.id}]Jump there[/url]`;
    panel.insertBefore(p, panel.firstChild);
    window.applyInternalStyling();
  });
  const link = page.locator('a.wiki-link-jump', { hasText: 'Jump there' });
  await page.keyboard.press('Shift');
  await link.focus();
  await expect(tip(page)).toHaveText('Zzq Neutral Game');
  const pinned = await page.evaluate(() => {
    const a = document.querySelector('a.wiki-link-jump').getBoundingClientRect();
    const t = document.getElementById('wiki-frame-tooltip').getBoundingClientRect();
    return t.bottom <= a.top || t.top >= a.bottom;
  });
  expect(pinned).toBe(true);
  await page.keyboard.press('Tab');
  await expect(tip(page)).toBeHidden();
});

// --- The hints: every title the site wrote is the site's tooltip since v1.3 ---

test('no page or script writes a title hint: they are data-tip, and only an iframe keeps its title', () => {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.join(__dirname, '..');
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'vendor') walk(p); }
      else if (e.name.endsWith('.js')) files.push(p);
    }
  };
  walk(path.join(ROOT, 'js'));
  for (const f of fs.readdirSync(ROOT)) if (f.endsWith('.html')) files.push(path.join(ROOT, f));
  const found = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\stitle=\\?["']/g)) {
      const tag = text.slice(text.lastIndexOf('<', m.index), m.index);
      if (!/^<iframe\b/i.test(tag)) found.push(`${path.relative(ROOT, file)}: ${tag.slice(0, 60)}`);
    }
    for (const m of text.matchAll(/setAttribute\(\s*['"]title['"]/g)) found.push(`${path.relative(ROOT, file)}: ${m[0]}`);
  }
  expect(files.length).toBeGreaterThan(50);
  expect(found).toEqual([]);
});

async function openBlockEditor(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/edit.html?char=testchar&tab=overview', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.initStrategyBlockBuilder === 'function', { timeout: 15000 });
  await page.evaluate(() => {
    document.body.innerHTML = '<div id="block-host" style="padding: 2rem 1.5rem"></div>';
    window.initStrategyBlockBuilder('block-host', [{ type: 'paragraph', content: 'one' }, { type: 'paragraph', content: 'two' }]);
  });
  return errors;
}

test('a Block\'s delete button shows its hint in the site tooltip after a moment, and is named for a screen reader', async ({ page }) => {
  const errors = await openBlockEditor(page);
  const del = page.locator('#block-list .block-card[data-index="1"] .btn-delete');
  await expect(del).toHaveAttribute('aria-label', 'Delete');
  await expect(del).not.toHaveAttribute('title', /./);

  await del.hover();
  await page.waitForTimeout(250);
  await expect(tip(page)).toBeHidden();
  await expect(tip(page)).toHaveText('Delete', { timeout: 1500 });
  const b = await page.evaluate(() => {
    const d = document.querySelector('#block-list .block-card[data-index="1"] .btn-delete').getBoundingClientRect();
    const t = document.getElementById('wiki-frame-tooltip').getBoundingClientRect();
    // Centred on it, unless held on screen at either edge.
    const held = t.left <= 8.5 || t.right >= window.innerWidth - 8.5;
    return { above: t.bottom <= d.top, centred: Math.abs((t.left + t.width / 2) - (d.left + d.width / 2)) < 1 || held };
  });
  expect(b).toEqual({ above: true, centred: true });
  expect(errors).toEqual([]);
});

test('Tab onto a hinted button shows its hint at once', async ({ page }) => {
  await openBlockEditor(page);
  const up = page.locator('#block-list .block-card[data-index="1"] .btn-up');
  await page.keyboard.press('Shift');
  await up.focus();
  await expect(tip(page)).toHaveText('Move Up', { timeout: 300 });
  await expect(up).toHaveAttribute('aria-describedby', 'wiki-frame-tooltip');
});

test('a hint inside something whose tooltip is open leaves that tooltip alone', async ({ page }) => {
  await openPage(page);
  await page.evaluate(() => {
    const callout = document.createElement('span');
    callout.id = 'callout';
    callout.style.cssText = 'position: fixed; top: 300px; left: 300px; padding: 10px 40px; background: #222; z-index: 50;';
    callout.innerHTML = 'Read <span id="inner-icon" data-tip="An icon">*</span> this';
    document.body.appendChild(callout);
    window.bindTooltip(callout, 'The callout says this.');
  });
  await page.locator('#callout').hover({ position: { x: 5, y: 5 } });
  await expect(tip(page)).toHaveText('The callout says this.');
  await page.locator('#inner-icon').hover();
  await page.waitForTimeout(800);
  await expect(tip(page)).toHaveText('The callout says this.');
});

test('a hint lets a click through to what it covers', async ({ page }) => {
  await openPage(page);
  const spot = await addSpot(page, { hint: 'A hint long enough to cover the button above it', now: true });
  await page.evaluate(() => {
    const b = document.getElementById('spot').getBoundingClientRect();
    const btn = document.createElement('button');
    btn.id = 'under';
    btn.textContent = 'x';
    btn.style.cssText = `position: fixed; left: ${b.left + 40}px; top: ${b.top - 30}px; width: 40px; height: 20px; z-index: 40;`;
    document.body.appendChild(btn);
  });
  await spot.hover();
  await expect(tip(page)).toBeVisible();
  const hit = await page.evaluate(() => {
    const t = document.getElementById('wiki-frame-tooltip').getBoundingClientRect();
    const u = document.getElementById('under').getBoundingClientRect();
    const covered = u.left < t.right && u.right > t.left && u.top < t.bottom && u.bottom > t.top;
    const at = document.elementFromPoint(u.left + u.width / 2, u.top + u.height / 2);
    return { covered, reaches: at && at.id };
  });
  expect(hit).toEqual({ covered: true, reaches: 'under' });
});

test('over a control inside a hinted container, only that control\'s own hint shows', async ({ page }) => {
  await openPage(page);
  await page.evaluate(() => {
    const bar = document.createElement('div');
    bar.id = 'bar';
    bar.dataset.tip = 'Highlight text, then pick a style';
    bar.style.cssText = 'position: fixed; top: 300px; left: 200px; width: 400px; height: 60px; background: #222; z-index: 50;';
    bar.innerHTML = '<input id="field" style="position: absolute; left: 10px; top: 10px; width: 120px;">'
      + '<button id="own" data-tip="Bold" style="position: absolute; left: 200px; top: 10px;">B</button>';
    document.body.appendChild(bar);
  });
  await page.locator('#field').hover();
  await page.waitForTimeout(800);
  await expect(tip(page)).toBeHidden();

  await page.locator('#own').hover();
  await expect(tip(page)).toHaveText('Bold', { timeout: 1500 });

  // A gap in the bar is the bar's.
  await page.mouse.move(580, 350);
  await expect(tip(page)).toHaveText('Highlight text, then pick a style', { timeout: 1500 });
});

test('a text hint keeps its line breaks, and a disabled button still shows its hint', async ({ page }) => {
  await openPage(page);
  await page.evaluate(() => {
    const btn = document.createElement('button');
    btn.id = 'off';
    btn.disabled = true;
    btn.textContent = 'APPLY';
    btn.dataset.tip = 'First line\nSecond line';
    btn.style.cssText = 'position: fixed; top: 300px; left: 300px; z-index: 50;';
    document.body.appendChild(btn);
  });
  await page.locator('#off').hover({ force: true });
  await expect(tip(page)).toBeVisible({ timeout: 1500 });
  expect(await tip(page).evaluate(el => el.innerText)).toBe('First line\nSecond line');
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true });

  test('a tap shows the tooltip at what was tapped, and a tap elsewhere closes it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPage(page);
    const spot = await addSpot(page, { left: 100 });
    await spot.tap({ position: { x: 110, y: 12 } });
    await expect(tip(page)).toBeVisible();
    const b = await boxes(page, 'spot');
    expect(b.tip.bottom).toBeLessThanOrEqual(b.spot.top);
    expect(b.tip.right).toBeLessThanOrEqual(390);

    await page.touchscreen.tap(20, 700);
    await expect(tip(page)).toBeHidden();
  });

  test('a tap shows a hint on text, but never on a button, which the tap presses', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPage(page);
    const text = await addSpot(page, { id: 'text-hint', left: 100, hint: 'A word explained' });
    await page.evaluate(() => {
      const btn = document.createElement('button');
      btn.id = 'button-hint';
      btn.textContent = 'Go';
      btn.dataset.tip = 'Does the thing';
      btn.style.cssText = 'position: fixed; top: 500px; left: 100px; z-index: 50;';
      btn.addEventListener('click', () => { window.pressed = (window.pressed || 0) + 1; });
      document.body.appendChild(btn);
    });

    await page.locator('#button-hint').tap();
    await page.waitForTimeout(800);
    await expect(tip(page)).toBeHidden();
    expect(await page.evaluate(() => window.pressed)).toBe(1);

    await text.tap();
    await expect(tip(page)).toHaveText('A word explained');
  });
});
