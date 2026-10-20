// Recent colours (v1.1). Owner, 2026-10-20: "The color tray, it takes the most
// recen custom colors the editor used (including custom gradients) and put it
// in there, so the editor don't need to go to color everytime and redraw the
// custom color to get it. It will smartly avoid color that already has a
// preset." Scoped the same day: every colour popup shares one list, a gradient
// shows only where a gradient can be used, a colour is left out only when it
// EXACTLY matches a preset, and ten are kept, newest first, per device.
//
// Driven through the real popups and read back off the swatches they draw.
const { test, expect } = require('@playwright/test');

const para = (text) => ({ type: 'paragraph', content: [text], align: 'left' });
const DESC = {
  overview: [{ type: 'heading', content: 'Title', size: 'h3', align: 'left' }, para('Colour me')],
  profile: { stats: [], image: '' }, extras: [], matchups: [],
};

function mockEditor(page) {
  return page.addInitScript((desc) => {
    try {
      localStorage.setItem('dsl_editor_tutorial_seen', '1');
      localStorage.setItem('dsl_notice_seen_editor', '1');
    } catch (e) { /* ignore */ }
    const rowsFor = (table) => {
      if (table === 'page_data') return { data: { page_id: 'boomcat', desc_data: JSON.parse(JSON.stringify(desc)), frame_data: { m1s: [], specials: [], skills: [] } }, error: null };
      if (['user_roles', 'site_settings', 'page_permissions', 'pending_revisions'].includes(table)) return { data: null, error: null };
      return { data: [], error: null };
    };
    const builder = (table) => {
      const result = rowsFor(table);
      const chain = {
        select() { return chain; }, eq() { return chain; }, in() { return chain; }, neq() { return chain; },
        order() { return chain; }, limit() { return chain; },
        single: async () => result, maybeSingle: async () => result,
        then: (res) => Promise.resolve(result).then(res),
      };
      return chain;
    };
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          lib.createClient = () => ({
            auth: {
              getSession: async () => ({ data: { session: { user: { id: 'c-1', email: 'c@b.c' }, access_token: 't' } } }),
              onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
              signOut: async () => ({}),
            },
            from: builder,
            rpc: async () => ({ data: null, error: null }),
            storage: { from: () => ({ list: async () => ({ data: [], error: null }) }) },
          });
          lib.__patched = true;
        }
      },
    });
  }, DESC);
}

async function bootEditor(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 900 });
  await mockEditor(page);
  await page.goto('/edit.html?char=boomcat&type=character&tab=overview', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#block-list .block-card').first()).toBeVisible({ timeout: 45000 });
  // Blocks start collapsed; a field inside one has no layout until it opens.
  await page.evaluate(() => {
    (window.getActiveBlocks() || []).forEach(b => window.setEditorBlockExpanded(b, true));
    window.renderBlockList();
  });
  return errors;
}

// The paragraph's text, selected the way the toolbar hears it (mouseup).
async function selectParagraph(page) {
  const field = page.locator('#block-list .block-card textarea').first();
  await field.click();
  await field.evaluate(el => {
    el.setSelectionRange(0, el.value.length);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  return field;
}

const toolbarPopup = (page) => page.locator('#format-color-popup');

async function openToolbar(page) {
  await page.locator('#btn-format-color').click();
  await expect(toolbarPopup(page)).toBeVisible();
}

async function closeToolbar(page) {
  await page.locator('#btn-format-color').click();
  await expect(toolbarPopup(page)).toBeHidden();
}

// Each Recent swatch as "#rrggbb", or "a,b" for a gradient, in order.
const recentIn = (page, scope) => page.locator(`${scope} [data-recent-colors] > button`)
  .evaluateAll(bs => bs.map(b => (b.classList.contains('gradient-preset-btn') ? `gradient ${b.getAttribute('data-gradient')}` : b.getAttribute('data-color'))));

async function toolbarRecent(page) {
  await openToolbar(page);
  const out = await recentIn(page, '#format-color-popup');
  await closeToolbar(page);
  return out;
}

async function useCustom(page, hex) {
  await openToolbar(page);
  await toolbarPopup(page).locator('#cp-hex').fill(hex);
  await toolbarPopup(page).locator('#cp-apply').click();
  await expect(toolbarPopup(page)).toBeHidden();
}

// The custom gradient starts on two colours; the first is set to `first`.
async function useCustomGradient(page, first) {
  await openToolbar(page);
  const popup = toolbarPopup(page);
  if (await popup.locator('[data-gradient-builder]').isHidden()) await popup.locator('[data-gradient-toggle]').click();
  if (first) {
    await popup.locator('[data-stop="0"]').click();
    await popup.locator('#cp-hex').fill(first);
  }
  await popup.locator('[data-gradient-use]').click();
  await expect(popup).toBeHidden();
}

test('a custom colour and a custom gradient come back in a Recent row, newest first', async ({ page }) => {
  const errors = await bootEditor(page);
  const field = await selectParagraph(page);

  await openToolbar(page);
  await expect(page.locator('#format-color-popup [data-recent-colors]'), 'nothing recent yet, so no row').toHaveCount(0);
  await closeToolbar(page);

  await useCustom(page, '#123456');
  await expect(field).toHaveValue('[color=#123456]Colour me[/color]');

  await openToolbar(page);
  await expect(page.locator('#format-color-popup .format-color-popup-label').first(), 'Recent comes first').toHaveText('Recent');
  expect(await recentIn(page, '#format-color-popup')).toEqual(['#123456']);
  const painted = await page.locator('#format-color-popup [data-recent-colors] > button').first()
    .evaluate(b => getComputedStyle(b).backgroundColor);
  expect(painted).toBe('rgb(18, 52, 86)');
  // Set off from Basic like every other group is from the next.
  const gaps = await page.evaluate(() => {
    const popup = document.getElementById('format-color-popup');
    const rows = [...popup.querySelectorAll('.format-color-presets-row')];
    const labels = [...popup.querySelectorAll('.format-color-popup-label')];
    const gap = (row, label) => Math.round(label.getBoundingClientRect().top - row.getBoundingClientRect().bottom);
    return { afterRecent: gap(rows[0], labels[1]), afterBasic: gap(rows[1], labels[2]) };
  });
  expect(gaps.afterRecent).toBe(gaps.afterBasic);
  await closeToolbar(page);

  await selectParagraph(page);
  await useCustomGradient(page, '#112233');
  await expect(field).toHaveValue(/\[multicolor=#112233,#22d3ee\]/);
  expect(await toolbarRecent(page)).toEqual(['gradient #112233,#22d3ee', '#123456']);

  // Used again from the row: it applies, and moves to the front.
  await selectParagraph(page);
  await openToolbar(page);
  await page.locator('#format-color-popup [data-recent-colors] [data-color="#123456"]').click();
  await expect(toolbarPopup(page)).toBeHidden();
  await expect(field).toHaveValue(/\[color=#123456\]/);
  expect(await toolbarRecent(page)).toEqual(['#123456', 'gradient #112233,#22d3ee']);
  expect(errors).toEqual([]);
});

test('a colour or gradient a preset already has stays out, and only an exact match does', async ({ page }) => {
  const errors = await bootEditor(page);

  // The first Basic preset, as the browser paints it, typed in as a hex.
  const presetHex = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = colorPresetGroups()[0].swatches[0].color;
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color.match(/[\d.]+/g).slice(0, 3).map(Number);
    probe.remove();
    return `#${rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  });
  await useCustom(page, presetHex);
  // The builder's two starting colours are the Cursed preset.
  await useCustomGradient(page, null);
  await openToolbar(page);
  await page.locator('#format-color-popup .color-preset-btn[title="Vessel"]').click();
  await expect(toolbarPopup(page)).toBeHidden();
  await openToolbar(page);
  await page.locator('#format-color-popup .gradient-preset-btn').first().click();
  await expect(toolbarPopup(page)).toBeHidden();

  expect(await toolbarRecent(page), 'all four already have a preset').toEqual([]);

  // One step off the preset is not the preset (exact match, the owner's pick).
  const near = presetHex.slice(0, 5) + (parseInt(presetHex.slice(5), 16) ^ 1).toString(16).padStart(2, '0');
  await useCustom(page, near);
  expect(await toolbarRecent(page)).toEqual([near]);
  expect(errors).toEqual([]);
});

test('ten at most, newest first, each colour once', async ({ page }) => {
  await bootEditor(page);
  await page.evaluate(() => {
    for (let i = 1; i <= 12; i++) rememberColors([`#0000${i.toString(16).padStart(2, '0')}`]);
  });
  expect(await toolbarRecent(page)).toEqual(
    ['#00000c', '#00000b', '#00000a', '#000009', '#000008', '#000007', '#000006', '#000005', '#000004', '#000003']);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dsl_recent_colors')));
  expect(stored, 'and no more than ten are kept').toHaveLength(10);

  // One from the middle, used again, moves up rather than appearing twice.
  await page.evaluate(() => rememberColors(['#000008']));
  expect(await toolbarRecent(page)).toEqual(
    ['#000008', '#00000c', '#00000b', '#00000a', '#000009', '#000007', '#000006', '#000005', '#000004', '#000003']);
});

test('one list in every colour popup, with gradients only where one can be used', async ({ page }) => {
  const errors = await bootEditor(page);
  await useCustom(page, '#123456');
  await useCustomGradient(page, '#112233');

  // A heading's Side bar takes one colour, so the gradient is not offered.
  const sideBar = page.locator('#block-list .block-card [data-heading-bar]').first();
  await sideBar.click();
  await expect(page.locator('.swatch-popup')).toBeVisible();
  expect(await recentIn(page, '.swatch-popup')).toEqual(['#123456']);

  // And a colour picked there joins the list.
  await page.locator('.swatch-popup #cp-hex').fill('#654321');
  await page.locator('.swatch-popup #cp-apply').click();
  await expect(page.locator('.swatch-popup')).toHaveCount(0);
  expect(await page.evaluate(() => window.getActiveBlocks()[0].sideBar)).toBe('#654321');
  expect(await toolbarRecent(page)).toEqual(['#654321', 'gradient #112233,#22d3ee', '#123456']);

  // Config > Page words take gradients.
  await page.click('#btn-editor-config');
  await page.click('#editor-config-modal [data-config-tab="page"]');
  await page.click('[data-word-add]');
  await page.locator('[data-word-text]').fill('Domain');
  await page.click('[data-word-swatch]');
  expect(await recentIn(page, '.config-word-popup')).toEqual(['#654321', 'gradient #112233,#22d3ee', '#123456']);
  await page.locator('.config-word-popup [data-recent-colors] .gradient-preset-btn').click();
  await expect(page.locator('.config-word-popup')).toBeHidden();
  expect(await page.evaluate(() => window.editorMasterDescData.pageConfig.words))
    .toEqual([{ word: 'Domain', colors: ['#112233', '#22d3ee'] }]);

  // Used there, it moved to the front for the toolbar too.
  await page.keyboard.press('Escape');
  await expect(page.locator('#editor-config-modal')).toBeHidden();
  expect(await toolbarRecent(page)).toEqual(['gradient #112233,#22d3ee', '#654321', '#123456']);
  expect(errors).toEqual([]);
});

test('only plain hex colours come out of storage, whatever is in it', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('dsl_recent_colors', JSON.stringify([
      ['red; position: fixed; inset: 0'], ['#12345g'], '#abcdef', ['#ABCDEF'], [],
      ['#0a0b0c'],
      ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777'],
      ['#123456', 'url(x)'],
    ]));
  });
  const errors = await bootEditor(page);

  await openToolbar(page);
  expect(await recentIn(page, '#format-color-popup')).toEqual(['#0a0b0c']);
  const styles = await page.locator('#format-color-popup [data-recent-colors] > button')
    .evaluateAll(bs => bs.map(b => b.getAttribute('style')));
  expect(styles).toEqual(['background: #0a0b0c;']);
  await closeToolbar(page);
  expect(errors).toEqual([]);
});

test('storage that cannot be read leaves no row, and storage that refuses writes still remembers on the page', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('dsl_recent_colors', '{{ not json');
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'dsl_recent_colors') throw new DOMException('blocked', 'QuotaExceededError');
      return setItem.call(this, key, value);
    };
  });
  const errors = await bootEditor(page);

  expect(await toolbarRecent(page)).toEqual([]);
  await useCustom(page, '#123456');
  expect(await toolbarRecent(page)).toEqual(['#123456']);
  expect(errors).toEqual([]);
});
