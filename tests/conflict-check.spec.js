// Config > Actions > Edit Conflict Check (v1.1). Owner, 2026-10-19: "run a
// quick check against the current submission queue and see if any edits on the
// same page will clash with the current edits detected right now".
//
// The editor's side is real: the edits come from the page as typed, through
// the same scan Submit uses. The queue's side is the RPC
// get_open_submission_scopes, answered here from a fixture, because this suite
// cannot reach Postgres. What the RPC itself returns and who may call it is
// probed on the preview database (the supabase-migration skill), not here.
const { test, expect } = require('@playwright/test');

const para = (text) => ({ type: 'paragraph', content: [text], align: 'left' });
const DESC = {
  overview: [para('one')], strategy: [para('plan')],
  profile: { stats: [], image: '' }, extras: [], matchups: [],
};
const FRAME = { m1s: [], specials: [], skills: [] };

function mockEditor(page, { desc = DESC, rows = [], rpcError = null } = {}) {
  return page.addInitScript(({ desc, frame, rows, rpcError }) => {
    window.__rpcCalls = [];
    try {
      localStorage.setItem('dsl_editor_tutorial_seen', '1');
      localStorage.setItem('dsl_notice_seen_editor', '1');
    } catch (e) { /* ignore */ }
    const rowsFor = (table) => {
      if (table === 'page_data') return { data: { page_id: 'boomcat', desc_data: JSON.parse(JSON.stringify(desc)), frame_data: JSON.parse(JSON.stringify(frame)) }, error: null };
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
            rpc: async (name, args) => {
              window.__rpcCalls.push({ name, args });
              if (name !== 'get_open_submission_scopes') return { data: null, error: null };
              return rpcError ? { data: null, error: rpcError } : { data: rows, error: null };
            },
            storage: { from: () => ({ list: async () => ({ data: [], error: null }) }) },
          });
          lib.__patched = true;
        }
      },
    });
  }, { desc, frame: FRAME, rows, rpcError });
}

async function boot(page, opts = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1400, height: 900 });
  await mockEditor(page, opts);
  await page.goto('/edit.html?char=boomcat&type=character&tab=overview', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#block-list .block-card').first()).toBeVisible({ timeout: 45000 });
  return errors;
}

async function runCheck(page) {
  await page.click('#btn-editor-config');
  await page.click('[data-config-tab="actions"]');
  await page.click('[data-conflict-run]');
  const out = page.locator('[data-conflict-result]');
  await expect(out).not.toHaveText('Checking...');
  await expect(out).not.toBeEmpty();
  return out;
}

const editOverview = (page, text = 'my edit') =>
  page.locator('#block-list .block-card').first().locator('textarea.editor-textarea').fill(text);

const row = (over) => ({ revision_id: 'r1', author_name: 'Alice', created_at: '2026-10-18T10:00:00Z', is_mine: false, scope: 'overview', key: 'full', ...over });

test('a submission changing the same section is listed by who and when; one changing another is not', async ({ page }) => {
  const errors = await boot(page, { rows: [
    row({}),
    row({ revision_id: 'r2', author_name: 'Bob', scope: 'strategy' }),
  ] });
  await editOverview(page);
  const out = await runCheck(page);

  const items = out.locator('[data-conflict-item]');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('Alice');
  await expect(items.first()).toContainText('Character Overview');
  await expect(items.first()).toContainText(new Date('2026-10-18T10:00:00Z').toLocaleString());
  await expect(out).not.toContainText('Bob');
  expect(await page.evaluate(() => window.__rpcCalls.filter(c => c.name === 'get_open_submission_scopes')))
    .toEqual([{ name: 'get_open_submission_scopes', args: { p_page_id: 'boomcat' } }]);
  expect(errors).toEqual([]);
});

// The scope alone is not the part: two custom tabs are both 'extra', told apart
// by their title.
test('two custom tabs are two parts: only the one edited clashes', async ({ page }) => {
  await boot(page, {
    desc: { ...DESC, extras: [{ title: 'Tech', content: [para('tech')] }, { title: 'Notes', content: [para('notes')] }] },
    rows: [
      row({ author_name: 'Alice', scope: 'extra', key: 'Notes' }),
      row({ revision_id: 'r2', author_name: 'Bob', scope: 'extra', key: 'Tech' }),
    ],
  });
  await page.click('#overview-nav-extra-0');
  await expect(page.locator('#block-list .block-card').first().locator('textarea.editor-textarea')).toHaveValue('tech');
  await editOverview(page, 'tech, edited');
  const out = await runCheck(page);
  await expect(out.locator('[data-conflict-item]')).toHaveCount(1);
  await expect(out.locator('[data-conflict-item]')).toContainText('Bob');
  await expect(out.locator('[data-conflict-item]')).toContainText('Custom tab "Tech"');
});

test('a whole-page submission clashes with any edit, and your own is marked as yours', async ({ page }) => {
  await boot(page, { rows: [row({ scope: null, key: null, is_mine: true, author_name: 'Me' })] });
  await editOverview(page);
  const out = await runCheck(page);
  await expect(out.locator('[data-conflict-item]')).toHaveCount(1);
  await expect(out.locator('[data-conflict-item]')).toContainText('Me (you)');
  await expect(out.locator('[data-conflict-item]')).toContainText('the whole page');
});

test('an edit to the base kit does not clash with one to a character state', async ({ page }) => {
  await boot(page, { rows: [row({ scope: 'mode', key: 'ultimate::overview::full' })] });
  await editOverview(page);
  const out = await runCheck(page);
  await expect(out).toHaveText('1 submission is waiting for review on this page, and none of them changes what you changed.');
});

test('with no unsent edits there is nothing to check, and the queue is not asked', async ({ page }) => {
  await boot(page, { rows: [row({})] });
  const out = await runCheck(page);
  await expect(out).toHaveText('You have no unsent edits on this page, so nothing can clash with them.');
  expect(await page.evaluate(() => window.__rpcCalls.filter(c => c.name === 'get_open_submission_scopes').length)).toBe(0);
});

test('an empty queue says so', async ({ page }) => {
  await boot(page, { rows: [] });
  await editOverview(page);
  const out = await runCheck(page);
  await expect(out).toHaveText('No submissions are waiting for review on this page.');
});

test('the submission being edited is not reported against itself', async ({ page }) => {
  await boot(page, { rows: [row({ revision_id: 'editing-this' })] });
  await page.evaluate(() => { window.activeEditTicketId = 'editing-this'; });
  await editOverview(page);
  const out = await runCheck(page);
  await expect(out).toHaveText('No submissions are waiting for review on this page.');
});

test('a failed request says what failed instead of reporting no clash', async ({ page }) => {
  await boot(page, { rpcError: { message: 'Could not find the function public.get_open_submission_scopes' } });
  await editOverview(page);
  const out = await runCheck(page);
  await expect(out).toHaveText('Could not check: Could not find the function public.get_open_submission_scopes.');
});

test('an author name is shown as text, never as markup', async ({ page }) => {
  await boot(page, { rows: [row({ author_name: '<img src=x onerror=window.pwnedByName=1>' })] });
  await editOverview(page);
  const out = await runCheck(page);
  await expect(out.locator('[data-conflict-item]')).toContainText('<img src=x onerror=window.pwnedByName=1>');
  await expect(out.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => window.pwnedByName)).toBeUndefined();
});
