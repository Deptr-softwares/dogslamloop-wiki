// Reordering a strip moves each entry's text with it (editor QA note,
// 2026-10-23): "the text in a certain character's information box is copy and
// pasted into any other character's information box that it passes over when
// adjusting the order".
//
// The open entry's blocks live in a buffer, and each loader writes that buffer
// back to the entry the selection names before it opens another. The reorder
// bar changed the array under the selection, so the write-back landed on
// whichever entry had slid into the old slot. Every pass copied the moved text
// over a neighbour, and an insert saved the new, empty entry's buffer over the
// old last one. The tests in reorder-sections.spec.js all used empty content,
// so none of them could see it.
//
// Each test seeds its own entries with the selection cleared, so nothing here
// reads what the owner has written on Boomcat.
const { test, expect } = require('@playwright/test');

const text = (t) => ({ type: 'paragraph', content: t, align: 'left' });
const NAMES = ['Alpha', 'Beta', 'Gamma'];

// The three strips that open an entry into the shared block buffer.
const STRIPS = [
  {
    tab: 'matchups',
    seed: () => {
      window.currentMatchupIndex = undefined;
      window.currentEditorDescData.matchups = ['Alpha', 'Beta', 'Gamma']
        .map(n => ({ opponent: `Zzq ${n}`, tier: 'even', content: [{ type: 'paragraph', content: `${n} text`, align: 'left' }] }));
    },
    read: () => window.currentEditorDescData.matchups.map(m => [m.opponent, m.content]),
    nav: (i) => `#matchup-nav-${i}`,
  },
  {
    tab: 'counterplay',
    seed: () => {
      window.currentKeyedIndex = {};
      const s = window.getKeyedSectionByTab('counterplay');
      window.currentEditorDescData[s.field] = ['Alpha', 'Beta', 'Gamma']
        .map(n => ({ [s.keyField]: `Zzq ${n}`, content: [{ type: 'paragraph', content: `${n} text`, align: 'left' }], author: '' }));
    },
    read: () => {
      const s = window.getKeyedSectionByTab('counterplay');
      return window.currentEditorDescData[s.field].map(e => [e[s.keyField], e.content]);
    },
    nav: (i) => `#counterplay-nav-${i}`,
  },
  {
    tab: 'overview',
    seed: () => {
      window.currentOverviewSection = null;
      window.currentEditorDescData.extras = ['Alpha', 'Beta', 'Gamma']
        .map(n => ({ title: `Zzq ${n}`, content: [{ type: 'paragraph', content: `${n} text`, align: 'left' }] }));
    },
    read: () => window.currentEditorDescData.extras.map(e => [e.title, e.content]),
    nav: (i) => `#overview-nav-extra-${i}`,
  },
];

async function open(page, strip) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    try {
      localStorage.setItem('dsl_editor_tutorial_seen', '1');
      localStorage.setItem('dsl_notice_seen_editor', '1');
    } catch (e) { /* ignore */ }
  });
  await page.goto(`/edit.html?char=boomcat&type=character&tab=${strip.tab}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.moveListItem === 'function'
    && typeof initFullTabEditor === 'function' && !!window.currentEditorDescData, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.evaluate(({ seed, tab }) => {
    // eslint-disable-next-line no-new-func
    new Function(`(${seed})()`)();
    initFullTabEditor('boomcat', tab, window.currentEditorDescData, window.currentEditorFrameData);
  }, { seed: strip.seed.toString(), tab: strip.tab });
  await page.waitForTimeout(500);
  return errors;
}

// Name -> its text, read after a sync, which is what Submit sends.
async function textByName(page, strip) {
  const rows = await page.evaluate(async (read) => {
    await window.triggerManualSync();
    // eslint-disable-next-line no-new-func
    return new Function(`return (${read})()`)();
  }, strip.read.toString());
  return Object.fromEntries(rows.map(([name, content]) =>
    [String(name).replace('Zzq ', ''), (content || []).map(b => b.content).join(' | ')]));
}

const moveRight = (page) => page.locator('.daw-reorder-group .daw-tab-move-btn').nth(1);

for (const strip of STRIPS) {
  test(`moving a ${strip.tab} entry takes its text along, and the ones it passes keep theirs`, async ({ page }) => {
    const errors = await open(page, strip);

    await page.locator(strip.nav(0)).click();
    await page.waitForTimeout(400);
    await moveRight(page).click();
    await page.waitForTimeout(500);
    await moveRight(page).click();
    await page.waitForTimeout(500);

    expect(await textByName(page, strip)).toEqual({ Alpha: 'Alpha text', Beta: 'Beta text', Gamma: 'Gamma text' });
    expect(errors).toEqual([]);
  });
}

// A group's buffer is its open card's write-up, flushed into the open group by
// position, so a group move had the same fault one level down.
test('moving a Combos group takes its open card\'s write-up along', async ({ page }) => {
  const combos = {
    tab: 'combos',
    seed: () => {
      window.currentDocSection = null;
      window.currentDocCardIndex = undefined;
      const g = window.getDocumentSections('combos').groups;
      window.currentEditorDescData[g.field] = ['Alpha', 'Beta', 'Gamma'].map(n => ({
        [g.keyField]: `Zzq ${n}`,
        content: [{ type: 'theorybox', title: `${n} card`, sequence: [], content: [{ type: 'paragraph', content: `${n} text`, align: 'left' }] }],
      }));
    },
    read: () => {
      const g = window.getDocumentSections('combos').groups;
      return window.currentEditorDescData[g.field].map(grp => [grp[g.keyField], (grp.content[0] || {}).content]);
    },
  };
  const errors = await open(page, combos);

  await page.locator('#combos-nav-group-0').click();
  await page.waitForTimeout(400);
  await page.locator('[data-card="0"]').click();
  await page.waitForTimeout(400);
  const groupBar = page.locator('.daw-reorder-group[data-reorder-list$="comboGroups"] .daw-tab-move-btn').nth(1);
  await groupBar.click();
  await page.waitForTimeout(500);
  await groupBar.click();
  await page.waitForTimeout(500);

  expect(await textByName(page, combos)).toEqual({ Alpha: 'Alpha text', Beta: 'Beta text', Gamma: 'Gamma text' });
  expect(errors).toEqual([]);
});

test('text typed just before a move goes with the matchup that was moved', async ({ page }) => {
  const errors = await open(page, STRIPS[0]);

  await page.locator('#matchup-nav-0').click();
  await page.waitForTimeout(400);
  await page.locator('#block-list .block-card').first().locator('textarea.editor-textarea').fill('Alpha edited');
  // At once: the move must not wait for the typing to be synced on its own.
  await moveRight(page).click();
  await page.waitForTimeout(500);

  const order = await page.evaluate(() => window.currentEditorDescData.matchups.map(m => m.opponent));
  expect(order).toEqual(['Zzq Beta', 'Zzq Alpha', 'Zzq Gamma']);
  expect(await textByName(page, STRIPS[0])).toEqual({ Alpha: 'Alpha edited', Beta: 'Beta text', Gamma: 'Gamma text' });
  expect(errors).toEqual([]);
});

// Deleting changes the array under the selection too. Counterplay, groups,
// cards and Combo Lists already forgot their selection on a delete; matchups
// and custom Overview sections did not, so the open one's text was saved over
// whichever entry slid into its slot.
async function deleteEntry(page, removeBtn) {
  await page.locator(removeBtn).click();
  await page.waitForTimeout(300);
  await page.locator('#editor-modal-confirm').click();
  await page.waitForTimeout(600);
}

test('deleting a matchup before the open one leaves every other matchup its own text', async ({ page }) => {
  const errors = await open(page, STRIPS[0]);
  await page.locator('#matchup-nav-1').click();
  await page.waitForTimeout(400);

  await deleteEntry(page, '#matchup-nav-0 + .daw-tab-remove-btn');

  expect(await textByName(page, STRIPS[0])).toEqual({ Beta: 'Beta text', Gamma: 'Gamma text' });
  expect(errors).toEqual([]);
});

for (const [open_, removed, left] of [
  [1, 0, { Beta: 'Beta text', Gamma: 'Gamma text' }],
  // The open one, and the last: its slot is gone, so a stale write-back throws.
  [2, 2, { Alpha: 'Alpha text', Beta: 'Beta text' }],
]) {
  test(`deleting custom section ${removed + 1} with section ${open_ + 1} open leaves the others their own text`, async ({ page }) => {
    const errors = await open(page, STRIPS[2]);
    await page.locator(`#overview-nav-extra-${open_}`).click();
    await page.waitForTimeout(400);

    await deleteEntry(page, `#overview-nav-extra-${removed} ~ .daw-tab-remove-btn`);

    expect(await textByName(page, STRIPS[2])).toEqual(left);
    expect(errors).toEqual([]);
  });
}

test('inserting after the open matchup leaves every other matchup its own text', async ({ page }) => {
  const errors = await open(page, STRIPS[0]);

  await page.locator('#matchup-nav-0').click();
  await page.waitForTimeout(400);
  await page.locator('.daw-reorder-group .daw-tab-insert-btn').click();
  await page.waitForTimeout(800);

  const order = await page.evaluate(() => window.currentEditorDescData.matchups.map(m => m.opponent));
  expect(order).toEqual(['Zzq Alpha', 'New Character', 'Zzq Beta', 'Zzq Gamma']);
  const texts = await textByName(page, STRIPS[0]);
  expect(texts).toEqual({ Alpha: 'Alpha text', 'New Character': '', Beta: 'Beta text', Gamma: 'Gamma text' });
  expect(errors).toEqual([]);
});
