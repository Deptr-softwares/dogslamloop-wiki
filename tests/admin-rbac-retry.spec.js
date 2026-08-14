// Regression coverage for a real bug: admin-core.js's/owner.js's RBAC gate
// kicked a legitimate staff member to ACCESS DENIED on the very first
// failed getSession()/user_roles lookup, with zero retry - indistinguishable
// from a real logged-out/unauthorized user. Reported live as "access denied
// after going back from recent-changes.html to admin.html, every time, but
// a manual refresh always fixes it" - that pattern (deterministic, refresh
// always recovers it) is consistent with a single dropped request on a
// flaky connection, not just the earlier-fixed bfcache case (which this
// test suite already covers in admin-bfcache-guard.spec.js). Fixed by
// retrying each check once after a short delay before concluding access
// should actually be denied - a genuinely logged-out/unauthorized user
// still fails the retry the same way, so nothing gets more permissive.
const { test, expect } = require('@playwright/test');

// getSession() is called by more than just the RBAC gate under test here -
// js/pagebuilder.js's login dock calls it too, independently, on every page
// - so a shared call-counter (this call is #0, the next is #1...) races
// between callers in an undefined order and doesn't reliably target "the
// RBAC gate's own first attempt". Time-based sequencing sidesteps that:
// every caller, whoever they are, sees the same answer at the same wall-
// clock moment, matching what a real transient outage actually looks like
// (everything in flight fails together, then recovers together).
async function mockAuth(page, { sessionFailWindowMs = 0, roleResults }) {
  await page.addInitScript(({ sessionFailWindowMs, roleResults }) => {
    let rIdx = 0;
    const nextRoleResult = () => {
      const r = roleResults[Math.min(rIdx, roleResults.length - 1)];
      rIdx++;
      return r;
    };

    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return window.__supabaseLib; },
      set(lib) {
        window.__supabaseLib = lib;
        if (lib && lib.createClient && !lib.__patched) {
          const origCreateClient = lib.createClient.bind(lib);
          lib.createClient = (...args) => {
            const client = origCreateClient(...args);
            // Timed from client construction, not page-navigation start -
            // the CDN fetch of the supabase-js library itself happens
            // first and its latency is both real network time and
            // irrelevant to what's under test here, so it shouldn't eat
            // into the fail window below.
            const readyAt = Date.now();

            client.auth.getSession = async () => {
              if (Date.now() - readyAt < sessionFailWindowMs) {
                return { data: { session: null } };
              }
              return { data: { session: { user: { id: 'u1' }, access_token: 'tok' } } };
            };

            const origFrom = client.from.bind(client);
            client.from = (table) => {
              if (table === 'user_roles') {
                // Chainable AND directly awaitable, matching real
                // supabase-js query builders - admin-core.js/owner.js await
                // the .eq(...) result directly, pagebuilder.js chains an
                // extra .single() onto it.
                const chain = {
                  select() { return chain; },
                  eq() { return chain; },
                  single: () => Promise.resolve(nextRoleResult()),
                  then(resolve, reject) { return Promise.resolve(nextRoleResult()).then(resolve, reject); },
                };
                return chain;
              }
              return origFrom(table);
            };

            return client;
          };
          lib.__patched = true;
        }
      },
    });
  }, { sessionFailWindowMs, roleResults });
}

test('real bug fix: admin.html recovers from a getSession() outage that clears before the retry, instead of permanently denying access', async ({ page }) => {
  // "Down" for the first 300ms (long enough that an immediate, un-retried
  // check is guaranteed to land inside it), "recovered" well before the
  // fix's ~600ms retry delay would fire.
  await mockAuth(page, { sessionFailWindowMs: 300, roleResults: [{ data: [{ role: 'reviewer' }], error: null }] });

  await page.goto('/admin.html', { waitUntil: 'domcontentloaded' });
  // The gate retries once over ~600ms. Wait for the thing that proves it
  // finished - an attached queue - rather than for a duration that has to
  // out-guess it. The denial check then means something: it is asserted after
  // the gate has settled, not merely 1200ms later.
  await expect(page.locator('#queue-container')).toBeAttached({ timeout: 15000 });
  expect(await page.locator('.access-denied-screen').count()).toBe(0);
});

test('admin.html still denies access when getSession() has no session for the whole load (genuinely logged out)', async ({ page }) => {
  // Never recovers - a real logged-out user must still get denied even
  // with the retry in place.
  await mockAuth(page, { sessionFailWindowMs: 999999, roleResults: [{ data: [], error: null }] });

  await page.goto('/admin.html', { waitUntil: 'domcontentloaded' });
  // toHaveCount auto-waits, so the denial screen appearing IS the signal.
  await expect(page.locator('.access-denied-screen')).toHaveCount(1, { timeout: 15000 });
});

test('real bug fix: admin.html recovers from one failed user_roles lookup instead of permanently denying access', async ({ page }) => {
  await mockAuth(page, {
    sessionFailWindowMs: 0,
    roleResults: [
      { data: null, error: { message: 'network blip' } },
      { data: [{ role: 'admin' }], error: null },
    ],
  });

  await page.goto('/admin.html', { waitUntil: 'domcontentloaded' });
  // The gate retries once over ~600ms. Wait for the thing that proves it
  // finished - an attached queue - rather than for a duration that has to
  // out-guess it. The denial check then means something: it is asserted after
  // the gate has settled, not merely 1200ms later.
  await expect(page.locator('#queue-container')).toBeAttached({ timeout: 15000 });
  expect(await page.locator('.access-denied-screen').count()).toBe(0);
});

test('admin.html denies access immediately (no retry delay) when the role lookup succeeds but grants no elevated role', async ({ page }) => {
  await mockAuth(page, { sessionFailWindowMs: 0, roleResults: [{ data: [{ role: 'contributor' }], error: null }] });

  await page.goto('/admin.html', { waitUntil: 'domcontentloaded' });
  // Measured from right after DOMContentLoaded (when the RBAC gate's own
  // async handler starts) rather than from before goto(), so page/network
  // load time doesn't dilute what's actually being asserted here: whether
  // the gate itself waits through a retry delay it has no reason to.
  const start = Date.now();
  await expect(page.locator('.access-denied-screen')).toHaveCount(1, { timeout: 2000 });
  const elapsed = Date.now() - start;

  // A successful-but-unauthorized role lookup is a real access decision, not
  // a transient failure - should NOT wait through the ~600ms retry delay.
  expect(elapsed).toBeLessThan(600);
});

test('real bug fix: owner.html recovers from a getSession() outage that clears before the retry, instead of permanently denying access', async ({ page }) => {
  await mockAuth(page, { sessionFailWindowMs: 300, roleResults: [{ data: [{ role: 'admin' }], error: null }] });

  await page.goto('/owner.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#tool-personnel')).toBeAttached({ timeout: 15000 });
  expect(await page.locator('.access-denied-screen').count()).toBe(0);
});
