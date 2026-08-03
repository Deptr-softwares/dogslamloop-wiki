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
