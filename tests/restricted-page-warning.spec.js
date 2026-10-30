// Opening the editor on a page your role cannot submit to says so first (owner's
// board, 2026-10-29, "Better clarification for editors": "When an editor with
// not high enough clearance starts editing a restricted page, there should be
// pop up the warn the editor"). Until now they found out at Submit, after
// writing the whole edit.
//
// The warning only tells. The submit guard in editor-core.js and the
// pending_revisions policy still decide, so this asks the same question they
// do: page_permissions.required_role against the editor's role, via roleMeets.
const { test, expect } = require('@playwright/test');

const DESC = { overview: [{ type: 'paragraph', content: ['one'], align: 'left' }], strategy: [], profile: { stats: [], image: '' }, extras: [], matchups: [] };

function mockEditor(page, { signedIn = true, role = null, requiredRole = null } = {}) {
  return page.addInitScript(({ desc, signedIn, role, requiredRole }) => {
    try {
      localStorage.setItem('dsl_editor_tutorial_seen', '1');
      localStorage.setItem('dsl_notice_seen_editor', '1');
    } catch (e) { /* ignore */ }
    const rowsFor = (table) => {
      if (table === 'page_data') return { data: { page_id: 'boomcat', desc_data: JSON.parse(JSON.stringify(desc)), frame_data: { m1s: [], skills: [], specials: [] } }, error: null };
      if (table === 'page_permissions') return { data: requiredRole ? { page_id: 'boomcat', required_role: requiredRole } : null, error: null };
      if (table === 'user_roles') return { data: role ? { role } : null, error: null };
      if (['site_settings', 'pending_revisions'].includes(table)) return { data: null, error: null };
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
    const session = signedIn ? { user: { id: 'c-1', email: 'c@b.c' }, access_token: 't' } : null;
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          lib.createClient = () => ({
            auth: {
              getSession: async () => ({ data: { session } }),
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
  }, { desc: DESC, signedIn, role, requiredRole });
}

const EDITOR = '/edit.html?char=boomcat&type=character&tab=overview';
const modal = (page) => page.locator('#editor-custom-modal');
const editorLoaded = (page) => expect(page.locator('#block-list .block-card').first()).toBeVisible({ timeout: 45000 });

test('below the page role: warned on the way in, in the owner\'s words', async ({ page }) => {
  await mockEditor(page, { role: null, requiredRole: 'trusted_editor' });
  await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });

  await expect(modal(page)).toBeVisible({ timeout: 45000 });
  await expect(page.locator('#editor-modal-text')).toHaveText(
    'You do not have high enough clearance to submit an edit for this page. This page is restricted to the Trusted Editor role and above. Do you still wish to edit the page?');
  await expect(page.locator('#editor-modal-confirm')).toHaveText('EDIT ANYWAY');
  await expect(page.locator('#editor-modal-cancel')).toHaveText('GO BACK');
  // Asked before the page is built, so nothing has been written yet.
  await expect(page.locator('#block-list .block-card')).toHaveCount(0);
});

test('EDIT ANYWAY opens the editor as usual', async ({ page }) => {
  await mockEditor(page, { role: null, requiredRole: 'trusted_editor' });
  await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  await expect(modal(page)).toBeVisible({ timeout: 45000 });

  await page.locator('#editor-modal-confirm').click();
  await expect(modal(page)).toBeHidden();
  await editorLoaded(page);
});

test('GO BACK leaves the editor', async ({ page }) => {
  await mockEditor(page, { role: null, requiredRole: 'trusted_editor' });
  await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  await expect(modal(page)).toBeVisible({ timeout: 45000 });

  await page.locator('#editor-modal-cancel').click();
  // The editor's own Cancel: back where they came from (about:blank here).
  await expect.poll(() => page.url()).not.toContain('edit.html');
});

test('the role is named for an Administrator page, and the owner for an owner page', async ({ page }) => {
  await mockEditor(page, { role: 'reviewer', requiredRole: 'admin' });
  await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#editor-modal-text')).toContainText('This page is restricted to the Administrator role and above.', { timeout: 45000 });
});

test('an owner-only page names the site owner', async ({ page }) => {
  await mockEditor(page, { role: 'admin', requiredRole: 'owner' });
  await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#editor-modal-text')).toContainText('This page is restricted to the site owner.', { timeout: 45000 });
});

for (const [name, opts] of [
  ['at the page role', { role: 'trusted_editor', requiredRole: 'trusted_editor' }],
  ['above the page role', { role: 'reviewer', requiredRole: 'trusted_editor' }],
  ['on an unrestricted page', { role: null, requiredRole: null }],
  ['signed out (Submit asks them to sign in)', { signedIn: false, role: null, requiredRole: 'trusted_editor' }],
]) {
  test(`no warning ${name}`, async ({ page }) => {
    await mockEditor(page, opts);
    await page.goto(EDITOR, { waitUntil: 'domcontentloaded' });
    await editorLoaded(page);
    await expect(modal(page)).toBeHidden();
  });
}
