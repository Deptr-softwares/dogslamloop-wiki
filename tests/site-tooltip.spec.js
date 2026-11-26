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
