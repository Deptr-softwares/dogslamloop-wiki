// Mini icons in text (v1.2, the owner's Kanban card "Add a way for editor to
// add mini icons to their text", "similar to how Dustloop do it").
//
// The owner's pick (2026-11-19): "The 26 accolade icons, the upcoming batch of
// pixel icons, and character icons". Written [icon=accolade/<id>] and
// [icon=character/<page id>], or picked from the editor's icon button. The
// site icons join once they are drawn.
const { test, expect } = require('@playwright/test');

const para = (content) => ({ type: 'paragraph', content });
const PAGE = (blocks) => ({ tabs: [{ tabId: 'overview', tabLabel: 'Overview', sections: [{ sectionTitle: 'Icons', layout: 'full', blocks }] }] });

// The page's own row, from the fixture.
function servePage(page, desc) {
  return page.route('**/rest/v1/page_data*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ page_id: 'hud', page_type: 'system', desc_data: desc, frame_data: {} }),
  }));
}

const rgb = (hex) => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const prose = (page, start) => page.locator('main p', { hasText: start }).first();

test('an accolade icon and a character icon draw inside page text, each named', async ({ page }) => {
  // The character's typed with capitals, as somebody typing by hand might.
  await servePage(page, PAGE([para('Use [icon=accolade/blockbreak] against [b][icon=Character/Boomcat] Boomcat[/b] here.')]));
  await page.goto('/systems/hud/index.html', { waitUntil: 'networkidle' });
  const text = prose(page, 'Use');
  await expect(text).toBeVisible();
  await expect(text).not.toContainText('[icon=');

  // The accolade's own icon, in the accolade's own color rather than the
  // sentence's, and named for a screen reader and on hover.
  const accolade = text.locator('.text-icon.px-icon');
  await expect(accolade).toHaveCount(1);
  await expect(accolade).toHaveAttribute('aria-label', 'Blockbreak');
  await expect(accolade).toHaveAttribute('title', 'Blockbreak');
  const drawn = await accolade.evaluate(el => ({
    color: getComputedStyle(el).color,
    want: window.ACCOLADES.find(a => a.id === 'blockbreak').color,
    file: getComputedStyle(el).maskImage,
  }));
  expect(drawn.color).toBe(rgb(drawn.want));
  expect(drawn.file).toContain('/medias/icons/accolades/blockbreak.png');

  // The character's roster icon, inside the bold it was written in, named
  // once the roster is in, and the name beside it still coloured and linked.
  const character = text.locator('strong img.text-icon-character');
  await expect(character).toHaveCount(1);
  expect(await character.getAttribute('src')).toMatch(/\/medias\/images\/BoomcatIcon\.webp$/);
  await expect.poll(() => character.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  // At the height of the line, not the 128px picture it is.
  const size = await character.evaluate(img => ({ height: img.getBoundingClientRect().height, font: parseFloat(getComputedStyle(img.closest('p')).fontSize) }));
  expect(size.height).toBeGreaterThanOrEqual(size.font);
  expect(size.height).toBeLessThanOrEqual(size.font * 1.5);
  const name = await page.evaluate(async () => (await window.loadCharacterRoster()).get('boomcat').name);
  await expect(character).toHaveAttribute('title', name);
  await expect(character).toHaveAttribute('alt', name);
  await expect(text.locator('.sc-char')).toHaveText(name);
});

test("the owner's site icons draw in text too, in the color of the words around them", async ({ page }) => {
  // Typed with capitals once, as somebody typing by hand might.
  await servePage(page, PAGE([para('Press [icon=ui/edit] to fix it, said the [color=#ff0000][icon=UI/role--guest] guest[/color].')]));
  await page.goto('/systems/hud/index.html', { waitUntil: 'networkidle' });
  const text = prose(page, 'Press');
  await expect(text).toBeVisible();
  await expect(text).not.toContainText('[icon=');
  const drawn = (icon) => icon.evaluate(el => ({
    file: getComputedStyle(el).maskImage,
    color: getComputedStyle(el).backgroundColor,
    around: getComputedStyle(el.parentElement).color,
    size: `${el.getBoundingClientRect().width}x${el.getBoundingClientRect().height}`,
  }));

  const edit = text.locator('.text-icon[aria-label="Edit"]');
  await expect(edit).toHaveCount(1);
  await expect(edit).toHaveAttribute('title', 'Edit');
  const e = await drawn(edit);
  expect(e.file).toContain('/medias/icons/edit.png');
  expect(e).toMatchObject({ size: '16x16', color: e.around });

  // Inside colored words, it takes their color.
  const g = await drawn(text.locator('.text-icon[aria-label="Guest"]'));
  expect(g.file).toContain('/medias/icons/role--guest.png');
  expect(g.color).toBe(rgb('#ff0000'));
});

test('a name it does not know stays as it was typed, so the mistake shows', async ({ page }) => {
  const typed = 'A [icon=accolade/not-one] B [icon=character/not_a_character] C [icon=nothing/blockbreak] D [icon=ui/not-an-icon] E';
  await servePage(page, PAGE([para(typed)]));
  await page.goto('/systems/hud/index.html', { waitUntil: 'networkidle' });
  const text = prose(page, 'A [icon');
  // The character one only fails once its image does, then goes back to text.
  await expect(text).toHaveText(typed);
  await expect(text.locator('.text-icon')).toHaveCount(0);
});

test('a hostile name is never markup', async ({ page }) => {
  const typed = 'X [icon=accolade/blockbreak" onmouseover="window.__hit=1] Y [icon=character/../../js/site_utils] Z';
  // Nor does it send the browser after a path somebody wrote.
  const asked = [];
  // The icon path rule would turn the second name into .../js/siteUtilsIcon.webp.
  page.on('request', r => { if (/site_?utils(?!\.js)|onmouseover/i.test(decodeURIComponent(r.url()))) asked.push(r.url()); });
  await servePage(page, PAGE([para(typed)]));
  await page.goto('/systems/hud/index.html', { waitUntil: 'networkidle' });
  const text = prose(page, 'X [icon');
  await expect(text).toHaveText(typed);
  expect(await text.evaluate(el => [...el.querySelectorAll('*')].some(n => n.hasAttribute('onmouseover')))).toBe(false);
  expect(await text.locator('img, .text-icon').count()).toBe(0);
  expect(asked).toEqual([]);
});

test('the tag stays out of section links, the contents list and search', async ({ page }) => {
  await servePage(page, PAGE([{ type: 'heading', content: '[icon=accolade/qte] QTE moves', size: 'h3' }, para('Text.')]));
  await page.goto('/systems/hud/index.html', { waitUntil: 'networkidle' });

  // The shared list of style tags every anchor, contents entry and search
  // record is cleaned with (js/utility/character_tabs.js).
  expect(await page.evaluate(() => window.stripStyleShortcodes('[icon=accolade/qte] QTE moves').trim())).toBe('QTE moves');

  const heading = page.locator('h3.wiki-block-heading', { hasText: 'QTE moves' });
  await expect(heading.locator('.text-icon')).toHaveCount(1);
  const id = await heading.getAttribute('id');
  expect(id, 'the heading has an anchor').toBeTruthy();
  expect(id).not.toContain('icon');
  expect(id).toContain('qte');
});

// --- THE EDITOR ---
// An ordinary signed-in contributor, and page_data from the fixture.
function mockEditor(page, desc) {
  return page.addInitScript((desc) => {
    const rowsFor = (table) => {
      if (table === 'page_data') return { data: { page_id: 'x', desc_data: desc, frame_data: {} }, error: null };
      if (['user_roles', 'site_settings', 'page_permissions', 'pending_revisions'].includes(table)) return { data: null, error: null };
      return { data: [], error: null };
    };
    const builder = (table) => {
      const result = rowsFor(table);
      const chain = {
        select() { return chain; }, eq() { return chain; }, in() { return chain; }, not() { return chain; },
        order() { return chain; }, limit() { return chain; }, neq() { return chain; },
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
              getSession: async () => ({ data: { session: { user: { id: 'contributor-1', email: 'c@b.c' }, access_token: 't' } } }),
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
  }, desc);
}

test('the icon button lists the accolades and the characters, and puts the picked one in at the caret', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockEditor(page, PAGE([para('Hit them with a ')]));
  await page.goto('/edit.html?char=hud&type=system', { waitUntil: 'domcontentloaded' });
  const field = page.locator('#block-list .block-card textarea').first();
  await expect(field).toBeVisible({ timeout: 45000 });

  // Where a contributor would put it: the end of the sentence.
  await field.click();
  await page.keyboard.press('End');

  await page.locator('#btn-format-icon').click();
  const popup = page.locator('#format-icon-popup');
  await expect(popup).toBeVisible();
  const groups = popup.locator('.format-jump-group');
  await expect(groups).toHaveText(['Accolades', 'Characters', 'UI']);
  const accolades = await page.evaluate(() => window.ACCOLADES.length);
  await expect(popup.locator('.format-icon-item[data-icon^="accolade/"]')).toHaveCount(accolades);
  // Every one of the owner's site icons, each drawn in the list.
  const site = await page.evaluate(() => window.UI_ICONS.map(i => `ui/${i.id}`));
  await expect(popup.locator('.format-icon-item[data-icon^="ui/"]')).toHaveCount(site.length);
  expect(await popup.locator('.format-icon-item[data-icon^="ui/"]').evaluateAll(els => els.map(e => e.dataset.icon))).toEqual(site);
  await expect(popup.locator('.format-icon-item[data-icon^="ui/"] .px-icon')).toHaveCount(site.length);
  // Every character the roster shows whose icon is uploaded, in the roster's
  // order, and none of the hidden ones. Worked out from the files, so a
  // character the owner adds or hides is not a test to edit.
  const shown = await page.evaluate(async () => {
    const loads = (src) => new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth > 0);
      img.onerror = () => resolve(false);
      img.src = src;
    });
    const out = [];
    for (const [id, entry] of (await window.loadCharacterRoster()).entries()) {
      if (!entry.hidden && await loads('/' + window.rosterIconPath(id))) out.push(`character/${id}`);
    }
    return out;
  });
  expect(shown.length, 'setup: characters with an icon').toBeGreaterThan(0);
  await expect.poll(() => popup.locator('.format-icon-item[data-icon^="character/"]').evaluateAll(els => els.map(e => e.dataset.icon))).toEqual(shown);

  // Searching narrows both groups, and a group with nothing left goes.
  await popup.locator('#format-icon-search').fill('break');
  await expect(groups).toHaveText(['Accolades']);
  await expect(popup.locator('.format-icon-item')).toHaveText(['Blockbreak']);

  await popup.locator('.format-icon-item', { hasText: 'Blockbreak' }).click();
  await expect(popup).toBeHidden();
  await expect(field).toHaveValue('Hit them with a [icon=accolade/blockbreak]');

  // The preview draws it.
  const preview = page.locator('#standard-preview-container');
  await expect(preview.locator('.text-icon[aria-label="Blockbreak"]')).toHaveCount(1);

  // A character goes in the same way, at the caret where the last one left it.
  await page.locator('#btn-format-icon').click();
  await popup.locator('#format-icon-search').fill('boomcat');
  await popup.locator('.format-icon-item', { hasText: /^Boomcat$/ }).click();
  await expect(field).toHaveValue('Hit them with a [icon=accolade/blockbreak][icon=character/boomcat]');
  await expect(preview.locator('img.text-icon-character')).toHaveCount(1);

  // And one of the owner's site icons.
  await page.locator('#btn-format-icon').click();
  await popup.locator('#format-icon-search').fill('history');
  await expect(groups).toHaveText(['UI']);
  await popup.locator('.format-icon-item', { hasText: /^History$/ }).click();
  await expect(field).toHaveValue('Hit them with a [icon=accolade/blockbreak][icon=character/boomcat][icon=ui/history]');
  await expect(preview.locator('.text-icon[aria-label="History"]')).toHaveCount(1);
});
