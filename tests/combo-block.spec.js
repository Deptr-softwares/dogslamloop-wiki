// The combo block's shape and its hover, redesigned by the owner on
// 2026-08-16 against Dustloop's combo table.
//
// The contract, in the owner's terms:
//   - every element of one combo lives inside ONE box, not as loose chips
//   - steps are linked with '>', not arrows
//   - the box is our wiki's treatment, not Dustloop's: square corners, and a
//     shadow directly below
//   - hovering a STEP lights up that step alone in the character's colour,
//     rather than the whole chip pressing down
//   - the text on that highlight flips for contrast: white on a character
//     colour below 50% lightness, black on 50% and above
//
// The last one is the one worth a test. Register is hsl(0,0%,100%) and
// Aspiring Mangaka is 96% - white text on either is invisible, which is
// exactly the bug a fixed hover colour would ship.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Read from js/site_meta.js so the expectations follow the roster rather than
// a copy of it. Same technique as the tab vocabulary spec.
const CHARACTER_COLORS = (() => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'site_meta.js'), 'utf8');
  const start = src.indexOf('window.CHARACTER_COLORS');
  const body = src.slice(src.indexOf('{', start), src.indexOf('};', start) + 1);
  return JSON.parse(body.replace(/,(\s*})/, '$1'));
})();

const lightnessOf = (hsl) => parseFloat(/hsl\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*([\d.]+)%/.exec(hsl)[1]);

// One from each side of the 50% line, chosen from the real dictionary rather
// than named here, so a colour change picks new subjects automatically.
const DARKEST = Object.entries(CHARACTER_COLORS).sort((a, b) => lightnessOf(a[1]) - lightnessOf(b[1]))[0];
const LIGHTEST = Object.entries(CHARACTER_COLORS).sort((a, b) => lightnessOf(b[1]) - lightnessOf(a[1]))[0];

const SLUG = {
  'Crow Charmer': 'Crow_charmer', 'Black Death': 'Black_death', 'Ten Shadows': 'Ten_shadows',
  'Register': 'Register', 'Aspiring Mangaka': 'Aspiring_mangaka', 'Vessel': 'Vessel',
  'Blood Manipulator': 'Blood_manipulator', 'Defense Attorney': 'Defense_attorney',
};

const TWO_COMBOS = [
  { type: 'combo', sequence: ['MURMURATE', 'R↑', 'AIR UPDRAFT'], damage: '36' },
  { type: 'combo', sequence: ['MURMURATE', 'CIRCLING'], damage: '28', note: 'Corner only' },
];

async function renderCombos(page, blocks = TWO_COMBOS) {
  return page.evaluate((b) => {
    const host = document.createElement('div');
    host.id = 'combo-host';
    document.querySelector('main').appendChild(host);
    host.innerHTML = window.generateHTMLForBlocks(b);
    return host.innerHTML;
  }, blocks);
}

test('one combo is one box, and two combos stack rather than sitting side by side', async ({ page }) => {
  await page.goto('/characters/Crow_charmer/index.html', { waitUntil: 'networkidle' });
  await renderCombos(page);

  const boxes = page.locator('#combo-host .combo-block');
  await expect(boxes).toHaveCount(2);

  const geometry = await page.evaluate(() => {
    const [first, second] = Array.from(document.querySelectorAll('#combo-host .combo-block'));
    const a = first.getBoundingClientRect();
    const b = second.getBoundingClientRect();
    const main = document.querySelector('#combo-host').getBoundingClientRect();
    return {
      stacked: b.top >= a.bottom,
      // The box hugs its route. inline-block got this right and the stacking
      // wrong; a plain block gets the stacking right and this wrong.
      hugsContent: a.width < main.width,
      // Everything belongs to the box, which is what "one box" means.
      stepsInside: first.querySelectorAll('.combo-node').length,
      damageInside: !!first.querySelector('.combo-damage'),
      noteInside: !!second.querySelector('.combo-note-row .combo-note'),
    };
  });

  expect(geometry.stacked, 'the second combo starts below the first').toBe(true);
  expect(geometry.hugsContent, 'the box is as wide as its route, not the column').toBe(true);
  expect(geometry.stepsInside).toBe(3);
  expect(geometry.damageInside).toBe(true);
  expect(geometry.noteInside).toBe(true);
});

test('steps are linked with > and no arrow survives', async ({ page }) => {
  await page.goto('/characters/Crow_charmer/index.html', { waitUntil: 'networkidle' });
  const html = await renderCombos(page);

  const seps = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#combo-host .combo-block')[0].querySelectorAll('.combo-sep'))
      .map(s => s.textContent.trim()));

  // Three steps, two separators - a trailing one would read as an unfinished
  // route.
  expect(seps).toEqual(['>', '>']);
  expect(html, 'the SVG arrow is gone').not.toContain('combo-arrow');
  expect(html).not.toContain('<svg');
});

test('the box is square-cornered with a shadow below it', async ({ page }) => {
  await page.goto('/characters/Crow_charmer/index.html', { waitUntil: 'networkidle' });
  await renderCombos(page);

  const style = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('#combo-host .combo-block'));
    return { radius: cs.borderTopLeftRadius, shadow: cs.boxShadow, border: cs.borderTopWidth };
  });

  expect(style.radius, 'no border radius').toBe('0px');
  expect(style.border, 'the box is drawn').not.toBe('0px');
  // Offset down and not sideways - `0 4px 0 0`.
  expect(style.shadow).toMatch(/0px 4px 0px 0px/);
});

test('hovering a step lights up only that step, in the character colour', async ({ page }) => {
  await page.goto('/characters/Crow_charmer/index.html', { waitUntil: 'networkidle' });
  await renderCombos(page);

  const steps = page.locator('#combo-host .combo-block').first().locator('.combo-node');
  const before = await steps.nth(1).evaluate(el => getComputedStyle(el).backgroundColor);

  await steps.nth(1).hover();
  // The fill is a 0.1s transition; measuring immediately catches it partway
  // and reads back a fractional alpha (rgba(..., 0.804)) rather than the
  // colour. Wait past the transition rather than loosening the assertion.
  await page.waitForTimeout(250);

  const after = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('#combo-host .combo-block')[0].querySelectorAll('.combo-node'));
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-blue').trim();
    // Resolve the accent to the same rgb() form getComputedStyle returns.
    const probe = document.createElement('span');
    probe.style.color = accent;
    document.body.appendChild(probe);
    const accentRgb = getComputedStyle(probe).color;
    probe.remove();
    return {
      hovered: getComputedStyle(nodes[1]).backgroundColor,
      neighbour: getComputedStyle(nodes[0]).backgroundColor,
      accentRgb,
    };
  });

  expect(after.hovered, 'the step fills with the character colour').toBe(after.accentRgb);
  expect(after.hovered).not.toBe(before);
  expect(after.neighbour, 'and only that step - the box does not light up').toBe(before);
});

test('the highlight text flips so it stays readable on any character', async ({ page }) => {
  // The rule: white on a character below 50% lightness, black at 50% and up.
  // Driven on the real extremes of the real roster.
  for (const [name, colour] of [DARKEST, LIGHTEST]) {
    const slug = SLUG[name];
    expect(slug, `no page slug known for ${name} - add it to SLUG`).toBeTruthy();

    await page.goto(`/characters/${slug}/index.html`, { waitUntil: 'networkidle' });
    await renderCombos(page);

    const step = page.locator('#combo-host .combo-block').first().locator('.combo-node').nth(1);
    await step.hover();
    await page.waitForTimeout(250); // past the 0.1s colour transition

    const ink = await step.evaluate(el => getComputedStyle(el).color);
    const expected = lightnessOf(colour) < 50 ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)';

    expect(ink, `${name} is ${lightnessOf(colour)}% light, so its highlight text must be ${expected}`)
      .toBe(expected);
  }
});

test('a combo off a character page still gets a readable highlight', async ({ page }) => {
  // A guide or tool page never runs applyCharacterTheme, so --character-ink
  // falls back to the value in Common.css. The site's default accent is 68%
  // light, so that fallback has to be black - a white default would render
  // white-on-near-white everywhere except character pages.
  await page.goto('/systems/hud/index.html', { waitUntil: 'networkidle' });
  await renderCombos(page);

  const step = page.locator('#combo-host .combo-block').first().locator('.combo-node').nth(1);
  await step.hover();
  await page.waitForTimeout(250); // past the 0.1s colour transition

  const result = await step.evaluate(el => ({
    ink: getComputedStyle(el).color,
    bg: getComputedStyle(el).backgroundColor,
  }));

  expect(result.ink).toBe('rgb(0, 0, 0)');
  expect(result.bg, 'the highlight still fills').not.toBe('rgba(0, 0, 0, 0)');
});
