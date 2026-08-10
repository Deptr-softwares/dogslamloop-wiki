// block.author is contributor-reachable: it rides along inside submitted
// block data and renders on every character and system page through
// generateHTMLForBlocks' aggregated contributor footer. It was going into
// innerHTML raw.
//
// Deliberately narrow. Block *content* in the same function is rich HTML on
// purpose - contributors write formatted prose, paragraphs run a keybind
// substitution over the text, and lists/headings interpolate directly.
// Escaping those would break every formatted page on the site. An author
// name is an identity label, not prose, so it gets escaped.
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

test('block content itself stays rich HTML - the escaping is scoped to author names', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });

  // Guards against over-correcting. Formatting inside block content is the
  // wiki's whole point; a blanket escape here would flatten every page.
  const result = await page.evaluate(() => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    host.innerHTML = window.generateHTMLForBlocks([
      { type: 'paragraph', content: 'Press [M1] then <b>cancel</b>.' },
    ]);

    return {
      keybindRendered: !!host.querySelector('kbd.keybind-badge'),
      boldRendered: !!host.querySelector('p b'),
    };
  });

  expect(result.keybindRendered, '[M1] still becomes a keybind badge').toBe(true);
  expect(result.boldRendered, 'contributor formatting still renders').toBe(true);
});
