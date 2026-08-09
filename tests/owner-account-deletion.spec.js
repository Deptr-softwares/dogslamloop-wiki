// Coverage for v0.10's account deletion (anonymize).
//
// Owner-confirmed semantics: the account and email go, past edits stay and
// are re-attributed to "Deleted user". Hard deletion would tear holes in page
// history for everyone else - and is not actually possible anyway, because
// pending_revisions.author_id references auth.users with no ON DELETE clause,
// so removing a contributor who has ever submitted anything raises a foreign
// key violation.
const { test, expect } = require('@playwright/test');

async function mockOwnerFor(page, { rpcResult } = {}) {
  await page.addInitScript(({ rpcResult }) => {
    window.__rpcCalls = [];
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__lib; },
      set(lib) {
        window.__lib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          const orig = lib.createClient.bind(lib);
          lib.createClient = (...args) => {
            const client = orig(...args);
            client.auth.getSession = async () => ({ data: { session: { user: { id: 'u-admin' }, access_token: 't' } } });
            const origFrom = client.from.bind(client);
            client.from = (table) => {
              if (table === 'user_roles') {
                return { select() { return this; }, eq: async () => ({ data: [{ role: 'admin' }], error: null }) };
              }
              const chain = {
                select() { return chain; }, eq() { return chain; }, limit() { return Promise.resolve({ data: [], error: null }); },
                order() { return Promise.resolve({ data: [], error: null }); },
              };
              return table === 'site_pages' || table === 'page_permissions' ? chain : origFrom(table);
            };
            client.rpc = async (name, params) => {
              window.__rpcCalls.push({ name, params });
              if (name === 'anonymize_user_by_email') {
                return rpcResult || { data: 'Anonymized x@y.com. 4 revision(s) kept and re-attributed to "Deleted user".', error: null };
              }
              return { data: [], error: null };
            };
            return client;
          };
          lib.__patched = true;
        }
      },
    });
  }, { rpcResult });
}

test('deleting an account calls the anonymize RPC with the email', async ({ page }) => {
  await mockOwnerFor(page);
  await page.goto('/owner.html', { waitUntil: 'networkidle' });
    // owner.html groups its tools as of v0.11; select the one under test.
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('danger'));

  await page.fill('#delete-account-email', 'someone@example.com');
  await page.click('#btn-delete-account');
  await page.locator('#btn-admin-confirm-ok').click();
  await page.waitForTimeout(300);

  const calls = await page.evaluate(() => window.__rpcCalls.filter(c => c.name === 'anonymize_user_by_email'));
  expect(calls).toHaveLength(1);
  expect(calls[0].params).toEqual({ target_email: 'someone@example.com' });
  await expect(page.locator('#delete-account-results')).toContainText('re-attributed');
});

test('the confirmation states what survives, not just that it is permanent', async ({ page }) => {
  // The failure mode worth designing against is an admin expecting a full
  // erasure and being surprised later that the edits are still there.
  await mockOwnerFor(page);
  await page.goto('/owner.html', { waitUntil: 'networkidle' });
    // owner.html groups its tools as of v0.11; select the one under test.
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('danger'));

  await page.fill('#delete-account-email', 'someone@example.com');
  await page.click('#btn-delete-account');

  const message = await page.locator('#admin-confirm-msg').textContent();
  expect(message).toContain('past edits stay');
  expect(message).toContain('Deleted user');
  expect(message).toContain('cannot be undone');
});

test('cancelling deletes nothing', async ({ page }) => {
  await mockOwnerFor(page);
  await page.goto('/owner.html', { waitUntil: 'networkidle' });
    // owner.html groups its tools as of v0.11; select the one under test.
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('danger'));

  await page.fill('#delete-account-email', 'someone@example.com');
  await page.click('#btn-delete-account');
  await page.locator('#btn-admin-confirm-cancel').click();
  await page.waitForTimeout(200);

  const calls = await page.evaluate(() => window.__rpcCalls.filter(c => c.name === 'anonymize_user_by_email'));
  expect(calls).toHaveLength(0);
});

test('an empty email is rejected before the confirm appears', async ({ page }) => {
  await mockOwnerFor(page);
  await page.goto('/owner.html', { waitUntil: 'networkidle' });
    // owner.html groups its tools as of v0.11; select the one under test.
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('danger'));

  await page.click('#btn-delete-account');
  await page.waitForTimeout(200);

  await expect(page.locator('#delete-account-results')).toContainText("Enter the account's email");
  await expect(page.locator('#admin-confirm-modal')).toBeHidden();
});

test('the RPC refusing (e.g. last admin) surfaces its reason', async ({ page }) => {
  await mockOwnerFor(page, {
    rpcResult: { data: null, error: { code: '42501', message: 'Refusing to anonymize the only remaining admin.' } },
  });
  await page.goto('/owner.html', { waitUntil: 'networkidle' });
    // owner.html groups its tools as of v0.11; select the one under test.
    await page.evaluate(() => window.showOwnerGroup && window.showOwnerGroup('danger'));

  await page.fill('#delete-account-email', 'owner@example.com');
  await page.click('#btn-delete-account');
  await page.locator('#btn-admin-confirm-ok').click();
  await page.waitForTimeout(300);

  await expect(page.locator('#delete-account-results')).toContainText('only remaining admin');
});

test('the privacy policy describes what deletion actually does', async ({ request }) => {
  // This page and the tooling ship together deliberately: it previously said
  // there was "no self-serve delete button yet", and leaving that in place
  // would mean publishing a privacy policy that misdescribes the site.
  const html = await (await request.get('/privacy-policy.html')).text();

  expect(html).toContain('Deleted user');
  expect(html).not.toContain('no self-serve delete');
  // The account/email deletion promise must be stated, since that is the part
  // people actually care about.
  expect(html).toMatch(/account and email address are deleted/i);
});
