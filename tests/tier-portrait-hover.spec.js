// v0.16 fine-tuning 8: "the name rises from under the portrait; bigger boxes,
// tighter spacing."
//
// The same interaction the Roster Icon got this version, on the second surface
// that shows a portrait with a name behind it. Built once in CSS off
// `attr(title)`, because all three renderers - js/tierlist.js,
// js/tier-editor.js, js/certified-tier-lists.js - already set title to the
// character's name.
//
// The thing most at risk here is the FALLBACK. .tier-portrait-name sits behind
// the image at z-index 2 and shows through when a portrait 404s, which is the
// reason an unresolved key is visible rather than silently blank. A hover label
// built by moving that span would have traded a working fallback for an
// animation, so there is a test for it below.
const { test, expect } = require('@playwright/test');

// A harness rather than a live tier list: these assertions are about the CSS
// contract for .tier-portrait, and the owner edits the real lists.
async function harness(page, extraClass = '') {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/systems/tierlist/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);

  await page.evaluate((extraClass) => {
    const host = document.createElement('div');
    host.id = 'tp-host';
    host.innerHTML = `
      <div class="tier-list-row">
        <div class="tier-list-row-chars">
          <div class="tier-portrait ${extraClass}" title="Blood Manipulator" style="background-color: rgb(120, 20, 20);">
            <span class="tier-portrait-name">Blood Manipulator</span>
            <img class="tier-portrait-img" alt="">
          </div>
        </div>
      </div>`;
    document.body.appendChild(host);
  }, extraClass);
  await page.waitForTimeout(200);
  return page.locator('#tp-host .tier-portrait');
}

const label = (page) => page.evaluate(() => {
  const p = document.querySelector('#tp-host .tier-portrait');
  const cs = getComputedStyle(p, '::after');
  return {
    content: cs.content,
    transform: cs.transform,
    display: cs.display,
    zIndex: cs.zIndex,
  };
});

test('the name is parked out of sight until you hover', async ({ page }) => {
  const portrait = await harness(page);

  const atRest = await label(page);
  // matrix(1, 0, 0, 1, 0, H) - translated down by its own height, and clipped
  // away by .tier-portrait's overflow: hidden.
  expect(atRest.content, 'the label takes its text from the title already there')
    .toContain('Blood Manipulator');
  expect(atRest.display, 'setup: the label exists').not.toBe('none');
  expect(atRest.transform, 'parked below the box').not.toBe('none');
  const restY = parseFloat(atRest.transform.split(',')[5]);
  expect(restY, 'pushed down out of the portrait').toBeGreaterThan(4);

  await portrait.hover();
  await page.waitForTimeout(320);

  const hovered = await label(page);
  const hoverY = parseFloat(hovered.transform.split(',')[5]);
  expect(hoverY, 'and it rises to sit in the portrait').toBeLessThan(1);
});

test('the 404 fallback still shows through', async ({ page }) => {
  // The span behind the image, which is what makes a missing portrait readable
  // instead of a blank coloured square. If the hover label had been built by
  // repositioning this, it would now be parked off-screen too.
  await harness(page);

  const seen = await page.evaluate(() => {
    const name = document.querySelector('#tp-host .tier-portrait-name');
    const img = document.querySelector('#tp-host .tier-portrait-img');
    img.style.display = 'none';           // exactly what the onerror handler does
    const r = name.getBoundingClientRect();
    return {
      text: name.textContent.trim(),
      visible: r.width > 0 && r.height > 0 && getComputedStyle(name).display !== 'none',
      // Still behind where the image would be, not lifted above it.
      z: getComputedStyle(name).zIndex,
    };
  });

  expect(seen.text).toBe('Blood Manipulator');
  expect(seen.visible, 'the name is readable when the portrait 404s').toBe(true);
  expect(seen.z, 'and is still the layer underneath').toBe('2');
});

test('no label on the drag ghost or the portrait being dragged', async ({ page }) => {
  // A label rising mid-drag reads as a bug and covers the drop target the
  // pointer is hunting for.
  // Read directly rather than hovering: .tier-portrait-ghost is position:fixed
  // with a translate(-50%,-50%) and no top/left until the drag code places it,
  // so it starts outside the viewport and Playwright rightly refuses to hover
  // it. The rule is unconditional anyway - the label is display:none on these
  // two whether or not a pointer is over them - so hovering proved nothing the
  // computed style does not.
  for (const cls of ['tier-portrait-ghost', 'tier-portrait-dragging']) {
    await harness(page, cls);
    const seen = await label(page);
    expect(seen.display, `${cls} shows no rising label`).toBe('none');
    await page.evaluate(() => document.getElementById('tp-host').remove());
  }

  // And the control: without either class, it is there to be hidden.
  await harness(page);
  expect((await label(page)).display, 'a plain portrait still has one').not.toBe('none');
});

test('the label never eats the click', async ({ page }) => {
  // .tier-portrait is a link on the certified page and a drag handle in the
  // editor. Whatever is on top at the pointer has to be the portrait.
  const portrait = await harness(page);
  await portrait.hover();
  await page.waitForTimeout(320);

  const onTop = await page.evaluate(() => {
    const p = document.querySelector('#tp-host .tier-portrait');
    const r = p.getBoundingClientRect();
    // Aim at the bottom band, where the label now is.
    const hit = document.elementFromPoint(r.left + r.width / 2, r.bottom - 6);
    return { isPortrait: p.contains(hit) || hit === p, tag: hit ? hit.className : null };
  });

  expect(onTop.isPortrait, `the portrait is what the pointer hits (got ${onTop.tag})`).toBe(true);
});

test('the live tier rows got the bigger boxes and tighter spacing', async ({ page }) => {
  // The certified page already had this; this is the same treatment for the
  // surface js/tierlist.js renders.
  await harness(page);

  const seen = await page.evaluate(() => {
    const row = document.querySelector('#tp-host .tier-list-row-chars');
    const p = document.querySelector('#tp-host .tier-portrait');
    return {
      size: Math.round(p.getBoundingClientRect().width),
      gap: getComputedStyle(row).gap,
      padding: getComputedStyle(row).padding,
    };
  });

  expect(seen.size, 'bigger than the 60px it was').toBeGreaterThan(70);
  expect(parseFloat(seen.gap), 'and tighter between them').toBeLessThan(8);
});

test('the editor keeps the 60px its drag hit-testing was built around', async ({ page }) => {
  // The reason the rule above is scoped to .tier-list-row-chars rather than
  // applied to .tier-portrait. certified-tier-lists.css says the same thing
  // about its own override, and this is the check that keeps both honest.
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/systems/tierlist/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);

  const size = await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'tray-host';
    // A portrait OUTSIDE a tier row, the way the editor's roster tray renders.
    host.innerHTML = '<div class="tier-portrait" title="X"></div>';
    document.body.appendChild(host);
    const el = host.querySelector('.tier-portrait');
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      declared: cs.width,
      boxSizing: cs.boxSizing,
      rendered: Math.round(r.width),
    };
  });

  // The DECLARED width, not the rect: .tier-portrait is content-box with a 2px
  // border, so 60px of box measures 64px on screen. Asserting 60 against
  // getBoundingClientRect failed for that reason and not because anything had
  // moved - worth stating, since the next person to touch this will measure the
  // rect first too.
  expect(size.boxSizing, 'setup: still content-box, so 60 + 4 of border').toBe('content-box');
  expect(size.declared, 'a tray portrait is untouched').toBe('60px');
  expect(size.rendered, 'which is 64px on screen').toBe(64);
});
