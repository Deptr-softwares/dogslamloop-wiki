// Coverage for Workstream B, editor.js PR 4/6: content block builder system
// (initProfileEditor, initPlaystyleEditor, initStrategyBlockBuilder,
// renderBlockList, and the overview/matchups/counterplay preview renderers).
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/edit.html?page=boomcat&type=character&tab=overview', { waitUntil: 'networkidle' });
});

test('initProfileEditor: renders with no inline styles, .block-editor-container-notop wins its margin-top tie', async ({ page }) => {
  await page.evaluate(() => {
    const container = document.createElement('div');
    container.id = 'profile-test';
    document.body.appendChild(container);
    window.currentEditorDescData = window.currentEditorDescData || {};
    window.initProfileEditor('profile-test', { image: '', stats: [{ label: 'Archetype', value: 'Rushdown' }] });
  });
  const wrapper = page.locator('#profile-test .block-editor-container').first();
  expect(await wrapper.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await wrapper.evaluate(el => getComputedStyle(el).marginTop)).toBe('0px'); // not the base rule's 1rem

  const row = page.locator('#profile-test .editor-row').first();
  expect(await row.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await row.evaluate(el => getComputedStyle(el).marginBottom)).toBe('4px'); // 0.25rem
});

test('real bug fix check: .block-type-badge-positive/-negative win their color tie against .block-type-badge base rule', async ({ page }) => {
  await page.evaluate(() => {
    const container = document.createElement('div');
    container.id = 'playstyle-test';
    document.body.appendChild(container);
    window.currentEditorDescData = window.currentEditorDescData || {};
    window.initPlaystyleEditor('playstyle-test', { likes: ['Fast pokes'], dislikes: ['Zoning'] });
  });

  const badges = page.locator('#playstyle-test .block-type-badge');
  await expect(badges).toHaveCount(2);
  expect(await badges.nth(0).evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await badges.nth(0).evaluate(el => getComputedStyle(el).color)).toBe('rgb(34, 197, 94)'); // #22c55e, not .block-type-badge's own #000
  expect(await badges.nth(1).evaluate(el => getComputedStyle(el).color)).toBe('rgb(239, 68, 68)'); // #ef4444

  const cards = page.locator('#playstyle-test .block-card');
  expect(await cards.nth(0).evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await cards.nth(0).evaluate(el => getComputedStyle(el).flexGrow)).toBe('1');
});

test('strategy toolbar: format buttons, color popup, and add-block menu render with no inline styles; .format-btn-code wins its font-size tie', async ({ page }) => {
  await page.evaluate(() => {
    const container = document.createElement('div');
    container.id = 'strategy-test';
    document.body.appendChild(container);
    window.initStrategyBlockBuilder('strategy-test', []);
  });

  const toolbar = page.locator('#strategy-test .add-block-toolbar');
  expect(await toolbar.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await toolbar.evaluate(el => getComputedStyle(el).display)).toBe('flex');

  const codeBtn = page.locator('#strategy-test .format-btn-code');
  expect(await codeBtn.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await codeBtn.evaluate(el => getComputedStyle(el).fontSize)).toBe('10.4px'); // 0.65rem, not .format-btn's own 0.85rem

  const italicBtn = page.locator('#strategy-test .format-btn-italic');
  expect(await italicBtn.evaluate(el => getComputedStyle(el).fontStyle)).toBe('italic');

  const presets = page.locator('#strategy-test .color-preset-btn');
  // A floor since v0.13 item 14, which added the character and frame-data
  // palettes to the picker. This test is about inline styles being removed,
  // not about how many colours are offered - and the count now tracks the
  // character roster, which the owner adds to.
  expect(await presets.count()).toBeGreaterThanOrEqual(7);
  const firstStyle = await presets.first().getAttribute('style');
  expect(firstStyle.trim()).toBe('background: hsl(3, 93%, 63%);'); // only the genuinely-per-preset value stays inline
  expect(await presets.first().evaluate(el => getComputedStyle(el).width)).toBe('20px');

  const popupTitles = page.locator('#strategy-test .add-block-popup-title');
  await expect(popupTitles).toHaveCount(2);
  expect(await popupTitles.nth(1).evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await popupTitles.nth(1).evaluate(el => getComputedStyle(el).marginTop)).toBe('8px'); // 0.5rem
});

test('renderBlockList: heading block input wins its font-family/color tie, table block wins its border/background tie', async ({ page }) => {
  // renderBlockList() always targets document.getElementById('block-list')
  // regardless of which containerId initStrategyBlockBuilder was given, and
  // edit.html already has a real one (inside #strategy-block-target, the
  // page's own "General Strategy" builder) - reuse that real id rather than
  // a custom container, or a duplicate #block-list would collide with it.
  await page.evaluate(() => {
    window.initStrategyBlockBuilder('strategy-block-target', [
      { type: 'heading', content: 'Test Heading', align: 'left', size: 'h3' },
      { type: 'table', headers: ['Stat', 'Value'], rows: [['Damage', '10']], align: 'center' },
    ]);
  });

  const headingInput = page.locator('#block-list .block-heading-input');
  expect(await headingInput.evaluate(el => el.hasAttribute('style'))).toBe(false);
  const headingCs = await headingInput.evaluate(el => ({ color: getComputedStyle(el).color, fontSize: getComputedStyle(el).fontSize }));
  expect(headingCs.color).toBe('rgb(255, 255, 255)'); // #fff, not .editor-input's own #d1d5db
  expect(headingCs.fontSize).toBe('17.6px'); // 1.1rem

  const headerInput = page.locator('#block-list .table-header-input').first();
  expect(await headerInput.evaluate(el => el.hasAttribute('style'))).toBe(false);
  const headerCs = await headerInput.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, borderBottomWidth: getComputedStyle(el).borderBottomWidth }));
  expect(headerCs.bg).toBe('rgba(0, 0, 0, 0.4)'); // not .editor-input's own rgba(255,255,255,0.03)
  expect(headerCs.borderBottomWidth).toBe('2px');

  const typeSelector = page.locator('#block-list .block-type-selector').first();
  expect(await typeSelector.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await typeSelector.evaluate(el => getComputedStyle(el).border)).toContain('0px'); // none, not .editor-select's own 1px solid #222
});

test('renderBlockList: accordion back-banner renders with no inline styles when navigating into inner blocks', async ({ page }) => {
  await page.evaluate(() => {
    window.initStrategyBlockBuilder('strategy-block-target', [
      { type: 'accordion', title: 'My Section', align: 'center', content: [{ type: 'paragraph', content: 'inner text' }] },
    ]);
  });

  await page.locator('#block-list .block-card button.btn-sys-purple').click();

  const banner = page.locator('#block-list .accordion-back-banner');
  await expect(banner).toBeVisible();
  expect(await banner.evaluate(el => el.hasAttribute('style'))).toBe(false);
  await expect(page.locator('#block-list .accordion-back-title')).toHaveText('My Section');
});

test('renderMatchupsPreview/renderCounterplayPreview: card-tier-label keeps its genuinely dynamic per-item color inline', async ({ page }) => {
  await page.evaluate(() => {
    if (!document.getElementById('tab-matchups')) {
      const el = document.createElement('div'); el.id = 'tab-matchups'; document.body.appendChild(el);
    }
    if (!document.getElementById('tab-counterplay')) {
      const el = document.createElement('div'); el.id = 'tab-counterplay'; document.body.appendChild(el);
    }
    window.currentEditorDescData = window.currentEditorDescData || {};
    window.currentEditorDescData.matchups = [{ opponent: 'Boomcat', tier: 'Advantage', content: [] }];
    window.currentEditorDescData.counterplay = [{ topic: 'Zoning', importance: 'Crucial', content: [] }];
    window.renderMatchupsPreview();
    window.renderCounterplayPreview();
  });

  const tierLabel = page.locator('#tab-matchups .card-tier-label');
  const tierStyle = await tierLabel.getAttribute('style');
  expect(tierStyle.trim()).toBe('color: #4ade80;');

  const impLabel = page.locator('#tab-counterplay .card-tier-label');
  const impStyle = await impLabel.getAttribute('style');
  expect(impStyle.trim()).toBe('color: #ef4444;');
});

test('renderFullOverviewPreview: profile-card still gets align-self: flex-start from Layout.css after the redundant inline style was removed', async ({ page }) => {
  await page.evaluate(() => {
    if (!document.getElementById('tab-overview')) {
      const el = document.createElement('div'); el.id = 'tab-overview'; document.body.appendChild(el);
    }
    window.currentEditorDescData = window.currentEditorDescData || {};
    window.currentEditorDescData.profile = { image: '', stats: [{ label: 'Archetype', value: 'Rushdown' }] };
    window.renderFullOverviewPreview();
  });

  const card = page.locator('#tab-overview .profile-card');
  await expect(card).toBeVisible();
  expect(await card.evaluate(el => el.hasAttribute('style'))).toBe(false);
  expect(await card.evaluate(el => getComputedStyle(el).alignSelf)).toBe('flex-start');
});
