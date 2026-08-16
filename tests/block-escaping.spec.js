// Contributor-authored block content is escaped on its way into innerHTML.
//
// It was not, and that was a live stored XSS. A combo block submitted with a
// step of `<img src=x onerror=...>` executed:
//   - for every reader of the character page, once approved, and
//   - in the REVIEWER'S authenticated session the moment they opened the
//     preview, which needs no approval at all. Any signed-in user could reach
//     it, and a reviewer's session can approve revisions.
// Proven with a real repro before the fix (all three fields fired, three
// elements injected), not inferred from reading the source.
//
// A scan of live content at the time - 33 pages, 75 combo blocks - found zero
// HTML tags in any contributor string, which is why escaping everything was
// safe: no page depended on the old behaviour.
//
// The renderer still PRODUCES markup ([M1] becomes a <kbd>, a content array
// becomes <br>-joined lines). That is the distinction these tests protect:
// generated markup survives, submitted markup does not.
const { test, expect } = require('@playwright/test');

const PAYLOAD = '<img src=x onerror="window.__PWN=(window.__PWN||0)+1">';

// Rendered through the real global on a real page, not a rewritten copy.
async function render(page, blocks) {
  return page.evaluate((b) => {
    const host = document.createElement('div');
    host.innerHTML = window.generateHTMLForBlocks(b);
    document.body.appendChild(host);
    return host.innerHTML;
  }, blocks);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'domcontentloaded' });
});

test('no block type renders submitted markup as markup', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // Every type generateHTMLForBlocks handles, each with the payload in every
  // contributor-controlled field it has.
  await render(page, [
    { type: 'heading', content: PAYLOAD, size: PAYLOAD },
    { type: 'paragraph', content: [PAYLOAD, PAYLOAD] },
    { type: 'paragraph', content: PAYLOAD },
    { type: 'list', items: [PAYLOAD, PAYLOAD] },
    { type: 'image', src: PAYLOAD, alt: PAYLOAD, caption: PAYLOAD },
    { type: 'image', src: PAYLOAD, alt: PAYLOAD },
    { type: 'callout', intent: 'tip', title: PAYLOAD, content: [PAYLOAD] },
    { type: 'table', headers: [PAYLOAD], rows: [[PAYLOAD]] },
    { type: 'video', url: PAYLOAD, caption: PAYLOAD },
    { type: 'youtube', videoId: PAYLOAD, caption: PAYLOAD },
    { type: 'accordion', title: PAYLOAD, content: [{ type: 'paragraph', content: PAYLOAD }] },
    { type: 'combo', sequence: [PAYLOAD, PAYLOAD], damage: PAYLOAD, note: PAYLOAD },
  ]);

  // Give an onerror a chance to fire before asserting it did not.
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => ({
    fired: window.__PWN || 0,
    injected: document.querySelectorAll('body > div img[src="x"]').length,
  }));

  expect(result.fired, 'no submitted markup may execute').toBe(0);
  expect(result.injected, 'no submitted markup may become an element').toBe(0);
  expect(errors).toEqual([]);
});

test('a heading cannot choose its own tag name', async ({ page }) => {
  // block.size lands in the TAG, where escaping is no defence at all - the
  // only fix is an allowlist.
  const html = await render(page, [
    { type: 'heading', content: 'Title', size: 'script src=//evil' },
    { type: 'heading', content: 'Real', size: 'h2' },
  ]);

  expect(html).not.toContain('<script');
  expect(html, 'an unrecognised size falls back to h3').toContain('<h3');
  expect(html, 'a legitimate size still works').toContain('<h2');
});

test('alignment and width cannot inject CSS', async ({ page }) => {
  // A style attribute is not an HTML text context: escaping the quotes stops
  // an attribute breakout but leaves `100%; background: url(...)` intact, so
  // these are allowlisted rather than escaped.
  const html = await render(page, [
    { type: 'paragraph', content: 'x', align: 'left; background: url(//evil)' },
    { type: 'image', src: 'a.webp', width: '100%; position: fixed; top: 0' },
    { type: 'accordion', title: 'x', align: 'right; content: url(//evil)', content: [] },
  ]);

  expect(html).not.toContain('evil');
  expect(html).not.toContain('position: fixed');
});

test('a javascript: URL never reaches a src', async ({ page }) => {
  const html = await render(page, [
    { type: 'image', src: 'javascript:alert(1)', alt: 'x' },
    { type: 'video', url: 'javascript:alert(1)' },
    // Tab and newline inside the scheme is the standard bypass for a naive
    // string comparison; browsers ignore both.
    { type: 'image', src: 'java\tscript:alert(1)', alt: 'x' },
  ]);

  expect(html.toLowerCase()).not.toContain('javascript:');
  expect(html.toLowerCase()).not.toContain('java\tscript:');
});

test('the markup the renderer generates itself still works', async ({ page }) => {
  // The other half of the claim. Escaping the input must not cost the
  // features that turn plain text into markup, or this trades one bug for
  // another that is harder to notice.
  const html = await render(page, [
    { type: 'paragraph', content: ['Press [M1] twice', 'then [SPACE]'] },
    { type: 'table', headers: ['Input'], rows: [['[M1]']] },
  ]);

  expect(html, '[M1] still becomes a keybind badge')
    .toContain('<kbd class="keybind-badge">M1</kbd>');
  expect(html, 'and inside table cells too')
    .toContain('<kbd class="keybind-badge">M1</kbd>');
  expect(html, 'a content array is still joined with line breaks').toContain('<br>');
});

test('the editor renders a hostile draft as text, not as an attribute', async ({ page }) => {
  // The reviewer-facing half. Intercepting a ticket opens the contributor's
  // content in this editor, so an attribute breakout here fires in a
  // reviewer's session. `value="${...}"` was unescaped at 24 sites.
  await page.goto('/edit.html?char=boomcat&tab=overview', { waitUntil: 'domcontentloaded' });

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  const breakout = '" onfocus="window.__PWN=1" autofocus x="';

  // Driven through initStrategyBlockBuilder - the real entry point every
  // editor surface calls. Building the <input> here with escapeHtml instead
  // was the first version of this test and it was worthless: it asserted that
  // escapeHtml works, and would have passed with editor-blocks.js untouched.
  const result = await page.evaluate((payload) => {
    const host = document.createElement('div');
    host.id = 'strategy-block-target';
    document.body.appendChild(host);

    initStrategyBlockBuilder('strategy-block-target', [
      { type: 'combo', sequence: [payload], damage: payload, note: payload, author: payload },
      { type: 'heading', content: payload, size: 'h3' },
      { type: 'image', src: payload, alt: payload, caption: payload, width: payload },
    ]);

    const inputs = Array.from(host.querySelectorAll('input[type="text"]'));
    return {
      inputCount: inputs.length,
      // Any attribute the payload manufactured would show up here.
      strayAttrs: inputs.flatMap(i => i.getAttributeNames())
        .filter(a => a === 'onfocus' || a === 'autofocus' || a === 'x'),
      // And the text itself must survive intact - escaping that mangled the
      // contributor's own draft would be its own bug.
      carriesPayload: inputs.some(i => i.value.includes('onfocus')),
    };
  }, breakout);

  await page.waitForTimeout(300);

  expect(result.inputCount, 'the builder actually rendered the blocks').toBeGreaterThan(3);
  expect(result.strayAttrs, 'the payload must not become attributes').toEqual([]);
  expect(result.carriesPayload, 'the draft text is preserved as a value').toBe(true);
  expect(await page.evaluate(() => window.__PWN || 0)).toBe(0);
  expect(errors).toEqual([]);
});

test('the combo block puts damage beside the route and the note beneath it', async ({ page }) => {
  // v0.15 item 1. Structure, not pixels: the assertion is which element
  // contains which, so it does not move with fonts or OS.
  await render(page, [{
    type: 'combo', sequence: ['M1', 'M1', '2'], damage: '76', note: 'Corner only', align: 'left',
  }]);

  const shape = await page.evaluate(() => {
    const block = document.querySelector('.combo-block');
    const route = block.querySelector('.combo-container');
    return {
      damageInRoute: !!route.querySelector('.combo-damage'),
      noteInRoute: !!route.querySelector('.combo-note'),
      noteInOwnRow: !!block.querySelector('.combo-note-row .combo-note'),
      // The note's row starts below the route's, which is the whole point.
      noteBelow: block.querySelector('.combo-note-row').getBoundingClientRect().top
        >= route.getBoundingClientRect().bottom,
      // Monospace: every step is the same width per character, so a route can
      // be read by shape.
      mono: getComputedStyle(block.querySelector('.combo-node')).fontFamily.toLowerCase(),
    };
  });

  expect(shape.damageInRoute, 'damage trails the route').toBe(true);
  expect(shape.noteInRoute, 'the note is no longer inline with the route').toBe(false);
  expect(shape.noteInOwnRow).toBe(true);
  expect(shape.noteBelow).toBe(true);
  expect(shape.mono).toMatch(/mono|courier|consolas/);
});
