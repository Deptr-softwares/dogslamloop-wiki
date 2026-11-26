// Coverage for Workstream B, editor.js PR 6/6 (final): the system-page
// editor (renderSystemEditor, switchSystemTab/Section, addSystemTab/
// Section, updateSystemMeta). Every occurrence in this range turned out to
// exactly match a class already established in PR2 (initFullTabEditor's
// tab-with-a-remove-button pattern, now the site's tab strip: .sub-tab-item/
// .sub-tab-removable/.sub-tab-remove, .editor-nav-row) or PR3/PR4
// (.block-editor-container-tight, .block-field-label-sm) - reused directly
// rather than creating near-duplicate copies, plus 6 new classes for the
// section-tabs row/button color, the add-tab/add-section button font-size,
// the metadata row divider, and the "force new row" checkbox.
const { test, expect } = require('@playwright/test');

const SAMPLE_DESC = {
  tabs: [
    {
      tabId: 'overview', tabLabel: 'Overview',
      sections: [{ sectionTitle: 'Intro', layout: 'full', width: 100, alignment: 'left', forceBreak: true, blocks: [] }],
    },
    { tabId: 'mechanics', tabLabel: 'Mechanics', sections: [{ sectionTitle: 'Details', layout: 'full', blocks: [] }] },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.goto('/edit.html?page=boomcat&type=character&tab=overview', { waitUntil: 'networkidle' });
  await page.evaluate((desc) => {
    const container = document.createElement('div');
    container.id = 'system-editor-test';
    document.body.appendChild(container);
    window.currentEditorDescData = JSON.parse(JSON.stringify(desc));
    window.currentSystemTabIdx = 0;
    window.currentSystemSecIdx = 0;
    window.renderSystemEditor(container);
  }, SAMPLE_DESC);
});

test('main tabs row reuses .editor-nav-row and the tab-with-remove-button pattern, no inline styles', async ({ page }) => {
  const row = page.locator('#system-editor-test .sub-tabs.editor-nav-row');
  await expect(row).toBeVisible();
  expect(await row.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await row.evaluate(el => getComputedStyle(el).marginBottom)).toBe('8px'); // 0.5rem, not the base rule's 1rem

  const items = row.locator('.sub-tab-item');
  await expect(items).toHaveCount(2);
  expect(await items.first().evaluate(el => el.hasAttribute('style'))).toBe(false);

  const tabBtn = items.first().locator('.sub-tab-removable');
  expect(await tabBtn.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await tabBtn.evaluate(el => getComputedStyle(el).paddingRight)).toBe('25.6px'); // 1.6rem

  const removeBtn = items.first().locator('.sub-tab-remove');
  expect(await removeBtn.evaluate(el => el.hasAttribute('style'))).toBe(false);
});

test('the section-tabs row is the site\'s tab strip on its own darker band', async ({ page }) => {
  const row = page.locator('#system-editor-test .sub-tabs.system-section-tabs-row');
  await expect(row).toBeVisible();
  expect(await row.evaluate(el => el.hasAttribute('style'))).toBe(false);
  const cs = await row.evaluate(el => ({
    marginBottom: getComputedStyle(el).marginBottom,
    borderBottomColor: getComputedStyle(el).borderBottomColor,
    background: getComputedStyle(el).backgroundColor,
  }));
  expect(cs.marginBottom).toBe('12px'); // 0.75rem, the strip's own, not .editor-nav-row's 0.5rem
  expect(cs.borderBottomColor).toBe(await row.evaluate(() => { const p = document.createElement('i'); p.style.color = 'var(--border-color)'; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; }));
  expect(cs.background).toBe('rgba(0, 0, 0, 0.2)');
});

test('the open section\'s tab is purple, like its + ADD SECTION, and keeps the remove button\'s room', async ({ page }) => {
  const sectionBtn = page.locator('#system-editor-test .system-section-tab-btn').first();
  await expect(sectionBtn).toBeVisible();
  expect(await sectionBtn.evaluate(el => el.hasAttribute('style'))).toBe(false);
  await expect(sectionBtn).toHaveClass(/\bis-active\b/);
  expect(await sectionBtn.evaluate(el => getComputedStyle(el).color)).toBe('rgb(168, 85, 247)'); // #a855f7
  expect(await sectionBtn.evaluate(el => getComputedStyle(el).borderTopColor)).toBe('rgb(168, 85, 247)');
  expect(await sectionBtn.evaluate(el => getComputedStyle(el).paddingRight)).toBe('25.6px'); // .sub-tab-removable's room
});

test('+ADD TAB / +ADD SECTION are the strip\'s action buttons, at its type size', async ({ page }) => {
  const addTabBtn = page.locator('#system-editor-test .sub-tabs-action').filter({ hasText: 'ADD TAB' });
  await expect(addTabBtn).toBeVisible();
  expect(await addTabBtn.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await addTabBtn.evaluate(el => getComputedStyle(el).fontSize)).toBe('10.4px'); // 0.65rem

  const addSecBtn = page.locator('#system-editor-test .sub-tabs-action').filter({ hasText: 'ADD SECTION' });
  expect(await addSecBtn.evaluate(el => getComputedStyle(el).fontSize)).toBe('10.4px');
});

test('metadata card reuses .block-editor-container-tight and .block-field-label-sm, editor-row-divider renders the second row correctly', async ({ page }) => {
  const card = page.locator('#system-editor-test .block-editor-container').first();
  expect(await card.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await card.evaluate(el => getComputedStyle(el).marginTop)).toBe('0px');

  const labels = page.locator('#system-editor-test .block-field-label-sm');
  await expect(labels).toHaveCount(4); // Tab Name, Section Title, Width, Alignment
  expect(await labels.first().evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await labels.first().evaluate(el => getComputedStyle(el).fontSize)).toBe('10.4px'); // 0.65rem

  const divider = page.locator('#system-editor-test .editor-row-divider');
  expect(await divider.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await divider.evaluate(el => getComputedStyle(el).borderTopStyle)).toBe('dashed');
});

test('checkbox row/label render with no inline styles, and the checkbox itself still gets margin-right from the shared input[type=checkbox] rule', async ({ page }) => {
  const row = page.locator('#system-editor-test .system-checkbox-row');
  await expect(row).toBeVisible();
  expect(await row.evaluate(el => el.hasAttribute('style'))).toBe(false);

  const label = page.locator('#system-editor-test .system-checkbox-label');
  expect(await label.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await label.evaluate(el => getComputedStyle(el).cursor)).toBe('pointer');

  const checkbox = label.locator('input[type="checkbox"]');
  await expect(checkbox).toBeChecked(); // forceBreak: true in SAMPLE_DESC
  expect(await checkbox.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await checkbox.evaluate(el => getComputedStyle(el).marginRight)).toBe('4px'); // matches the deleted inline style's 0.25rem exactly
});

test('switchSystemTab/addSystemSection still work end-to-end after the markup changes', async ({ page }) => {
  // switchSystemTab/addSystemSection (unlike the initial renderSystemEditor
  // call above) hardcode document.getElementById('interactive-builder') as
  // their re-render target regardless of which container the first render
  // used - so interactive tests need the real page container, not the
  // custom one used for the static-render assertions above.
  await page.evaluate((desc) => {
    window.currentEditorDescData = JSON.parse(JSON.stringify(desc));
    window.currentSystemTabIdx = 0;
    window.currentSystemSecIdx = 0;
    window.renderSystemEditor(document.getElementById('interactive-builder'));
  }, SAMPLE_DESC);

  await page.locator('#interactive-builder .sub-tab-item').nth(1).locator('.sub-tab-removable').click();
  await expect(page.locator('#interactive-builder .system-section-tab-btn').filter({ hasText: 'Details' })).toBeVisible();

  await page.locator('#interactive-builder .sub-tabs-action').filter({ hasText: 'ADD SECTION' }).click();
  const sectionItems = page.locator('#interactive-builder .system-section-tabs-row .sub-tab-item');
  await expect(sectionItems).toHaveCount(2);
});
