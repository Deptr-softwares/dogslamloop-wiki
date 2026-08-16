// block.author is contributor-reachable: it rides along inside submitted
// block data and renders on every character and system page through
// generateHTMLForBlocks' aggregated contributor footer. It was going into
// innerHTML raw.
//
// This file used to say block *content* was rich HTML on purpose, and that
// escaping it "would break every formatted page on the site". That was wrong,
// and it was load-bearing wrong: it left a stored XSS in place and guarded it
// with a test. v0.15 corrected it on evidence, not opinion:
//
//   - Contributors do not write HTML. The editor's formatting toolbar
//     (applyFormat, js/editor-blocks.js) emits BBCODE - [b]…[/b],
//     [color=#f00]…[/color], [url=…]…[/url] - which js/internalstyling.js
//     converts to HTML after render. HTML escaping does not touch square
//     brackets, so every one of those still works.
//   - A scan of all live content at the time (33 pages) found ZERO angle
//     brackets in any contributor string. Nothing depended on the behaviour
//     the old comment was protecting.
//   - The bold and coloured text visible on a character page comes from
//     internalstyling.js operating on the DOM, not from stored markup.
//
// So block content is escaped now, and the test below asserts the real
// contract: BBCode renders, literal HTML does not. See
// tests/block-escaping.spec.js for the full surface.
const { test, expect } = require('@playwright/test');

test('author badges escape contributor-supplied names instead of executing them', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  await page.goto('/', { waitUntil: 'networkidle' });

  const result = await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'author-escape-host';
    document.body.appendChild(host);

    host.innerHTML = window.generateHTMLForBlocks([
      {
        type: 'paragraph',
        content: 'Some strategy text.',
        author: '<img src=x onerror="window.__authorXss = 1">Mallory',
      },
    ]);

    const badges = Array.from(host.querySelectorAll('.author-badge'));
    return {
      badgeCount: badges.length,
      // The name survives as readable text...
      badgeText: badges.map(b => b.textContent),
      // ...but no element was ever created from it.
      injectedImg: !!host.querySelector('.author-badge img'),
      xss: !!window.__authorXss,
    };
  });

  expect(result.badgeCount, 'the footer still renders').toBe(1);
  expect(result.badgeText[0]).toContain('Mallory');
  expect(result.badgeText[0], 'the raw string is shown, not interpreted').toContain('<img');
  expect(result.injectedImg).toBe(false);
  expect(result.xss).toBe(false);
  expect(pageErrors).toEqual([]);
});

test('a comma-separated author list escapes every name, not just the first', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });

  // block.author is split on commas so several contributors can share one
  // block - the escaping has to survive that split.
  const result = await page.evaluate(() => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    host.innerHTML = window.generateHTMLForBlocks([
      { type: 'paragraph', content: 'x', author: 'Alice, <b>Bob</b>, <svg onload="window.__lateXss=1">' },
    ]);

    return {
      badgeText: Array.from(host.querySelectorAll('.author-badge')).map(b => b.textContent.trim()),
      injectedEls: host.querySelectorAll('.author-badge b, .author-badge svg').length,
      xss: !!window.__lateXss,
    };
  });

  expect(result.badgeText).toEqual(['Alice', '<b>Bob</b>', '<svg onload="window.__lateXss=1">']);
  expect(result.injectedEls).toBe(0);
  expect(result.xss).toBe(false);
});

test('contributor formatting still renders, and it is BBCode rather than HTML', async ({ page }) => {
  // Guards against over-correcting, which is a real risk - escaping that also
  // killed formatting would trade one bug for a quieter one. The formatting a
  // contributor can actually produce must survive intact; literal HTML, which
  // the editor gives them no way to write, must not.
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate(() => {
    const host = document.createElement('div');
    document.querySelector('main').appendChild(host);

    host.innerHTML = window.generateHTMLForBlocks([
      { type: 'paragraph', content: 'Press [M1] then [b]cancel[/b] into [color=#ff0000]red[/color].' },
      { type: 'paragraph', content: 'Literal <b>markup</b> is text.' },
    ]);
    // The BBCode pass runs over the rendered DOM, which is where the wiki's
    // formatting has always actually happened.
    if (typeof window.applyInternalStyling === 'function') window.applyInternalStyling(host);

    return {
      keybindRendered: !!host.querySelector('kbd.keybind-badge'),
      boldRendered: !!host.querySelector('strong'),
      colorRendered: !!host.querySelector('.sc-color'),
      literalHtmlBecameAnElement: !!host.querySelector('p b'),
      literalHtmlShownAsText: host.textContent.includes('<b>markup</b>'),
    };
  });

  expect(result.keybindRendered, '[M1] still becomes a keybind badge').toBe(true);
  expect(result.boldRendered, '[b] still becomes bold').toBe(true);
  expect(result.colorRendered, '[color=] still colours text').toBe(true);
  expect(result.literalHtmlBecameAnElement, 'typed HTML must never become an element').toBe(false);
  expect(result.literalHtmlShownAsText, 'it is shown as the text it is').toBe(true);
});
