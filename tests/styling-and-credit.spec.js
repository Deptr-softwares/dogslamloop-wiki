// Two owner-reported bugs that share a cause: something rendered in a tab
// whose panel class is `.tab-content` was treated as second class.
//
// 1. INTERNAL STYLING SKIPPED HEADINGS AND LIST ITEMS.
//
//    js/internalstyling.js reached them only through a `.vessel-content`
//    ancestor. Half the character tabs are `.tab-content` (Overview, Combos,
//    M1s, Specials, Techs), so in those a heading kept its literal `[b]…[/b]`
//    and a list item lost every move-name colour, while the paragraph directly
//    beneath worked - paragraphs carry `.strategy-paragraph`, which was never
//    prefixed. The owner found it in Combos' Read First and it was never a
//    Combos bug.
//
// 2. AUTHOR CREDIT WAS SET AND UNREACHABLE.
//
//    spawnBlockWithAuthor stamped the current username onto any block whose
//    template had an `author` field. The theorybox BLOCK editor exposes that
//    field; the combo CARD editor did not, and a card is only ever created
//    through the card path - so the credit could not be removed by hand.
const { test, expect } = require('@playwright/test');

// --- 1. STYLING ---

test('a heading and a list item are styled in a .tab-content tab', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    const host = document.getElementById('tab-combos');
    host.classList.remove('hidden');
    // Rendered by hand rather than through a fixture, so the claim is about
    // the SELECTOR and not about whatever Boomcat happens to carry today.
    host.innerHTML = `
      <h3 class="wiki-block-heading">Heading about Vessel</h3>
      <ul class="wiki-block-list"><li>List item about Vessel</li></ul>
      <p class="strategy-paragraph">Paragraph about Vessel</p>`;

    window.applyInternalStyling();
    await new Promise(r => setTimeout(r, 250));

    const read = (sel) => {
      const el = host.querySelector(sel);
      return { styled: el.classList.contains('is-styled'), html: el.innerHTML };
    };
    return {
      heading: read('.wiki-block-heading'),
      item: read('.wiki-block-list li'),
      paragraph: read('.strategy-paragraph'),
    };
  });

  // The paragraph is the control: it always worked, so if it fails here the
  // fixture is wrong rather than the fix.
  expect(result.paragraph.styled, 'control: a paragraph was always styled').toBe(true);

  expect(result.heading.styled, 'a heading in a .tab-content tab must be styled').toBe(true);
  expect(result.item.styled, 'a list item in a .tab-content tab must be styled').toBe(true);

  // Asserting the class alone would prove the pass RAN, not that it did
  // anything - the trap this project has hit before. The character name has to
  // come out marked up.
  expect(result.heading.html, 'the character name should be marked up in the heading')
    .toContain('<span');
  expect(result.item.html, 'the character name should be marked up in the list item')
    .toContain('<span');

  expect(errors).toEqual([]);
});

test('the .vessel-content tabs keep working', async ({ page }) => {
  // The fix ADDS unprefixed handles; it must not remove the prefixed ones,
  // which are what system pages and move cards rely on for bare <p> and <li>
  // that carry no block class.
  await page.goto('/characters/Boomcat/index.html', { waitUntil: 'networkidle' });

  const styled = await page.evaluate(async () => {
    const host = document.getElementById('tab-counterplay');
    host.classList.remove('hidden');
    host.classList.add('vessel-content');
    host.innerHTML = '<p>Bare paragraph about Vessel</p><li>Bare item about Vessel</li>';
    window.applyInternalStyling();
    await new Promise(r => setTimeout(r, 250));
    return {
      p: host.querySelector('p').classList.contains('is-styled'),
      li: host.querySelector('li').classList.contains('is-styled'),
    };
  });

  expect(styled.p, 'a bare <p> under .vessel-content still styles').toBe(true);
  expect(styled.li, 'a bare <li> under .vessel-content still styles').toBe(true);
});

// --- 2. AUTHOR CREDIT ---

test('a new block carries no author credit', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto('/edit.html?char=boomcat&type=character&tab=overview', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const spawned = await page.evaluate(() => {
    // A username is deliberately present: the old behaviour only stamped when
    // one existed, so an empty one would make this pass for the wrong reason.
    window.currentGlobalUsername = 'SomeContributor';
    return ['list', 'combo', 'accordion', 'table', 'theorybox']
      .map(t => ({ type: t, author: window.spawnBlockWithAuthor(t).author }));
  });

  for (const block of spawned) {
    expect(block.author, `${block.type} must spawn with no credit`).toBe('');
  }
  expect(errors).toEqual([]);
});

test('a combo card exposes its author credit so it can be cleared', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto('/edit.html?char=boomcat&type=character&tab=combos', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  await page.locator('[onclick*="addDocumentGroup"]').click();
  await page.waitForTimeout(400);
  await page.locator('#combo-card-add').click();
  await page.waitForTimeout(400);

  const field = page.locator('[data-card-field="author"]');
  await expect(field, 'the card editor must offer an author field').toHaveCount(1);
  await expect(field).toHaveValue('');

  // Drive it: setting and clearing both have to reach the data, or the field
  // is decoration.
  await field.fill('Someone');
  await page.waitForTimeout(300);
  const set = await page.evaluate(() => {
    const groups = window.currentEditorDescData.comboGroups || [];
    const idx = parseInt(String(window.currentDocSection || '').replace('group-', ''), 10);
    return (groups[idx].content || [])[window.currentDocCardIndex].author;
  });
  expect(set).toBe('Someone');

  await field.fill('');
  await page.waitForTimeout(300);
  const cleared = await page.evaluate(() => {
    const groups = window.currentEditorDescData.comboGroups || [];
    const idx = parseInt(String(window.currentDocSection || '').replace('group-', ''), 10);
    return (groups[idx].content || [])[window.currentDocCardIndex].author;
  });
  expect(cleared, 'clearing the field must clear the credit').toBe('');

  expect(errors).toEqual([]);
});
