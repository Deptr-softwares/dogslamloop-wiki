// The site's dropdown (window.initializeMangaSelects, site_utils.js) by keyboard and
// for screen readers. Its button was a div until v1.3 and the real <select> it
// stands for is hidden, so Tab never reached a site dropdown anywhere: on the
// roster, 80 presses of Tab went past the Archetype filter.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// One dropdown on every page (v1.3): the owner tools, the post editor, Create Tier
// List's maker, the report box and the forum's category opened the browser's own
// list until then. The last three are built by script, which the first version of
// this test did not read.
test('every select a page or script writes is drawn as the site dropdown', () => {
  const ROOT = path.join(__dirname, '..');
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'vendor') walk(p); }
      else if (e.name.endsWith('.js')) files.push(p);
    }
  };
  walk(path.join(ROOT, 'js'));
  for (const f of fs.readdirSync(ROOT)) if (f.endsWith('.html')) files.push(path.join(ROOT, f));
  // Given editor-select by tier-editor.js once its roster is in, so the list is drawn full.
  const LATER = ['id="tier-copy-character"'];
  const native = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const [tag] of text.matchAll(/<select\s[^>]*>/g)) {
      if (/\beditor-select\b/.test(tag) || LATER.some(mark => tag.includes(mark))) continue;
      native.push(`${path.relative(ROOT, file)}: ${tag.slice(0, 90)}`);
    }
    // Built by script: its class is set in the lines right after.
    for (const m of text.matchAll(/createElement\(\s*['"]select['"]\s*\)/g)) {
      const next = text.slice(m.index, m.index + 200);
      if (!/\beditor-select\b/.test(next)) native.push(`${path.relative(ROOT, file)}: ${next.split('\n').slice(0, 2).join(' ').slice(0, 90)}`);
    }
  }
  expect(files.length).toBeGreaterThan(50);
  expect(native).toEqual([]);
});

const ROSTER_NAV = {
  Characters: [
    { id: 'A', name: 'Alpha', url: 'characters/Alpha/index.html', archetype: 'Rushdown', cms_config: { pageType: 'character', pageId: 'alpha' } },
    { id: 'B', name: 'Beta', url: 'characters/Beta/index.html', archetype: 'Zoner', cms_config: { pageType: 'character', pageId: 'beta' } },
    { id: 'C', name: 'Gamma', url: 'characters/Gamma/index.html', archetype: 'Zoner', cms_config: { pageType: 'character', pageId: 'gamma' } },
  ],
};

async function openRoster(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/data/navigation.json*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROSTER_NAV) }));
  await page.goto('/characters/index.html', { waitUntil: 'networkidle' });
  await expect(page.locator('.roster-card').first()).toBeVisible();
  return errors;
}

// A dropdown the test owns, on a real page: a labelled select.editor-select whose
// change events are recorded.
async function addDropdown(page, { id = 'test-dropdown', options = ['Alpha', 'Beta', 'Gamma', 'Delta'], host = null } = {}) {
  await page.evaluate(({ id, options, host }) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<label for="${id}">Test choice</label>`
      + `<select id="${id}" class="editor-select">${options.map(o => `<option value="${o.toLowerCase()}">${o}</option>`).join('')}</select>`;
    (host ? document.querySelector(host) : document.body).prepend(wrap);
    window.dropdownChanges = [];
    wrap.querySelector('select').addEventListener('change', e => window.dropdownChanges.push(e.target.value));
    window.initializeMangaSelects();
  }, { id, options, host });
  return page.locator(`#${id} + .manga-select-wrapper .manga-select-trigger`);
}

const listOf = (button) => button.locator('xpath=following-sibling::*[contains(@class, "manga-select-options")]');
const activeRow = (button) => listOf(button).locator('.manga-option.is-active');
const focusedIs = (page, selector) => page.evaluate(s => document.activeElement === document.querySelector(s), selector);

test('Tab reaches the roster\'s Archetype dropdown, and Enter, Down and Enter filter the roster', async ({ page }) => {
  const errors = await openRoster(page);
  const button = page.locator('#filter-archetype + .manga-select-wrapper .manga-select-trigger');

  let reached = false;
  for (let i = 0; i < 80 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await focusedIs(page, '#filter-archetype + .manga-select-wrapper .manga-select-trigger');
  }
  expect(reached).toBe(true);
  // The site's focus ring (Layout.css) shows where the keys are.
  expect(await button.evaluate(b => getComputedStyle(b).outlineStyle)).toBe('solid');

  await page.keyboard.press('Enter');
  await expect(listOf(button)).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(activeRow(button)).toHaveText('All');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(activeRow(button)).toHaveText('Zoner');
  await page.keyboard.press('Enter');

  await expect(listOf(button)).toBeHidden();
  await expect(button).toHaveText('Zoner');
  await expect(page.locator('.roster-card')).toHaveCount(2);
  expect(await focusedIs(page, '#filter-archetype + .manga-select-wrapper .manga-select-trigger')).toBe(true);
  expect(errors).toEqual([]);
});

test('the dropdown is a named combobox whose open list points at the row the keys are on', async ({ page }) => {
  await openRoster(page);
  const button = await addDropdown(page);
  await button.focus();

  await expect(button).toHaveAttribute('role', 'combobox');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  // As wide as its wrapper, as the div it replaced was: a <button> on its own is
  // only as wide as its text.
  expect(await button.evaluate(b =>
    Math.abs(b.getBoundingClientRect().width - b.parentElement.getBoundingClientRect().width) < 0.5)).toBe(true);
  // Named by its <label for>, which sits on a select nobody can see.
  const name = await button.evaluate(b => b.getAttribute('aria-labelledby').split(' ')
    .map(id => document.getElementById(id).textContent).join(' '));
  expect(name).toBe('Test choice');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const pointed = await button.evaluate(b => {
    const row = document.getElementById(b.getAttribute('aria-activedescendant'));
    const list = document.getElementById(b.getAttribute('aria-controls'));
    return { text: row && row.textContent, role: row && row.getAttribute('role'),
             inList: !!(row && list && list.contains(row)), listRole: list && list.getAttribute('role') };
  });
  expect(pointed).toEqual({ text: 'Beta', role: 'option', inList: true, listRole: 'listbox' });
  await expect(listOf(button).locator('.manga-option[aria-selected="true"]')).toHaveText('Alpha');

  // The row the keys are on is painted like a row under the mouse, once its
  // 0.15 s fade has run.
  await expect.poll(() => page.evaluate(() => {
    const rows = document.querySelectorAll('#test-dropdown + .manga-select-wrapper .manga-option');
    return getComputedStyle(rows[1]).backgroundColor === getComputedStyle(rows[2]).backgroundColor;
  }), { timeout: 2000 }).toBe(false);
});

test('a <label> written just before a select, without for, names its dropdown', async ({ page }) => {
  await openRoster(page);
  await page.evaluate(() => {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<label class="block-field-label-sm">Shown as</label><select class="editor-select" id="sibling-labelled"><option>One</option></select>';
    document.body.prepend(wrap);
    window.initializeMangaSelects();
  });
  const name = await page.locator('#sibling-labelled + .manga-select-wrapper .manga-select-trigger').evaluate(b =>
    (b.getAttribute('aria-labelledby') || '').split(' ').map(id => document.getElementById(id)?.textContent).join(' '));
  expect(name).toBe('Shown as');
});

test('End on a long list scrolls the list to its last row, and the page stays put', async ({ page }) => {
  await openRoster(page);
  const options = Array.from({ length: 30 }, (_, i) => `Option ${String(i + 1).padStart(2, '0')}`);
  const button = await addDropdown(page, { options });
  await button.focus();
  await page.keyboard.press('ArrowDown');
  const before = await page.evaluate(() => window.scrollY);
  await page.keyboard.press('End');
  await expect(activeRow(button)).toHaveText('Option 30');
  const seen = await activeRow(button).evaluate(row => {
    const r = row.getBoundingClientRect();
    const l = row.closest('.manga-select-options').getBoundingClientRect();
    return r.top >= l.top - 0.5 && r.bottom <= l.bottom + 0.5;
  });
  expect(seen).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});

test('Space opens, Escape closes without picking, and Home, End and typed letters move', async ({ page }) => {
  await openRoster(page);
  const button = await addDropdown(page);
  await button.focus();

  await page.keyboard.press(' ');
  await expect(listOf(button)).toBeVisible();
  await page.keyboard.press('End');
  await expect(activeRow(button)).toHaveText('Delta');
  await page.keyboard.press('Home');
  await expect(activeRow(button)).toHaveText('Alpha');
  await page.keyboard.press('g');
  await expect(activeRow(button)).toHaveText('Gamma');
  await page.keyboard.press('Escape');
  await expect(listOf(button)).toBeHidden();
  await expect(button).toHaveText('Alpha');
  expect(await page.evaluate(() => window.dropdownChanges)).toEqual([]);

  // A typed letter on the closed button opens it there, and Space picks. Space
  // within half a second of a letter is part of the search, as in "Sky B".
  await page.keyboard.press('d');
  await expect(activeRow(button)).toHaveText('Delta');
  await page.waitForTimeout(600);
  await page.keyboard.press(' ');
  await expect(listOf(button)).toBeHidden();
  await expect(button).toHaveText('Delta');
  expect(await page.evaluate(() => [window.dropdownChanges, document.getElementById('test-dropdown').value]))
    .toEqual([['delta'], 'delta']);
});

test('letters typed together search as one word, spaces included', async ({ page }) => {
  await openRoster(page);
  const button = await addDropdown(page, { options: ['Sky Assassin', 'Sky Bender', 'Skyline', 'Boomcat'] });
  await button.focus();
  await page.keyboard.type('sky b');
  await expect(activeRow(button)).toHaveText('Sky Bender');
  await expect(listOf(button)).toBeVisible();
  // The same letter again steps through the rows that start with it.
  await page.waitForTimeout(600);
  await page.keyboard.press('s');
  await expect(activeRow(button)).toHaveText('Skyline');
  await page.keyboard.press('s');
  await expect(activeRow(button)).toHaveText('Sky Assassin');
});

test('Tab closes an open list and moves on, and a click on a row still picks', async ({ page }) => {
  await openRoster(page);
  const button = await addDropdown(page);
  await button.focus();
  await page.keyboard.press('ArrowDown');
  await expect(listOf(button)).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(listOf(button)).toBeHidden();
  expect(await focusedIs(page, '#test-dropdown + .manga-select-wrapper .manga-select-trigger')).toBe(false);

  await button.click();
  await listOf(button).locator('.manga-option', { hasText: 'Gamma' }).click();
  await expect(button).toHaveText('Gamma');
  // The press on the row kept the focus on the button, so the keys carry on.
  expect(await focusedIs(page, '#test-dropdown + .manga-select-wrapper .manga-select-trigger')).toBe(true);
  expect(await page.evaluate(() => window.dropdownChanges)).toEqual(['gamma']);
});

test('inside a box, Escape closes the open list and leaves the box open', async ({ page }) => {
  await openRoster(page);
  await page.evaluate(() => {
    const box = document.createElement('dialog');
    box.id = 'test-box';
    box.className = 'site-dialog';
    box.innerHTML = '<div class="dialog-body" id="test-box-body"></div>';
    document.body.appendChild(box);
    window.openDialog(box);
  });
  const button = await addDropdown(page, { host: '#test-box-body' });
  await button.focus();
  await page.keyboard.press('ArrowDown');
  await expect(listOf(button)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(listOf(button)).toBeHidden();
  expect(await page.evaluate(() => document.getElementById('test-box').open)).toBe(true);

  // With the list closed, Escape is the box's again.
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.getElementById('test-box').open)).toBe(false);
});

test('options a page adds after the first draw show, and a disabled select\'s button is disabled', async ({ page }) => {
  await openRoster(page);
  const button = await addDropdown(page, { options: [] });
  await expect(button).toHaveText('Select...');

  await page.evaluate(() => {
    const select = document.getElementById('test-dropdown');
    select.innerHTML = '<option value="one">One</option><option value="two">Two</option>';
  });
  await expect(button).toHaveText('One');
  await button.click();
  await expect(listOf(button).locator('.manga-option')).toHaveText(['One', 'Two']);
  await page.keyboard.press('Escape');

  // A value set from code fires no event, and the button follows it anyway.
  await page.evaluate(() => { document.getElementById('test-dropdown').value = 'two'; });
  await expect(button).toHaveText('Two');
  await page.evaluate(() => { document.getElementById('test-dropdown').selectedIndex = 0; });
  await expect(button).toHaveText('One');
  expect(await page.evaluate(() => window.dropdownChanges)).toEqual([]);

  await page.evaluate(() => { document.getElementById('test-dropdown').disabled = true; });
  await expect(button).toBeDisabled();
});

test('a disabled option, such as a placeholder, is shown but never picked', async ({ page }) => {
  await openRoster(page);
  const button = await addDropdown(page, { options: ['Category', 'Guide', 'News'] });
  await page.evaluate(() => {
    const select = document.getElementById('test-dropdown');
    select.options[0].disabled = true;
  });
  await button.click();
  const placeholder = listOf(button).locator('.manga-option', { hasText: 'Category' });
  await expect(placeholder).toHaveAttribute('aria-disabled', 'true');
  // The arrows go past it, and a click on it picks nothing.
  await expect(activeRow(button)).toHaveText('Guide');
  await page.keyboard.press('ArrowUp');
  await expect(activeRow(button)).toHaveText('Guide');
  await placeholder.click({ force: true });
  expect(await page.evaluate(() => window.dropdownChanges)).toEqual([]);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(button).toHaveText('News');
});

// A row once took its option's resolved colour. Where no page rule colours options,
// that is inherited from the browser's black field text, so Site settings' font lists
// were black on a reader page, and every dropdown's rows depended on the page.
test('rows are drawn in the dropdown\'s own colours; only an option coloured by its own class or style keeps it', async ({ page }) => {
  const errors = await openRoster(page);
  // What a row at rest and the picked row draw, resolved inside the list.
  const rowColours = (wrapper) => wrapper.evaluate(w => {
    document.getAnimations().forEach(a => { try { a.finish(); } catch (e) { /* endless */ } });
    const list = w.querySelector('.manga-select-options');
    const probe = value => {
      const s = document.createElement('span');
      s.style.color = value;
      list.appendChild(s);
      const c = getComputedStyle(s).color;
      s.remove();
      return c;
    };
    const rows = [...list.querySelectorAll('.manga-option')];
    return {
      muted: probe('var(--text-muted)'), white: probe('var(--text-white)'),
      rest: rows.filter(r => !r.matches('.selected, .is-active')).map(r => getComputedStyle(r).color),
      picked: rows.filter(r => r.matches('.selected:not(.is-active)')).map(r => getComputedStyle(r).color),
    };
  });

  await page.evaluate(() => window.openSiteSettings());
  const font = page.locator('#site-setting-font-title + .manga-select-wrapper');
  await font.locator('.manga-select-trigger').click();
  await expect(font.locator('.manga-option').first()).toBeVisible();
  // Off the picked row, so it shows as picked rather than as the row the keys or
  // the pointer are on.
  await page.keyboard.press('End');
  await page.mouse.move(1, 1);
  const box = await rowColours(font);
  expect(box.rest.length).toBeGreaterThan(1);
  expect(box.picked.length).toBe(1);
  expect(new Set(box.rest)).toEqual(new Set([box.muted]));
  expect(box.picked).toEqual([box.white]);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('#site-settings-overlay')).toBeHidden();

  const button = await addDropdown(page, { options: ['Picked', 'Plain', 'Classed', 'Styled'] });
  await page.evaluate(() => {
    const tone = document.createElement('style');
    tone.textContent = 'option.test-tone { color: rgb(200, 10, 10); }';
    document.head.appendChild(tone);
    const select = document.getElementById('test-dropdown');
    select.options[2].className = 'test-tone';
    select.options[3].style.color = 'rgb(10, 150, 10)';
  });
  await button.click();
  await page.mouse.move(1, 1);
  const own = await rowColours(button.locator('xpath=..'));
  expect(own.rest).toEqual([own.muted, 'rgb(200, 10, 10)', 'rgb(10, 150, 10)']);
  expect(errors).toEqual([]);
});

test('the Block folder picker takes the same keys: End reaches Create new folder and Enter makes it', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/edit.html?char=testchar&tab=overview', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.collectBlockFolders === 'function', { timeout: 15000 });
  await page.evaluate(() => {
    document.body.innerHTML = '<div id="block-host" style="padding: 0 1.5rem"></div>';
    window.initStrategyBlockBuilder('block-host', [{ type: 'paragraph', content: 'one' }, { type: 'paragraph', content: 'two' }]);
  });
  const trigger = page.locator('#block-list .block-card[data-index="0"] .block-folder-trigger');
  await expect(trigger).toHaveText('No folder');
  await expect(trigger).toHaveAttribute('role', 'combobox');

  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const menu = page.locator('#block-list .block-card[data-index="0"] .manga-select-options');
  await expect(menu.locator('.is-active')).toHaveText('No folder');
  await page.keyboard.press('End');
  await expect(menu.locator('.is-active')).toHaveClass(/folder-option-new/);
  await page.keyboard.press('Enter');

  await expect(page.locator('#block-list .block-folder')).toHaveCount(1);
  expect(await page.evaluate(() => window.getActiveBlocks()[0].folder)).toBe('New Folder');
  expect(errors).toEqual([]);
});
