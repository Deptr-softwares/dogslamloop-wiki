// A character colour typed as hex works like one typed as hsl().
//
// Owner tools' COLOUR field takes either (owner.html: "#ff8080 or
// hsl(0, 100%, 75%)"), but until 2026-10-29 only hsl() was ever READ: a hex
// colour gave its page no tint and the wrong ink, and crashed
// combo-block.spec.js at load, which would have stopped every regeneration run.
// Hired Hunter was first saved as #323232 (2026-10-24), and the owner changed
// it to hsl by hand to get the site publishing again.
//
// CAN: that the parser reads both forms the field offers and nothing else, and
// that a real page booted with a hex colour wears the same theme as its hsl
// twin. CANNOT: what owner tools accepts; that is the field's own check.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const site = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'site_meta.js'), 'utf8');
  const w = {};
  // The stubs are for what the file does at load (the frame colours read CSS
  // variables); nothing here uses what they return.
  new Function('window', 'document', 'getComputedStyle', src)(
    w, { addEventListener() {}, documentElement: {} }, () => ({ getPropertyValue: () => '' }));
  return w;
})();

test('the colour parser reads hex and hsl(), and nothing else', () => {
  const read = (c) => {
    const p = site.parseCharacterColor(c);
    return p && { h: p.h, s: Math.round(p.s), l: Math.round(p.l * 10) / 10 };
  };

  expect(read('hsl(233, 39%, 23%)')).toEqual({ h: 233, s: 39, l: 23 });
  expect(read('#1e3a5f')).toEqual({ h: 214, s: 52, l: 24.5 });
  expect(read('#1E3A5F'), 'case does not matter').toEqual(read('#1e3a5f'));
  expect(read('#333'), 'three digits are six').toEqual(read('#333333'));
  expect(read('#323232'), 'grey has no hue').toEqual({ h: 0, s: 0, l: 19.6 });
  expect(read('#ffd966')).toEqual({ h: 45, s: 100, l: 70 });
  expect(read(' #ffd966 '), 'a pasted space is not a different colour').toEqual(read('#ffd966'));

  for (const junk of ['#12', '#1234', '#12345g', 'red', 'rgb(0, 0, 0)', '', null, undefined]) {
    expect(site.parseCharacterColor(junk), `${junk} is not read as a colour`).toBeNull();
  }

  // The 50% line, from both forms.
  expect(site.isDarkCharacterColor('#7f7f7f'), '49.8% light').toBe(true);
  expect(site.isDarkCharacterColor('#808080'), '50.2% light').toBe(false);
});

// The first character on the roster, whoever that is today.
const SUBJECT = (() => {
  const nav = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'navigation.json'), 'utf8'));
  return (nav.Characters || []).find(c => c.url && c.name in site.CHARACTER_COLORS);
})();

// Boots the real page with this colour in the dictionary in place of the
// character's own, and reads back what the theme wrote.
async function themeWith(page, colour) {
  await page.addInitScript(([name, colour]) => {
    let colours;
    Object.defineProperty(window, 'CHARACTER_COLORS', {
      configurable: true,
      get() { return colours; },
      set(v) { colours = { ...v, [name]: colour }; },
    });
  }, [SUBJECT.name, colour]);
  await page.goto(`/${SUBJECT.url}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--accent-blue'), null, { timeout: 15000 });
  return page.evaluate(() => {
    const root = document.documentElement;
    const prop = (p) => root.style.getPropertyValue(p);
    return {
      accent: prop('--accent-blue'),
      border: prop('--border-color'), muted: prop('--text-muted'),
      bgMain: prop('--bg-main'), bgSecondary: prop('--bg-secondary'),
      ink: prop('--character-ink'),
      darkPage: root.classList.contains('page-character-dark'),
    };
  });
}

test('a page coloured in hex wears the same theme as its hsl twin', async ({ page }) => {
  expect(SUBJECT, 'the roster has a coloured character to borrow').toBeTruthy();

  const hex = await themeWith(page, '#1e3a5f');
  const twin = await themeWith(page, 'hsl(214, 52%, 25%)');

  expect(hex.accent).toBe('#1e3a5f');
  expect(hex.bgMain, 'the page is tinted with the colour\'s hue').toBe('hsl(214, 15%, 7%)');
  expect(hex.ink, 'dark, so white text on it').toBe('#ffffff');
  expect(hex.darkPage).toBe(true);
  expect({ ...hex, accent: null }).toEqual({ ...twin, accent: null });
});

test('a light hex colour gets black ink and no dark-page treatment', async ({ page }) => {
  const light = await themeWith(page, '#ffd966');
  expect(light.bgMain).toBe('hsl(45, 15%, 7%)');
  expect(light.ink).toBe('#000000');
  expect(light.darkPage).toBe(false);
});
