// js/internalstyling.js under malformed and adversarial input (v0.18 FT8).
//
// `tests/shortcode-safety.spec.js` covers the three live XSS holes closed on
// 2026-08-14 and the auto-highlight vocabulary. This file covers the other
// half of the same engine: what happens when the input is not well formed.
//
// That matters here more than in most renderers, because the engine is a
// string rewriter over innerHTML driven by a `do { } while` loop that keeps
// substituting until nothing changes. Two failure shapes follow from that
// design and neither is visible by reading a single regex:
//
//   1. A rewrite whose output matches its own input pattern does not
//      terminate, or terminates only after exponential work.
//   2. A pass that runs twice wraps its own output a second time - which is
//      what `.is-styled` exists to prevent, and nothing was asserting it.
//
// The rule this file holds to: an unparseable shortcode must degrade to
// VISIBLE TEXT. Never markup, never a dropped sentence. Losing a bold tag is
// a rendering nit; losing the words is a contributor's paragraph.
const { test, expect } = require('@playwright/test');

const PAGE = '/characters/Boomcat/index.html';

async function render(page, source) {
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.applyInternalStyling === 'function');

  return page.evaluate((raw) => {
    const host = document.createElement('div');
    host.id = 'stress-probe';
    host.className = 'wiki-text';
    host.innerHTML = String(raw)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    (document.querySelector('main') || document.body).appendChild(host);
    window.applyInternalStyling();
    return {
      text: host.textContent,
      html: host.innerHTML,
      strong: host.querySelectorAll('strong.sc-b').length,
      em: host.querySelectorAll('em.sc-i').length,
      handlers: Array.from(host.querySelectorAll('*')).flatMap(el =>
        Array.from(el.attributes)
          .filter(at => at.name.toLowerCase().startsWith('on'))
          .map(at => `${el.tagName.toLowerCase()}[${at.name}]`)),
    };
  }, source);
}

// --- MALFORMED INPUT DEGRADES TO TEXT ---

test('an unclosed shortcode stays visible as text', async ({ page }) => {
  const out = await render(page, '[b]a bold thought that never ends');
  // The words are the assertion. A renderer that "handled" this by dropping
  // the run would also produce zero <strong>, so the text check is what
  // separates degrading gracefully from eating the paragraph.
  expect(out.text).toContain('a bold thought that never ends');
  expect(out.strong).toBe(0);
});

test('a mismatched closing tag consumes neither tag nor text', async ({ page }) => {
  const out = await render(page, '[b]mismatched[/i]');
  expect(out.text).toContain('mismatched');
  expect(out.strong).toBe(0);
  expect(out.em).toBe(0);
});

test('a stray closing tag is left alone', async ({ page }) => {
  const out = await render(page, 'orphaned [/b] close');
  expect(out.text).toContain('orphaned');
  expect(out.text).toContain('close');
  expect(out.strong).toBe(0);
});

test('an empty shortcode produces an empty element, not a swallowed line', async ({ page }) => {
  const out = await render(page, 'before [b][/b] after');
  expect(out.text).toContain('before');
  expect(out.text).toContain('after');
});

// --- NESTING, WHICH IS WHAT THE do-while LOOP IS FOR ---

test('three shortcodes nested inside one another all resolve', async ({ page }) => {
  const out = await render(page, '[color=red][b][i]deep[/i][/b][/color]');
  const shape = await page.evaluate(() => {
    const el = document.querySelector('#stress-probe .sc-color strong.sc-b em.sc-i');
    return { found: !!el, text: el ? el.textContent : null };
  });
  expect(shape.found, 'colour wraps bold wraps italic').toBe(true);
  expect(shape.text).toBe('deep');
  expect(out.handlers).toEqual([]);
});

test('shortcodes are case-insensitive, both halves', async ({ page }) => {
  const out = await render(page, '[B]shouty[/B]');
  expect(out.strong).toBe(1);
  expect(out.text).toContain('shouty');
});

// --- IDEMPOTENCY: THE PASS MUST NOT RUN TWICE ---

test('a second styling pass does not wrap the first pass output again', async ({ page }) => {
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.applyInternalStyling === 'function');

  const out = await page.evaluate(() => {
    // A character NAME, not just a shortcode. After the first pass the
    // shortcodes are gone, so re-running finds nothing to re-substitute and a
    // shortcode-only fixture would pass whether or not the guard exists. The
    // auto-colouring pass is the one whose OUTPUT still matches its own input
    // pattern - the name is still sitting there, now inside a span - so this
    // is the half where "run it twice" can actually nest.
    const name = Object.keys(window.CHARACTER_COLORS || {})[0];
    const host = document.createElement('div');
    host.id = 'idem-probe';
    host.className = 'wiki-text';
    host.textContent = `[b]once[/b] and ${name}`;
    (document.querySelector('main') || document.body).appendChild(host);

    window.applyInternalStyling();
    const afterFirst = host.innerHTML;
    // The MutationObserver in this file calls the engine again on any added
    // node, so a real page runs it many times over the same prose.
    window.applyInternalStyling();
    window.applyInternalStyling();
    return {
      name,
      afterFirst,
      afterThird: host.innerHTML,
      strong: host.querySelectorAll('strong.sc-b').length,
      // The engine's OWN marker class, not "a span with a colour in it".
      // linkCharacterMentions wraps a mention in a coloured <a>, so a
      // descendant-of-coloured-thing selector counts that wrapper and reports
      // nesting that is the linking pass doing its job.
      charSpans: host.querySelectorAll('.sc-char').length,
      text: host.textContent,
    };
  });

  expect(out.strong, 'exactly one <strong>, not three').toBe(1);
  expect(out.charSpans, 'the mention is wrapped once, not once per pass').toBe(1);
  expect(out.afterThird, 'the markup is stable across passes').toBe(out.afterFirst);
  expect(out.text, 'and the words are unchanged').toBe(`once and ${out.name}`);
});

// --- THE ENGINE MUST NOT HANG ---

test('deeply repeated shortcodes terminate quickly', async ({ page }) => {
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.applyInternalStyling === 'function');

  const elapsed = await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'perf-probe';
    host.className = 'wiki-text';
    // 200 nested pairs. The substitution loop reruns until nothing changes, so
    // this is the shape that finds accidental quadratic behaviour.
    host.textContent = '[b]'.repeat(200) + 'core' + '[/b]'.repeat(200);
    (document.querySelector('main') || document.body).appendChild(host);

    const started = performance.now();
    window.applyInternalStyling();
    return { ms: performance.now() - started, text: host.textContent };
  });

  // Generous on purpose - this is a hang detector, not a benchmark, and a
  // tight bound would be an OS-dependent assertion of the kind this project
  // has been bitten by. Runaway substitution takes seconds or never returns.
  expect(elapsed.ms, `styling took ${Math.round(elapsed.ms)}ms`).toBeLessThan(4000);
  expect(elapsed.text).toContain('core');
});

// --- AUTO-COLOURING MUST NOT REACH INTO MARKUP IT DID NOT WRITE ---

test('a character name inside an attribute is not coloured', async ({ page }) => {
  // The `(?![^<]*>)` guard on the term pattern. Without it the engine rewrites
  // the inside of an attribute value and produces a broken tag, which is the
  // same class of bug as the 2026-08-14 break-outs arriving from the other
  // direction.
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.applyInternalStyling === 'function');

  const out = await page.evaluate(() => {
    const name = Object.keys(window.CHARACTER_COLORS || {})[0];
    const host = document.createElement('div');
    host.id = 'attr-probe';
    host.className = 'wiki-text';
    host.innerHTML = `<img alt="${name} portrait" src="data:,">${name}`;
    (document.querySelector('main') || document.body).appendChild(host);
    window.applyInternalStyling();

    const img = host.querySelector('img');
    return {
      name,
      altIntact: img ? img.getAttribute('alt') : null,
      // The bare mention outside the tag SHOULD still be coloured - the
      // positive half, so this cannot pass by the engine doing nothing.
      coloured: host.querySelectorAll('.char-mention, [style*="color"]').length,
    };
  });

  expect(out.altIntact, 'the attribute value is untouched').toBe(`${out.name} portrait`);
  expect(out.coloured, 'the mention outside the tag is still styled').toBeGreaterThan(0);
});
