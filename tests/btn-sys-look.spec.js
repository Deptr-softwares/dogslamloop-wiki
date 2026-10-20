// The system button's look (v1.1, W13). The owner picked from three mockups,
// 2026-10-20: "the hard shadow of option A, the subtle movement when pressed
// on, the hover effect animation, the styling of option B, and the faint
// background matching color of option C ... the button lift up 1px when
// hovered over". So: B's cut top-right corner and its fill sweeping in from
// the left, A's hard shadow, C's faint tint of the button's own colour, a 1px
// lift on hover and a 1px nudge on a press.
//
// Read back as the browser computes it, after any transition has finished.
const { test, expect } = require('@playwright/test');

const PAGE = '/systems/framedata/index.html';

// Buttons pinned to the top-left corner, above the page, so a hover reaches them.
async function stage(page) {
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'zzq-buttons';
    host.style.cssText = 'position: fixed; top: 40px; left: 40px; z-index: 100000; display: flex; gap: 24px;';
    host.innerHTML = `
      <button type="button" class="btn-sys btn-sys-red" id="zzq-red">Delete</button>
      <button type="button" class="btn-sys btn-sys-green" id="zzq-green">Approve</button>
      <button type="button" class="btn-sys btn-sys-red" id="zzq-off" disabled>Off</button>`;
    document.body.appendChild(host);
  });
}

const look = (page, id) => page.locator(`#${id}`).evaluate(el => {
  const cs = getComputedStyle(el);
  return {
    clip: cs.clipPath, shadow: cs.boxShadow, image: cs.backgroundImage, size: cs.backgroundSize,
    bg: cs.backgroundColor, border: cs.borderTopColor, color: cs.color, transform: cs.transform,
  };
});

test('at rest: a cut corner, a faint tint of its own colour, and a hard shadow', async ({ page }) => {
  await stage(page);
  const red = await look(page, 'zzq-red');
  const green = await look(page, 'zzq-green');

  expect(red.clip, 'the cut corner').toContain('polygon');
  expect(red.shadow, 'a hard shadow, no blur').toMatch(/3px 3px 0px/);
  expect(red.border).toBe('rgb(239, 68, 68)');
  // The face is tinted by the button's own colour, so two colours differ.
  expect(red.bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(red.bg).not.toBe('rgba(0, 0, 0, 0.6)');
  expect(red.bg).not.toBe(green.bg);
  // The cut's own edge, and the hover fill waiting at zero width.
  expect((red.image.match(/linear-gradient/g) || []).length).toBe(2);
  expect(red.size).toMatch(/, 0% 100%/);
});

test('hover lifts it 1px, sweeps the colour in, and darkens the shadow', async ({ page }) => {
  await stage(page);
  await page.locator('#zzq-red').hover();
  await expect.poll(() => look(page, 'zzq-red')).toMatchObject({
    transform: 'matrix(1, 0, 0, 1, 0, -1)',
    color: 'rgb(0, 0, 0)',
  });
  const hovered = await look(page, 'zzq-red');
  expect(hovered.size, 'the fill has swept across').toMatch(/, 100% 100%/);
  expect(hovered.shadow, 'the shadow stays on the ground, so it is 1px taller').toMatch(/3px 4px 0px/);
  expect(hovered.shadow).not.toMatch(/rgb\(0, 0, 0\)/);
});

test('a press nudges it 1px, and the shadow stays where it was', async ({ page }) => {
  await stage(page);
  await page.locator('#zzq-red').hover();
  await page.mouse.down();
  await expect.poll(async () => (await look(page, 'zzq-red')).transform).toBe('matrix(1, 0, 0, 1, 1, 1)');
  expect((await look(page, 'zzq-red')).shadow).toMatch(/2px 2px 0px/);
  await page.mouse.up();
});

test('a disabled button does not react', async ({ page }) => {
  await stage(page);
  await page.locator('#zzq-off').hover({ force: true });
  await page.waitForTimeout(300);
  const off = await look(page, 'zzq-off');
  expect(off.transform).toBe('none');
  expect(off.size).toMatch(/, 0% 100%/);
});

// --- THE BLUE VARIANT ON A CHARACTER'S PAGE ---
//
// Owner, 2026-10-20: "I think .btn-sys should have a blue color variant ... so
// it can be used for the Media Library which is gray right now." It had one;
// it was gray because a character page's theme sets --accent-blue to the
// character's colour, and Boomcat's is a light gray.

test("the blue button stays blue on a character's themed editor", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('dsl_editor_tutorial_seen', '1');
      localStorage.setItem('dsl_notice_seen_editor', '1');
    } catch (e) { /* ignore */ }
  });
  await page.goto('/edit.html?char=boomcat&type=character&tab=overview', { waitUntil: 'domcontentloaded' });
  const media = page.locator('#btn-media-library');
  await expect(media).toBeAttached({ timeout: 45000 });

  const out = await page.evaluate(() => {
    const resolve = (c) => {
      const probe = document.createElement('span');
      probe.style.color = c;
      document.body.appendChild(probe);
      const v = getComputedStyle(probe).color;
      probe.remove();
      return v;
    };
    return {
      themed: resolve(getComputedStyle(document.documentElement).getPropertyValue('--accent-blue').trim()),
      blue: resolve('hsl(213, 94%, 68%)'),
      border: getComputedStyle(document.getElementById('btn-media-library')).borderTopColor,
    };
  });
  expect(out.themed, 'the page really is themed away from blue').not.toBe(out.blue);
  expect(out.border).toBe(out.blue);
});
