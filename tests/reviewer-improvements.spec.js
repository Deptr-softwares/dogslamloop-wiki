// The three improvements the owner raised alongside the bug list. Not bugs -
// each one is friction that scales with the size of the contributor team.
const { test, expect } = require('@playwright/test');

test('contributor credit is collected once per tab, not once per section', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });

  // generateHTMLForBlocks aggregates authors, but only within one call - so a
  // tab built from several sections got a footer per section, and a nested
  // accordion got another one inside it, since the recursive call starts its
  // own author set.
  const result = await page.evaluate(() => {
    const tab = document.createElement('div');
    tab.id = 'consolidate-host';
    document.body.appendChild(tab);

    const addSection = (blocks) => {
      const s = document.createElement('div');
      s.innerHTML = window.generateHTMLForBlocks(blocks);
      tab.appendChild(s);
    };

    addSection([{ type: 'paragraph', content: 'Overview', author: 'Alice' }]);
    addSection([{ type: 'paragraph', content: 'Strategy', author: 'Alice, Bob' }]);
    addSection([
      { type: 'paragraph', content: 'Extra', author: 'Carol' },
      // An accordion recurses, so its authors used to land in a separate
      // footer nested inside the accordion body.
      { type: 'accordion', title: 'More', content: [{ type: 'paragraph', content: 'Deep', author: 'Dave' }] },
    ]);

    const before = tab.querySelectorAll('.aggregated-contributors-footer').length;

    window.consolidateTabContributors(tab);

    const footers = tab.querySelectorAll('.aggregated-contributors-footer');
    return {
      before,
      after: footers.length,
      // The single footer must be the last thing in the tab.
      isLastChild: tab.lastElementChild === footers[0],
      names: Array.from(footers[0]?.querySelectorAll('.author-badge') || []).map(b => b.textContent),
      hasTabClass: footers[0]?.classList.contains('tab-contributors-footer'),
    };
  });

  expect(result.before, 'several footers before consolidation').toBeGreaterThan(1);
  expect(result.after, 'exactly one afterwards').toBe(1);
  expect(result.isLastChild, 'and it sits at the bottom of the tab').toBe(true);
  expect(result.hasTabClass).toBe(true);

  // Deduplicated across sections, the nested accordion author is picked up,
  // and the list is sorted - a nested footer renders before its enclosing
  // section's, so document order never matched authoring order anyway.
  expect(result.names).toEqual(['Alice', 'Bob', 'Carol', 'Dave']);
});

test('consolidated contributor names are inserted as text, never as markup', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });

  const result = await page.evaluate(() => {
    const tab = document.createElement('div');
    document.body.appendChild(tab);
    const s = document.createElement('div');
    s.innerHTML = window.generateHTMLForBlocks([
      { type: 'paragraph', content: 'x', author: '<img src=x onerror="window.__tabXss=1">Mallory' },
    ]);
    tab.appendChild(s);

    window.consolidateTabContributors(tab);

    const badge = tab.querySelector('.tab-contributors-footer .author-badge');
    return {
      text: badge ? badge.textContent : null,
      injected: !!tab.querySelector('.tab-contributors-footer img'),
      xss: !!window.__tabXss,
    };
  });

  expect(result.text).toContain('Mallory');
  expect(result.injected, 'the name round-trips through textContent, not innerHTML').toBe(false);
  expect(result.xss).toBe(false);
});

test('a tab with no authors gets no empty footer', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });

  const footers = await page.evaluate(() => {
    const tab = document.createElement('div');
    document.body.appendChild(tab);
    const s = document.createElement('div');
    s.innerHTML = window.generateHTMLForBlocks([{ type: 'paragraph', content: 'No author here' }]);
    tab.appendChild(s);

    window.consolidateTabContributors(tab);
    return tab.querySelectorAll('.aggregated-contributors-footer').length;
  });

  expect(footers).toBe(0);
});

test('a moved block is marked where it lands', async ({ page }) => {
  await page.goto('/edit.html?char=testchar&tab=overview', { waitUntil: 'networkidle' });

  // A reorder previously gave no feedback beyond the list re-rendering, which
  // in a long section means hunting for the block you just moved.
  //
  // Driven with Playwright's real mouse rather than dispatched PointerEvents:
  // startBlockPointerDrag calls setPointerCapture, which throws on synthetic
  // (untrusted) pointer events - a constraint the source comments in
  // js/editor-blocks.js already call out.
  await page.evaluate(() => {
    document.body.innerHTML = '<div id="block-host"></div>';
    window.initStrategyBlockBuilder('block-host', [
      { type: 'paragraph', content: 'First' },
      { type: 'paragraph', content: 'Second' },
      { type: 'paragraph', content: 'Third' },
    ]);
  });

  await expect(page.locator('#block-list .block-card')).toHaveCount(3);

  const before = await page.locator('#block-list .block-just-moved').count();
  expect(before, 'nothing is marked before a move').toBe(0);

  const handle = page.locator('#block-list .block-card').first().locator('.drag-handle');
  const lastCard = page.locator('#block-list .block-card').last();

  // This drag is driven by real coordinates, so it can only be measured once
  // the layout has stopped moving - and it does move after the builder
  // renders. A block card holds several .editor-select elements, and
  // initializeMangaSelects (js/site_utils.js) replaces each one with a custom
  // wrapper of a different height, triggered by its own MutationObserver.
  //
  // This used to be a flat 150ms sleep, which is a guess at how long that
  // takes. It held on a fast machine and lost on a loaded CI runner: the
  // boxes were read, the selects were swapped, every card shifted, and the
  // mouse then pressed wherever the handle used to be. Waiting for two
  // consecutive identical measurements waits for the actual condition.
  const settled = async (locator, label) => {
    let previous = null;
    for (let attempt = 0; attempt < 25; attempt++) {
      const box = await locator.boundingBox();
      if (previous && box && box.y === previous.y && box.height === previous.height) return box;
      previous = box;
      await page.waitForTimeout(40);
    }
    throw new Error(`${label} never settled into a stable position`);
  };

  const handleBox = await settled(handle, 'the drag handle');
  const lastBox = await settled(lastCard, 'the last block card');
  expect(handleBox, 'the drag handle should be laid out and reachable').not.toBeNull();

  // Record the marker as it appears, instead of looking for it afterwards.
  //
  // .block-just-moved is added inside a requestAnimationFrame and removed
  // 1400ms later (js/editor-blocks.js). Reading it once after the drop means
  // racing that window: locally the machine always won, and on CI it lost -
  // the drag itself succeeded, the order assertion passed, and only the
  // marker count came back 0. An observer cannot miss it, however slow the
  // runner is.
  await page.evaluate(() => {
    window.__movedMarks = [];
    new MutationObserver(() => {
      document.querySelectorAll('#block-list .block-just-moved').forEach(card => {
        const index = card.getAttribute('data-index');
        if (!window.__movedMarks.includes(index)) window.__movedMarks.push(index);
      });
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  });

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  // Past the 6px DRAG_THRESHOLD, then into the bottom half of the last card
  // so the drop lands after it.
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 20);
  await page.mouse.move(lastBox.x + lastBox.width / 2, lastBox.y + lastBox.height - 4, { steps: 5 });
  await page.mouse.up();

  // The observer fires on a microtask after the rAF that adds the class, so
  // this waits for the record rather than assuming it is already written.
  await expect
    .poll(() => page.evaluate(() => window.__movedMarks.length), { timeout: 10000 })
    .toBe(1);

  const result = await page.evaluate(() => ({
    order: window.getActiveBlocks().map(b => b.content),
    marks: window.__movedMarks,
    lastIndex: String(window.getActiveBlocks().length - 1),
  }));

  expect(result.order, 'the block actually moved to the end').toEqual(['Second', 'Third', 'First']);
  expect(result.marks, 'exactly the block that moved is marked').toEqual([result.lastIndex]);
});

test('the staff cooldown perk is a switch the owner can see and flip', async ({ page }) => {
  await page.goto('/owner.html', { waitUntil: 'networkidle' });

  // The toggle changes what the database enforces (the trigger in
  // 20260810000000_staff_cooldown_perk.sql reads this row on every insert),
  // not just what the editor shows - so it has to round-trip to site_settings.
  const result = await page.evaluate(async () => {
    document.body.innerHTML = `
      <section id="tool-staff-perks">
        <input type="checkbox" id="perk-cooldown-bypass">
        <div id="staff-perks-results"></div>
      </section>
    `;

    const state = { row: { staff_bypass_submission_cooldown: true }, upserted: null };
    window.supabaseClient = {
      from(table) {
        if (table !== 'site_settings') throw new Error('unexpected table: ' + table);
        return {
          select() { return this; },
          maybeSingle: async () => ({ data: state.row, error: null }),
          upsert: async (rows) => { state.upserted = rows[0]; return { error: null }; },
        };
      },
    };

    await window.loadStaffPerks();
    const loadedChecked = document.getElementById('perk-cooldown-bypass').checked;

    // Flip it off the way the owner would.
    const box = document.getElementById('perk-cooldown-bypass');
    box.checked = false;
    await window.saveStaffPerk(false);

    return {
      loadedChecked,
      upserted: state.upserted,
      message: document.getElementById('staff-perks-results').textContent,
    };
  });

  expect(result.loadedChecked, 'the current setting is reflected on load').toBe(true);
  expect(result.upserted.staff_bypass_submission_cooldown).toBe(false);
  expect(result.upserted.id, 'upsert targets the singleton row').toBe(true);
  expect(result.message).toContain('everyone');
});

test('a failed perk save puts the checkbox back rather than lying about the state', async ({ page }) => {
  await page.goto('/owner.html', { waitUntil: 'networkidle' });

  // Leaving the box showing a state the database rejected is how someone ends
  // up believing a rate limit is off when it is on.
  const result = await page.evaluate(async () => {
    document.body.innerHTML = `
      <input type="checkbox" id="perk-cooldown-bypass" checked>
      <div id="staff-perks-results"></div>
    `;
    window.supabaseClient = {
      from() {
        return { upsert: async () => ({ error: { message: 'permission denied' } }) };
      },
    };

    document.getElementById('perk-cooldown-bypass').checked = false;
    await window.saveStaffPerk(false);

    return {
      checked: document.getElementById('perk-cooldown-bypass').checked,
      message: document.getElementById('staff-perks-results').textContent,
    };
  });

  expect(result.checked, 'reverted to what the database still holds').toBe(true);
  expect(result.message).toContain('permission denied');
});
