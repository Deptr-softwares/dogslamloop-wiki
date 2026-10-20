// Writing checks (v1.1). Owner, 2026-10-18: catch character names written the
// anime's way and broken format tags. Scoped 2026-10-20: "only JJK equivalent
// name count, meme name and shortened name don't count", then "you should also
// warn on Higgy and Kuro". A yellow line under the field while typing, with FIX
// for a name; a list at Submit of what the submission adds or changes, with
// SEND ANYWAY. Exact case, whole words, nothing inside [noauto].
const { test, expect } = require('@playwright/test');

const para = (text) => ({ type: 'paragraph', content: [text], align: 'left' });
const DESC = {
  overview: [
    para('Gojo was written here before this edit.'),
    para('Second paragraph'),
    { type: 'table', headers: ['Move', 'Notes'], rows: [['M1', 'fast']] },
  ],
  profile: { stats: [], image: '' }, extras: [], matchups: [],
};

// The nicknames the owner said not to warn on (2026-10-20), less Higgy and Kuro.
const NOT_WARNED = ['Blue Judas', 'Red Judas', 'Tuca Donka', 'Potential Man', 'Mahitoes', 'Purifier', 'Nchoso',
  'Loving and Caring Brother', 'Menace to Society', 'Greedy Lawyer', 'JJK OC', 'Larping Individual',
  'Bubble Pop Electric', 'Peaceful Gardener', 'Jane Juliet', 'MIT Researcher', 'Bass da da da', 'Mangaka',
  'Tatsuki Fujimoto', 'Kind Scholar', 'I love the taste of iron'];

function mockEditor(page, desc) {
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
  }, desc);
}

async function bootEditor(page, desc = DESC) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 900 });
  await mockEditor(page, desc);
  await page.goto('/edit.html?char=boomcat&type=character&tab=overview', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#block-list .block-card').first()).toBeVisible({ timeout: 45000 });
  await page.evaluate(() => {
    (window.getActiveBlocks() || []).forEach(b => window.setEditorBlockExpanded(b, true));
    window.renderBlockList();
  });
  return errors;
}

const issues = (page, text) => page.evaluate((t) => window.writingIssues(t).map(i => i.text), text);
const paragraph = (page, n) => page.locator(`#block-list .block-card[data-index="${n}"] textarea`).first();
const lines = (page, n) => page.locator(`#block-list .block-card[data-index="${n}"] [data-writing-checks] .writing-check > span`);

test('every JJK name warns with its character, and no nickname does', async ({ page }) => {
  await bootEditor(page);
  const r = await page.evaluate((notWarned) => {
    const character = new Map();
    Object.entries(window.CHARACTER_ALIASES).forEach(([c, list]) => list.forEach(a => character.set(a, c)));
    return {
      missing: window.JJK_NAMES.filter(n => !character.has(n)),
      wrong: window.JJK_NAMES.filter(n => {
        const got = window.writingIssues(`Then ${n} dashes in.`).map(i => i.text);
        return JSON.stringify(got) !== JSON.stringify([`"${n}" is ${character.get(n)} in game.`]);
      }),
      warned: notWarned.filter(n => window.writingIssues(`Then ${n} dashes in.`).length),
      unknown: notWarned.filter(n => !character.has(n)),
    };
  }, NOT_WARNED);
  expect(r.missing, 'every name resolves through CHARACTER_ALIASES').toEqual([]);
  expect(r.wrong).toEqual([]);
  expect(r.warned, 'nicknames are left alone').toEqual([]);
  expect(r.unknown, 'and they are real aliases, so leaving them alone means something').toEqual([]);
  // The two the owner added.
  expect(await issues(page, 'Higgy and Kuro')).toEqual(['"Higgy" is Defense Attorney in game.', '"Kuro" is Black Death in game.']);
});

test('names: exact case, whole words, the longest name first, and never inside [noauto] or a tag', async ({ page }) => {
  await bootEditor(page);
  expect(await issues(page, 'yuji and YUJI')).toEqual([]);
  expect(await issues(page, 'Yujiro, Yuji-kun, Gojo2')).toEqual([]);
  expect(await issues(page, "Yuji's M1")).toEqual(['"Yuji" is Vessel in game.']);
  expect(await issues(page, 'Yuji Itadori, then Yuji again')).toEqual(['"Yuji Itadori" is Vessel in game.', '"Yuji" is Vessel in game.']);
  expect(await issues(page, '[noauto]Yuji[/noauto] and [noauto=all]Gojo[/noauto]')).toEqual([]);
  expect(await issues(page, '[url=https://example.com/Yuji]clip[/url]')).toEqual([]);
});

test('format tags: unclosed, unopened, crossed and unknown, read the way the renderer reads them', async ({ page }) => {
  await bootEditor(page);
  const cases = [
    ['[b]bold', ['[b] is never closed.']],
    ['bold[/b]', ['[/b] has no [b] before it.']],
    ['[b][i]x[/b][/i]', ['[i] is still open at [/b]. Close [i] first.']],
    ['[bb]x[/bb]', ['[/bb] is not a format tag.']],
    ['[colour=red]x[/colour]', ['[colour] is not a format tag.', '[/colour] is not a format tag.']],
    ['[color]x[/color]', ['[/color] has no [color] before it.']],
    ['[url=https://a.b]x', ['[url] is never closed.']],
    ['[B]x[/b] [color=#ff0000][b]y[/b][/color] [M1] [noauto=all]z[/noauto] [multicolor=#fff,#000]w[/multicolor]', []],
  ];
  for (const [text, expected] of cases) {
    expect(await issues(page, text), text).toEqual(expected);
  }
});

test('under the field: a yellow line per problem, FIX renames, and the line goes once it is fixed', async ({ page }) => {
  const errors = await bootEditor(page);
  const field = paragraph(page, 1);
  await field.fill('Yuji dashes in with [b]M1');

  await expect(lines(page, 1)).toHaveText(['"Yuji" is Vessel in game.', '[b] is never closed.']);
  const box = page.locator('#block-list .block-card[data-index="1"] [data-writing-checks]');
  expect(await box.evaluate(b => b.previousElementSibling && b.previousElementSibling.tagName), 'right under the field').toBe('TEXTAREA');
  const yellow = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--accent-yellow)';
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  expect(await lines(page, 1).first().evaluate(el => getComputedStyle(el).color)).toBe(yellow);

  await box.locator('[data-writing-fix="Yuji"]').click();
  await expect(field).toHaveValue('Vessel dashes in with [b]M1');
  await expect(field).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.getActiveBlocks()[1].content)).toEqual(['Vessel dashes in with [b]M1']);
  await expect(lines(page, 1)).toHaveText(['[b] is never closed.']);

  await field.press('End');
  await field.pressSequentially('[/b]');
  await expect(box).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('fields that are not page text are not checked, and a table cell keeps its buttons in place', async ({ page }) => {
  await bootEditor(page);
  await page.locator('#block-list .block-card[data-index="1"] [data-field="author"]').fill('Yuji [b]');
  await expect(page.locator('[data-writing-checks]'), 'a credit is a name, not text').toHaveCount(0);

  // Measured from the card, since filling the cell scrolls the Workspace.
  const addRow = page.locator('#block-list .block-card[data-index="2"] .btn-table-add-row');
  const offset = (b) => b.getBoundingClientRect().top - b.closest('.block-card').getBoundingClientRect().top;
  const before = await addRow.evaluate(offset);
  await page.locator('#block-list .block-card[data-index="2"] .table-cell-input').last().fill('fast into Gojo');
  const box = page.locator('#block-list .block-card[data-index="2"] [data-writing-checks]');
  await expect(box).toHaveText(/"Gojo" is Honored One in game\./);
  expect(await box.evaluate(b => b.previousElementSibling.classList.contains('block-table-actions-row')), 'under the buttons').toBe(true);
  expect(await addRow.evaluate(offset)).toBe(before);
});

test('Submit lists only what this edit wrote, and GO BACK or SEND ANYWAY decide', async ({ page }) => {
  const errors = await bootEditor(page);
  await paragraph(page, 1).fill('Yuji and [b]Todo');

  await page.locator('#submit-payload-btn').click();
  const modal = page.locator('.writing-checks-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.modal-prompt-text')).toHaveText('3 things to check before sending:');
  const items = await modal.locator('.writing-checks-list li').allTextContents();
  expect(items.map(t => t.replace(/^.*?: /, ''))).toEqual(['"Yuji" is Vessel in game.', '"Todo" is Switcher in game.', '[b] is never closed.']);
  expect(items[0], 'says where').toContain('Character Overview');
  expect(items.join(' '), 'Gojo was already on the page').not.toContain('Gojo');

  await modal.locator('[data-writing-back]').click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator('#submit-payload-btn')).toHaveText('Submit');
  await expect(page.locator('#dynamic-qa-modal-overlay:not(.hidden)')).toHaveCount(0);

  await page.locator('#submit-payload-btn').click();
  await modal.locator('[data-writing-send]').click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator('#dynamic-qa-modal-overlay')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a section name in the Submit list is shown as text', async ({ page }) => {
  await bootEditor(page);
  await page.evaluate(() => {
    window.editorMasterDescData.extras.push({ title: '<img src=x onerror="window.__PWN=1">', content: [{ type: 'paragraph', content: ['Yuji'] }] });
    window.confirmWritingChecks();
  });
  const item = page.locator('.writing-checks-modal .writing-checks-list li');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('<img src=x onerror="window.__PWN=1">');
  await expect(page.locator('.writing-checks-modal img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__PWN)).toBeUndefined();
});

test('Submit with nothing to check goes straight on', async ({ page }) => {
  await bootEditor(page);
  await paragraph(page, 1).fill('Vessel dashes in with [b]M1[/b]');
  await page.locator('#submit-payload-btn').click();
  await expect(page.locator('#dynamic-qa-modal-overlay')).toBeVisible();
  await expect(page.locator('.writing-checks-modal')).toHaveCount(0);
});
