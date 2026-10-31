// Coverage for owner.html/js/owner.js: Personnel Management + Media Garbage
// Collection, split out of admin.html/admin.js as part of the admin-page
// rework (they're admin-only tools unrelated to the reviewer workflow
// admin.html is scoped to). Same testing strategy as admin-dedupe.spec.js:
// real Supabase-session-gated behavior isn't automated here (verified
// manually instead) - this covers what's safe to verify without auth.
const { test, expect } = require('@playwright/test');

test('owner.html: kicks logged-out visitors to the access-denied screen with real CSS backing', async ({ page }) => {
  await page.goto('/owner.html', { waitUntil: 'networkidle' });
  const screen = page.locator('.access-denied-screen');
  await expect(screen).toBeVisible();
  expect(await screen.evaluate(el => getComputedStyle(el).display)).toBe('flex');
});

test('owner.html: a slow answer arriving after ACCESS DENIED throws nothing', async ({ page }) => {
  // Each owner tool loads on its own while owner.js decides who is looking. A
  // logged-out visitor is sent to ACCESS DENIED after a 600ms retry, which
  // replaces the page; a read that answers after that wrote into inputs that
  // were gone. That is the order on a slow connection (every run from the
  // owner's machine, 2026-10-31); CI answered first, so it never saw it.
  // The answers here are held until the page has been replaced.
  const thrown = [];
  page.on('pageerror', e => thrown.push(e.message));
  let release;
  const replaced = new Promise(r => { release = r; });
  await page.route('**/rest/v1/site_meta*', async route => {
    await replaced;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ version: 'v1', tagline: 't', hubs: { 'systems-hub': { lists: {} } } }),
    });
  });

  await page.goto('/owner.html');
  await expect(page.locator('.access-denied-screen')).toBeVisible();
  release();
  // Long enough for both held reads to answer and their handlers to run.
  await page.waitForTimeout(1500);
  expect(thrown).toEqual([]);
});

test('owner.html: tool cards render with shared admin-tool-card styling, no inline style', async ({ page }) => {
  await page.goto('/owner.html', { waitUntil: 'networkidle' });
  const result = await page.evaluate(() => {
    const container = document.createElement('div');
    container.innerHTML = `
      <div class="update-log-item admin-tool-card personnel">
        <h3 class="update-title admin-tool-title personnel">Personnel Management</h3>
      </div>
      <div class="update-log-item admin-tool-card gc">
        <h3 class="update-title admin-tool-title gc">Media Garbage Collection</h3>
      </div>
    `;
    document.body.appendChild(container);
    const cards = Array.from(container.querySelectorAll('.admin-tool-card')).map(el => ({
      borderLeftColor: getComputedStyle(el).borderLeftColor,
      hasInlineStyle: el.hasAttribute('style'),
    }));
    container.remove();
    return cards;
  });

  expect(result).toHaveLength(2);
  for (const c of result) {
    expect(c.hasInlineStyle).toBe(false);
    expect(c.borderLeftColor).not.toBe('rgba(0, 0, 0, 0)');
  }
  // Personnel (purple) and GC (red) are visually distinct.
  expect(result[0].borderLeftColor).not.toBe(result[1].borderLeftColor);
});
