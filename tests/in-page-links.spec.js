// In-page section links - v0.15 item 5.
//
// The devlog's premise for this item was that "the ToC already resolves these
// targets". It did not, in three separate ways, and each one is a test here:
//
//   1. Anchor ids were POSITIONAL - `toc-<slug>-<index>`, where index was the
//      heading's place in the active tab. Insert a section above the target and
//      every id below it changed, so a stored link rotted silently.
//   2. Only the ACTIVE tab's headings were given ids at all, so a link from
//      Skills into Overview pointed at an element with no id - which is exactly
//      the case this feature exists for.
//   3. Nothing on the site read location.hash, so a pasted link landed at the
//      top of the page.
//
// Tests assert the rendered consequence - the tab that ends up visible, the
// element the browser actually scrolled to - rather than that a class or an
// attribute was set. A class that is set and then overridden is the failure
// this suite has already shipped once.
const { test, expect } = require('@playwright/test');

const PAGE = '/characters/Boomcat/index.html';

// Names no owner-authored section uses, because this page carries real content
// and a test that reads it is testing the owner's writing, not the code.
const A = 'Zzq Alpha Section';
const B = 'Zzq Beta Section';
const C = 'Zzq Gamma Section';

test('an id survives a section being inserted above it', async ({ page }) => {
  await page.goto(PAGE, { waitUntil: 'networkidle' });

  const ids = await page.evaluate(([a, b, c]) => {
    // Two FRESH renders, not one container mutated - which is what actually
    // happens on this site. A tab switch, a mode switch and the editor preview
    // all rebuild the DOM from scratch, so the question is whether the same
    // content yields the same id, not whether an id already set is left alone.
    const render = (titles) => {
      document.querySelectorAll('.zzq-host').forEach(n => n.remove());
      const host = document.createElement('div');
      host.className = 'zzq-host';
      host.innerHTML = titles.map(t => `<h2 class="section-title">${t}</h2>`).join('');
      document.querySelector('.main-content-area').appendChild(host);
      window.assignSectionAnchors();
      const out = {};
      host.querySelectorAll('.section-title').forEach(h => { out[h.textContent] = h.id; });
      return out;
    };

    const before = render([a, b]);
    const after = render([c, a, b]);   // c inserted ABOVE both
    return { before, after };
  }, [A, B, C]);

  expect(ids.before[A]).toBeTruthy();
  expect(ids.after[A]).toBe(ids.before[A]);
  expect(ids.after[B]).toBe(ids.before[B]);
});

test('headings in a tab that is not open still get ids', async ({ page }) => {
  await page.goto(PAGE, { waitUntil: 'networkidle' });

  const result = await page.evaluate((title) => {
    const hidden = document.querySelector('[id^="tab-"].hidden');
    if (!hidden) return { skipped: true };

    const h = document.createElement('h2');
    h.className = 'section-title';
    h.textContent = title;
    hidden.appendChild(h);

    window.assignSectionAnchors();
    return { skipped: false, id: h.id, panelHidden: hidden.classList.contains('hidden') };
  }, A);

  expect(result.skipped, 'the page should have more than one tab').toBe(false);
  // Still hidden - the ids are assigned without opening anything.
  expect(result.panelHidden).toBe(true);
  expect(result.id).toBe('sec-zzq-alpha-section');
});

test('clicking a link opens the target tab and lands on the section', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(PAGE, { waitUntil: 'networkidle' });

  const setup = await page.evaluate((title) => {
    const panels = [...document.querySelectorAll('[id^="tab-"]')];
    const open = panels.find(p => !p.classList.contains('hidden'));
    const shut = panels.find(p => p.classList.contains('hidden'));
    if (!open || !shut) return { skipped: true };

    // The target, in the tab that is closed.
    const h = document.createElement('h2');
    h.className = 'section-title';
    h.textContent = title;
    shut.appendChild(h);
    // Height on BOTH sides. Above, so there is somewhere to scroll from;
    // below, so the browser can actually put the heading at the top instead of
    // clamping at the end of the document and landing short.
    const above = document.createElement('div');
    above.style.height = '2500px';
    shut.insertBefore(above, h);
    const below = document.createElement('div');
    below.style.height = '2500px';
    shut.appendChild(below);

    window.assignSectionAnchors();

    // The link, in the tab that is open - written the way a contributor
    // writes it, then put through the real shortcode pass.
    const p = document.createElement('p');
    p.className = 'wiki-text';
    p.textContent = `[url=#${h.id}]Go there[/url]`;
    open.appendChild(p);
    window.applyInternalStyling();

    return { skipped: false, targetId: h.id, targetTab: shut.id, openTab: open.id };
  }, A);

  expect(setup.skipped).toBe(false);

  const link = page.locator('a.wiki-link-jump', { hasText: 'Go there' });
  await expect(link).toBeVisible();
  // An in-page link must not open a second copy of the page.
  await expect(link).not.toHaveAttribute('target', '_blank');

  await link.click();

  const after = await page.evaluate(async (s) => {
    // Settled rather than slept past. This is a real content page, so images
    // and late renders keep shifting layout underneath a smooth scroll - a
    // fixed wait measures whatever moment it happens to land on, which is how
    // this read 166 on one run and -11 on the next.
    // Requires movement AND two consecutive stable reads. A single stable read
    // against a sentinel exits before the scroll has begun, which is the shape
    // of flake that only appears when the workers are competing for CPU.
    let last = Number.NEGATIVE_INFINITY;
    let stable = 0;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 100));
      const y = window.scrollY;
      if (y > 0 && Math.abs(y - last) < 2) {
        if (++stable >= 2) break;
      } else {
        stable = 0;
      }
      last = y;
    }
    return {
      targetTabHidden: document.getElementById(s.targetTab).classList.contains('hidden'),
      sourceTabHidden: document.getElementById(s.openTab).classList.contains('hidden'),
      scrollY: Math.round(window.scrollY),
      // Where the target actually ended up relative to the viewport - the
      // consequence, rather than the fact that scrollTo was called.
      targetTop: Math.round(document.getElementById(s.targetId).getBoundingClientRect().top),
      viewport: window.innerHeight,
    };
  }, setup);

  expect(after.targetTabHidden, 'the target tab should have been opened').toBe(false);
  expect(after.sourceTabHidden).toBe(true);
  expect(after.scrollY).toBeGreaterThan(100);
  // Aiming for 40px of breathing room above the heading. Asserted as "landed
  // on the section, near the top of the viewport" rather than to the pixel:
  // the page is over 5000px tall here, so this is still a precise claim.
  expect(after.targetTop).toBeGreaterThan(-120);
  expect(after.targetTop).toBeLessThan(after.viewport / 2);
  expect(errors).toEqual([]);
});

test('a link arrived at by URL hash resolves after the content loads', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // The section has to already exist on the page for this to be honest, so it
  // uses one of the character's own - read from the page rather than assumed,
  // because pinning a test to owner content is how regeneration broke before.
  await page.goto(PAGE, { waitUntil: 'networkidle' });
  const probe = await page.evaluate(() => {
    window.assignSectionAnchors();
    const els = [...document.querySelectorAll('.main-content-area [id^="sec-"]')];
    // Far enough down that resolving it has to move the page.
    const deep = els.filter(el => el.getBoundingClientRect().top + window.scrollY > 400);
    return deep.length ? deep[deep.length - 1].id : null;
  });
  test.skip(!probe, 'this character page has no section far enough down to test with');

  await page.goto(`${PAGE}#${probe}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const scrolled = await page.evaluate(() => Math.round(window.scrollY));
  expect(scrolled, 'a pasted section link should land on the section').toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test('links written before ids were stable still resolve', async ({ page }) => {
  await page.goto(PAGE, { waitUntil: 'networkidle' });

  const ok = await page.evaluate((title) => {
    const host = document.createElement('div');
    host.innerHTML = `<h2 class="section-title">${title}</h2>`;
    document.querySelector('.main-content-area').appendChild(host);
    window.assignSectionAnchors();

    return {
      // The old positional form, as copied out of the address bar.
      legacy: window.jumpToAnchor('#toc-zzq-alpha-section-7', { updateHash: false }),
      // And what somebody types before they find the picker.
      typed: window.jumpToAnchor('#Zzq Alpha Section', { updateHash: false }),
      missing: window.jumpToAnchor('#sec-nothing-is-called-this', { updateHash: false }),
    };
  }, A);

  expect(ok.legacy).toBe(true);
  expect(ok.typed).toBe(true);
  // A link to a section that no longer exists does nothing, rather than throwing.
  expect(ok.missing).toBe(false);
});

test('a target inside a closed accordion is opened first', async ({ page }) => {
  await page.goto(PAGE, { waitUntil: 'networkidle' });

  const state = await page.evaluate((title) => {
    const host = document.createElement('div');
    host.innerHTML = `
      <details class="manga-accordion">
        <summary>Hidden away</summary>
        <div class="wiki-accordion-body"><h3 class="wiki-block-heading">${title}</h3></div>
      </details>`;
    document.querySelector('.main-content-area').appendChild(host);
    window.assignSectionAnchors();

    const details = host.querySelector('details');
    const before = details.open;
    const jumped = window.jumpToAnchor('#sec-zzq-alpha-section', { updateHash: false });
    return { before, jumped, after: details.open };
  }, A);

  expect(state.before).toBe(false);
  expect(state.jumped).toBe(true);
  expect(state.after, 'scrolling to a heading inside a closed accordion lands on nothing').toBe(true);
});

// --- THE AUTHORING SIDE ---
//
// The list has to come from desc_data, not the preview: the editor renders
// only the tab being edited, so a DOM-derived picker could offer links within
// the current tab and nowhere else.

test('the picker offers sections from tabs other than the one being edited', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto('/edit.html?char=boomcat&type=character&tab=combos', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const targets = await page.evaluate(() => {
    const data = window.currentEditorDescData || window.editorMasterDescData || {};
    const frame = window.currentEditorFrameData || window.editorMasterFrameData || {};
    const all = window.collectSectionTargets(data, frame);
    const flat = all.concat(...all.map(t => t.children || []));
    return {
      total: flat.length,
      tabs: [...new Set(all.map(t => t.tab))],
      // Every entry needs all three, or the picker cannot render a row.
      malformed: all.filter(t => !t.id || !t.title || !t.tabLabel).length,
      // Nothing should be offered twice under the same id.
      duplicateIds: flat.length - new Set(flat.map(t => t.id)).size,
    };
  });

  expect(targets.total, 'the character has sections to link to').toBeGreaterThan(0);
  expect(targets.malformed).toBe(0);
  expect(targets.duplicateIds).toBe(0);
  // The tab open in the editor is `combos`; a picker that only saw the preview
  // could offer nothing else.
  expect(targets.tabs.length, 'sections should come from more than the open tab').toBeGreaterThan(1);
  expect(errors).toEqual([]);
});

test('moves are linkable - M1s, Skills and Specials', async ({ page }) => {
  // These live in frame_data, not desc_data, so the first version of the
  // picker offered none of them. On a fighting-game wiki that is most of what
  // anyone would want to link to.
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto('/edit.html?char=boomcat&type=character&tab=skills', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => typeof window.collectSectionTargets === 'function', { timeout: 15000 });
  await page.waitForTimeout(1200);

  const moves = await page.evaluate(() => {
    const data = window.currentEditorDescData || window.editorMasterDescData || {};
    const frame = window.currentEditorFrameData || window.editorMasterFrameData || {};
    const all = window.collectSectionTargets(data, frame);
    const cats = window.FRAME_MOVE_CATEGORIES;
    // What the frame data says exists, against what the picker offers.
    const expected = {};
    cats.forEach(c => {
      expected[c] = (Array.isArray(frame[c]) ? frame[c] : []).map(m => m && m.name).filter(Boolean);
    });
    const offered = {};
    cats.forEach(c => { offered[c] = all.filter(t => t.tab === c).map(t => t.title); });
    return { expected, offered, cats };
  });

  const withMoves = moves.cats.filter(c => moves.expected[c].length);
  expect(withMoves.length, 'Boomcat should have frame-data moves to link to').toBeGreaterThan(0);
  withMoves.forEach(cat => {
    // Every move, in frame-data order - a move card is titled with its name.
    expect(moves.offered[cat], `${cat} moves should all be offered`)
      .toEqual(expect.arrayContaining(moves.expected[cat]));
  });
});

test('the picker nests sub-headings under their section, like the ToC', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto('/edit.html?char=boomcat&type=character&tab=overview', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  await page.locator('#btn-format-jump').click();
  await page.locator('.format-jump-item').first().waitFor({ timeout: 5000 });

  const toggle = page.locator('.format-jump-toggle').first();
  const hasNesting = await toggle.count();
  test.skip(!hasNesting, 'this character has no section with sub-headings yet');

  // Collapsed by default: a filled-in page has well over a hundred headings,
  // and the picker is for finding one, not reading through them.
  const children = page.locator('.format-jump-children').first();
  await expect(children).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await toggle.click();
  await expect(children).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  // And a sub-heading is pickable, not just visible.
  const minor = children.locator('.format-jump-item-minor').first();
  await expect(minor).toBeVisible();
});

test('searching a sub-heading surfaces it, expanded', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto('/edit.html?char=boomcat&type=character&tab=overview', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  await page.locator('#btn-format-jump').click();
  await page.locator('.format-jump-item').first().waitFor({ timeout: 5000 });

  const child = await page.evaluate(() => {
    const el = document.querySelector('.format-jump-children .format-jump-item-minor');
    return el ? el.getAttribute('data-title') : null;
  });
  test.skip(!child, 'this character has no sub-headings yet');

  await page.locator('#format-jump-search').fill(child);
  // Collapsing the only match would hide the thing the search just found.
  const found = page.locator('.format-jump-item-minor', { hasText: child }).first();
  await expect(found).toBeVisible();
});

test('picking a section writes a link, and it points at something real', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto('/edit.html?char=boomcat&type=character&tab=overview', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // Focus a real block input first - the toolbar wraps the last focused field,
  // and with none it has nowhere to write.
  const input = page.locator('#strategy-block-target textarea, #strategy-block-target input[type="text"]').first();
  await input.waitFor({ timeout: 10000 });
  await input.click();

  await page.locator('#btn-format-jump').click();
  const items = page.locator('.format-jump-item');
  await items.first().waitFor({ timeout: 5000 });

  const chosen = await items.first().evaluate(el => ({
    anchor: el.getAttribute('data-anchor'),
    title: el.getAttribute('data-title'),
  }));
  await items.first().click();

  const written = await input.inputValue();
  // Nothing was highlighted, so the section's own name becomes the link text -
  // an empty [url=#x][/url] renders as a link the reader cannot see or click.
  expect(written).toContain(`[url=#${chosen.anchor}]${chosen.title}[/url]`);

  // And the id it wrote is one the reader-facing page actually renders. This
  // is the assertion that matters: the picker derives ids from data and the
  // page derives them from the DOM, so the two could agree in shape and still
  // disagree in fact.
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const resolves = await page.evaluate((id) => {
    window.assignSectionAnchors();
    return window.jumpToAnchor(`#${id}`, { updateHash: false });
  }, chosen.anchor);

  expect(resolves, `the picker offered ${chosen.anchor}, which the page does not render`).toBe(true);
  expect(errors).toEqual([]);
});

test('every section the picker offers exists on the rendered page', async ({ page }) => {
  // The one that would catch a real drift. The picker derives ids from
  // desc_data and the page derives them from the DOM; checking a single
  // entry only proves the two agree about the easiest case.
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto('/edit.html?char=boomcat&type=character&tab=overview', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const offered = await page.evaluate(() => {
    const data = window.currentEditorDescData || window.editorMasterDescData || {};
    const frame = window.currentEditorFrameData || window.editorMasterFrameData || {};
    const all = window.collectSectionTargets(data, frame);
    return all.concat(...all.map(t => t.children || []))
      .map(t => ({ id: t.id, title: t.title }));
  });
  expect(offered.length).toBeGreaterThan(0);

  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const compared = await page.evaluate((list) => {
    window.assignSectionAnchors();
    const onPage = [...document.querySelectorAll('.main-content-area [id^="sec-"]')].map(el => el.id);
    return {
      // Offered but not rendered: a link that silently does nothing.
      unresolved: list.filter(t => !document.getElementById(t.id)),
      // Rendered but never offered: a section nobody can link to. This is the
      // direction that hid M1s, Skills and Specials - the picker was internally
      // consistent and simply had no idea they existed.
      unoffered: onPage.filter(id => !list.some(t => t.id === id)),
    };
  }, offered);

  expect(compared.unresolved, 'a picker entry that resolves to nothing is a link that silently does nothing')
    .toEqual([]);
  expect(compared.unoffered, 'a section on the page that the picker never offers cannot be linked to')
    .toEqual([]);
});

test('the search narrows the list', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto('/edit.html?char=boomcat&type=character&tab=overview', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  await page.locator('#btn-format-jump').click();
  await page.locator('.format-jump-item').first().waitFor({ timeout: 5000 });

  const before = await page.locator('.format-jump-item').count();
  await page.locator('#format-jump-search').fill('zzzz-no-such-section');
  await expect(page.locator('.format-jump-empty')).toBeVisible();

  await page.locator('#format-jump-search').fill('');
  await expect(page.locator('.format-jump-item')).toHaveCount(before);
});

test('the ToC uses the same ids the links do', async ({ page }) => {
  await page.goto(PAGE, { waitUntil: 'networkidle' });
  // Waited for rather than slept past. The ToC is built on a delay that differs
  // by page type, so a fixed timeout races it and reports a vacuous skip on the
  // slow side instead of a failure.
  await page.locator('#dynamic-toc a[href^="#"]').first().waitFor({ timeout: 10000 });

  const agree = await page.evaluate(() => {
    const links = [...document.querySelectorAll('#dynamic-toc a[href^="#"]')];
    // Every ToC entry must point at something that exists, and at the stable
    // form - the two used to be minted separately and could drift apart.
    const broken = links
      .map(a => a.getAttribute('href').slice(1))
      .filter(id => !document.getElementById(id));
    const positional = links.filter(a => /^#toc-.+-\d+$/.test(a.getAttribute('href')));
    return { count: links.length, broken, positional: positional.length };
  });

  expect(agree.count).toBeGreaterThan(0);
  expect(agree.broken).toEqual([]);
  expect(agree.positional, 'the ToC should no longer mint positional ids').toBe(0);
});
