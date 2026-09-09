// v0.18 B2 - reordering a system page's TABS must submit, and must apply.
//
// THE BUG
//
// The tab strip has offered the reorder controls since v0.15 item 8
// (js/editor-system.js renders reorderStripControls('desc.tabs')), and clicking
// them did move the array. Nothing recorded the move.
//
// buildSystemDeltas emits `system_tab` per tab and `system_section` per section,
// both keyed by a DERIVED key, and it pairs local against cloud by that key. A
// tab that only changed position therefore has a byte-identical partner under
// the same key, so every scan found nothing, `differs()` was false everywhere,
// and the contributor was told "no changes detected".
//
// Section order has travelled since item 6b, as `order` on the tab's own
// metadata. This is that same idea one level up, and it is the one place item 8
// was wired to a control with no delta behind it.
//
// Filed by the owner as a feature ("add ordering to System Type pages
// navigation tab"). It is a data-loss bug: the control was already there.
const { test, expect } = require('@playwright/test');

const EDITOR = '/edit.html?char=m1-trading&type=system';

const THREE_TABS = {
  tabs: [
    { tabId: 'basics', tabLabel: 'Basics', sections: [{ sectionTitle: 'Intro', layout: 'full', blocks: [{ type: 'paragraph', content: 'one' }] }] },
    { tabId: 'advanced', tabLabel: 'Advanced', sections: [{ sectionTitle: 'Deep', layout: 'full', blocks: [{ type: 'paragraph', content: 'two' }] }] },
    { tabId: 'faq', tabLabel: 'FAQ', sections: [{ sectionTitle: 'Asked', layout: 'full', blocks: [{ type: 'paragraph', content: 'three' }] }] },
  ],
};

async function boot(page) {
  await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.buildSystemDeltas === 'function', { timeout: 15000 });
  await page.waitForTimeout(1200);
}

test('moving a tab ships an order delta', async ({ page }) => {
  await boot(page);

  const deltas = await page.evaluate((live) => {
    const moved = JSON.parse(JSON.stringify(live));
    window.moveListItem(moved.tabs, 2, -1);          // FAQ before Advanced
    return window.buildSystemDeltas(moved, live, 'system');
  }, THREE_TABS);

  const order = deltas.find(d => d.scope === 'system_tab_order');
  expect(order, 'a tab reorder must not be reported as "no changes detected"').toBeTruthy();
  expect(order.key, 'page-level, so it carries the full key like `modes`').toBe('full');
  expect(order.payload).toEqual(['basics', 'faq', 'advanced']);
});

test('a tab reorder ships keys, never tab content', async ({ page }) => {
  await boot(page);

  const deltas = await page.evaluate((live) => {
    const moved = JSON.parse(JSON.stringify(live));
    window.moveListItem(moved.tabs, 2, -1);
    return window.buildSystemDeltas(moved, live, 'system');
  }, THREE_TABS);

  // THE POSITIVE FIRST, AND NOT AS DECORATION. Both assertions below are
  // absence assertions, and against the pre-fix code they passed - because
  // nothing was emitted at all. A test that is green whether the feature exists
  // or not is testing nothing, which is the failure this suite has shipped
  // before. Anchoring on what SHOULD be there makes the two that follow mean
  // "and only that".
  expect(deltas.map(d => d.scope)).toContain('system_tab_order');

  // The whole reason the payload is a list of keys. A reorder that carried
  // content would let moving a tab overwrite an edit somebody else made to it
  // between the ticket being raised and approved.
  expect(deltas.filter(d => d.scope === 'system_section'),
    'a reorder must not resend section content').toEqual([]);
  expect(deltas.filter(d => d.scope === 'system_tab'),
    'a reorder must not resend tab metadata').toEqual([]);
});

test('adding a tab does not also look like a reorder', async ({ page }) => {
  await boot(page);

  const deltas = await page.evaluate((live) => {
    const changed = JSON.parse(JSON.stringify(live));
    changed.tabs.push({ tabId: 'extra', tabLabel: 'Extra', sections: [] });
    return window.buildSystemDeltas(changed, live, 'system');
  }, THREE_TABS);

  // Without the membership test, every add would carry a redundant order delta
  // because the sequence trivially differs by one entry.
  expect(deltas.filter(d => d.scope === 'system_tab_order')).toEqual([]);
  expect(deltas.some(d => d.scope === 'system_tab' && d.key === 'extra'),
    'the add itself still ships').toBe(true);
});

test('applying the delta reorders the tabs and touches nothing inside them', async ({ page }) => {
  await boot(page);

  const out = await page.evaluate((live) =>
    window.applyDeltaToData(JSON.parse(JSON.stringify(live)), {},
      'system_tab_order', 'full', ['faq', 'basics', 'advanced']), THREE_TABS);

  expect(out.newDesc.tabs.map(t => t.tabId)).toEqual(['faq', 'basics', 'advanced']);
  // This scope moves tabs; it does not edit them.
  expect(out.newDesc.tabs.find(t => t.tabId === 'basics').sections[0].blocks[0].content).toBe('one');
});

test('a tab added after the ticket was raised keeps its slot', async ({ page }) => {
  await boot(page);

  // The ticket named three tabs. A fourth landed on the live page in the
  // meantime and is not this delta's business - appending it would move a tab
  // the contributor never touched.
  const out = await page.evaluate((live) => {
    const withNew = JSON.parse(JSON.stringify(live));
    withNew.tabs.splice(1, 0, { tabId: 'brandnew', tabLabel: 'Brand New', sections: [] });
    return window.applyDeltaToData(withNew, {}, 'system_tab_order', 'full', ['faq', 'basics', 'advanced']);
  }, THREE_TABS);

  // brandnew stays at index 1; the three named tabs fill 0, 2 and 3 in order.
  expect(out.newDesc.tabs.map(t => t.tabId)).toEqual(['faq', 'brandnew', 'basics', 'advanced']);
});

test('a payload naming a tab the page no longer has changes nothing else', async ({ page }) => {
  await boot(page);

  const out = await page.evaluate((live) =>
    window.applyDeltaToData(JSON.parse(JSON.stringify(live)), {},
      'system_tab_order', 'full', ['faq', 'deleted-tab', 'basics', 'advanced']), THREE_TABS);

  // The unknown key is dropped rather than creating a hole or throwing.
  expect(out.newDesc.tabs.map(t => t.tabId)).toEqual(['faq', 'basics', 'advanced']);
});

test('the round trip: what the editor sends is what the page becomes', async ({ page }) => {
  await boot(page);

  // The two halves have failed independently before - v0.15 shipped a submit
  // scan that emitted nothing AND an apply that wrote every entry back into the
  // slot it already held. Driving both ends together is the only assertion that
  // catches either.
  const finalOrder = await page.evaluate((live) => {
    const moved = JSON.parse(JSON.stringify(live));
    window.moveListItem(moved.tabs, 0, 1);           // Basics after Advanced
    const deltas = window.buildSystemDeltas(moved, live, 'system');

    let desc = JSON.parse(JSON.stringify(live));
    deltas.forEach(d => {
      desc = window.applyDeltaToData(desc, {}, d.scope, d.key, d.payload).newDesc;
    });
    return desc.tabs.map(t => t.tabId);
  }, THREE_TABS);

  expect(finalOrder).toEqual(['advanced', 'basics', 'faq']);
});
