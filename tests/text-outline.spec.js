// [outline] gives text a white outline (owner's wishlist, 2026-10-18: "New
// format option: White outline for text"). It is drawn by the same rule that
// outlines a dark character name on a dark page, so the two cannot drift into
// two different-looking outlines.
//
// What a reader sees is the computed paint, so that is what is asserted, not
// the class: a class that is present and styled by nothing is the failure the
// writing-tests skill opens with.
const { test, expect } = require('@playwright/test');

const PAGE = '/systems/terminologies/index.html';

async function styled(page, raw) {
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.applyInternalStyling === 'function');
  return page.evaluate((raw) => {
    const host = document.createElement('div');
    host.className = 'wiki-text';
    host.textContent = raw;
    (document.querySelector('main') || document.body).appendChild(host);
    window.applyInternalStyling();
    const span = host.querySelector('.sc-outline');
    const cs = span && getComputedStyle(span);
    return {
      text: host.textContent,
      tag: span ? span.textContent : null,
      stroke: cs ? cs.webkitTextStrokeColor : null,
      strokeWidth: cs ? cs.webkitTextStrokeWidth : null,
      shadow: cs ? cs.textShadow : null,
      leftover: host.innerHTML.includes('[outline]'),
    };
  }, raw);
}

test('[outline] draws a white outline around exactly its words', async ({ page }) => {
  const out = await styled(page, 'Before [outline]Domain Expansion[/outline] after.');

  expect(out.tag).toBe('Domain Expansion');
  expect(out.text).toBe('Before Domain Expansion after.');
  expect(out.leftover, 'no tag is left on the page').toBe(false);

  // Chromium supports paint-order, so the stroke branch is the one in force.
  // Either branch is white; this asserts the one a reader here actually gets.
  expect(out.stroke).toBe('rgb(255, 255, 255)');
  expect(out.strokeWidth).toBe('1px');
});

test('[outline] nests inside a colour, which is how a dark word gets it', async ({ page }) => {
  const out = await styled(page, '[color=#111111][outline]Black Flash[/outline][/color]');
  expect(out.tag).toBe('Black Flash');
  expect(out.stroke).toBe('rgb(255, 255, 255)');
});

test('section anchors and search text drop the tag, not the words', async ({ page }) => {
  // window.stripStyleShortcodes (js/character_tabs.js) is what headings pass
  // through before they become anchors and search-index text. A tag it does
  // not know about would end up in a URL.
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  const plain = await page.evaluate(() =>
    window.stripStyleShortcodes('[outline]Black Flash[/outline] timing'));
  expect(plain).toBe('Black Flash timing');
});
