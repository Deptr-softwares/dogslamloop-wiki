// What the author saw is the order approval makes, on a system page.
//
// THE BUG (live since 2026-08-17 for sections, 2026-09-08 for tabs; found
// 2026-10-24 while planning the Writing Guide reorganisation)
//
// A system page submits one delta per tab and per section, and approval
// applies them in the order the editor lists them. A tab's metadata carries its
// section ORDER as a list of keys, and it was listed before the sections - so
// it could only place sections that already existed. A new section the author
// moved up, or one moved in from another tab, landed at the bottom of its tab.
// And the tab order only travelled when no tab was added or removed, so a new
// tab moved left landed at the end.
//
// Every test here is a round trip through the real code: buildSystemDeltas
// (what Submit sends) into applyDeltaToData (what approval does), compared
// with what the author had on screen.
const { test, expect } = require('@playwright/test');

const EDITOR = '/edit.html?char=m1-trading&type=system';

const sec = (title) => ({ sectionTitle: title, layout: 'full', blocks: [{ type: 'paragraph', content: title }] });
const tab = (id, label, titles) => ({ tabId: id, tabLabel: label, sections: titles.map(sec) });

async function roundTrip(page, cloud, local) {
  await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.buildSystemDeltas === 'function', { timeout: 15000 });
  return page.evaluate(({ cloud, local }) => {
    const deltas = window.buildSystemDeltas(local, cloud, 'system');
    const out = window.applyDeltaToData(cloud, {}, 'multi', 'batch', deltas).newDesc;
    return {
      tabs: out.tabs.map(t => t.tabLabel),
      sections: Object.fromEntries(out.tabs.map(t => [t.tabLabel, (t.sections || []).map(s => s.sectionTitle)])),
    };
  }, { cloud, local });
}

test('a new section moved up stays where the author put it', async ({ page }) => {
  const out = await roundTrip(page,
    { tabs: [tab('a', 'A', ['One', 'Two'])] },
    { tabs: [tab('a', 'A', ['One', 'New', 'Two'])] });
  expect(out.sections.A).toEqual(['One', 'New', 'Two']);
});

test('a section moved to another tab keeps its place there', async ({ page }) => {
  const out = await roundTrip(page,
    { tabs: [tab('a', 'A', ['One', 'Two']), tab('b', 'B', ['Three'])] },
    { tabs: [tab('a', 'A', ['Two']), tab('b', 'B', ['One', 'Three'])] });
  expect(out.sections).toEqual({ A: ['Two'], B: ['One', 'Three'] });
});

test('a new tab moved left stays where the author put it', async ({ page }) => {
  const out = await roundTrip(page,
    { tabs: [tab('a', 'A', ['One']), tab('b', 'B', ['Two'])] },
    { tabs: [tab('a', 'A', ['One']), tab('new', 'New', ['Three', 'Four']), tab('b', 'B', ['Two'])] });
  expect(out.tabs).toEqual(['A', 'New', 'B']);
  expect(out.sections.New, 'and its sections arrive with it, in order').toEqual(['Three', 'Four']);
});

test('removing a tab and reordering the rest, in one submission', async ({ page }) => {
  const out = await roundTrip(page,
    { tabs: [tab('a', 'A', ['One']), tab('b', 'B', ['Two']), tab('c', 'C', ['Three'])] },
    { tabs: [tab('c', 'C', ['Three', 'One']), tab('b', 'B', ['Two'])] });
  expect(out.tabs).toEqual(['C', 'B']);
  expect(out.sections.C).toEqual(['Three', 'One']);
});

test('an ordinary edit still sends no order at all', async ({ page }) => {
  // The other direction: the fix must not turn every submission into a
  // reorder. One section edited, one tab added at the end.
  await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.buildSystemDeltas === 'function', { timeout: 15000 });
  const scopes = await page.evaluate(({ cloud, local }) => window.buildSystemDeltas(local, cloud, 'system')
    .map(d => `${d.scope} ${d.key}`), {
    cloud: { tabs: [tab('a', 'A', ['One', 'Two'])] },
    local: { tabs: [{ ...tab('a', 'A', ['One', 'Two']), sections: [sec('One'), { ...sec('Two'), blocks: [{ type: 'paragraph', content: 'edited' }] }] }, tab('z', 'Z', ['Last'])] },
  });
  expect(scopes).toContain('system_section a::two');
  expect(scopes).toContain('system_tab z');
  expect(scopes.filter(s => s.startsWith('system_tab_order'))).toEqual([]);
  expect(scopes, 'tab A only had a section edited, so its metadata is not resent').not.toContain('system_tab a');
});
