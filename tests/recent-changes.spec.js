// Coverage for Phase 4 of the reviewer-workflow redesign: a public,
// sitewide feed of approved edits, so a visitor doesn't have to check
// every page's own history.html one at a time to see what's changed
// recently. Public, no RBAC gate, same idiom as history.html.
const { test, expect } = require('@playwright/test');

const FAKE_REVISIONS = Array.from({ length: 20 }, (_, i) => ({
  id: `rev-${i}`,
  page_id: i % 2 === 0 ? 'boomcat' : 'aspiring_mangaka',
  page_type: 'character',
  author_name: `Contributor${i}`,
  status: 'approved',
  is_delta: true,
  target_scope: 'matchup',
  target_key: `vs Opponent ${i}`,
  created_at: new Date(2026, 7, 1, 0, 0, i).toISOString(),
  qa_metadata: { reviewed_by: `Reviewer${i}`, changelog: `Change number ${i}` },
}));

test('recent-changes.html: renders approved revisions across multiple pages for an anonymous visitor', async ({ page }) => {
  await page.route('**/rest/v1/pending_revisions**', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_REVISIONS) });
  });

  await page.goto('/recent-changes.html', { waitUntil: 'networkidle' });

  await expect(page.locator('#recent-changes-list')).toContainText('BOOMCAT');
  await expect(page.locator('#recent-changes-list')).toContainText('ASPIRING MANGAKA');
  await expect(page.locator('#recent-changes-list')).toContainText('Contributor0');
  await expect(page.locator('#recent-changes-list')).toContainText('Reviewer0');
  await expect(page.locator('#recent-changes-list')).toContainText('Change number 0');
});

test('recent-changes.html: escapes author/changelog content (no raw HTML injection from submitted data)', async ({ page }) => {
  await page.route('**/rest/v1/pending_revisions**', route => {
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{
        id: 'rev-xss', page_id: 'boomcat', page_type: 'character',
        author_name: '<img src=x onerror=alert(1)>', status: 'approved', is_delta: false,
        created_at: new Date().toISOString(),
        qa_metadata: { reviewed_by: '<script>alert(2)</script>', changelog: 'safe text' },
      }]),
    });
  });

  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });

  await page.goto('/recent-changes.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  expect(dialogs).toEqual([]);
  const html = await page.locator('#recent-changes-list').innerHTML();
  expect(html).not.toContain('<img src=x');
  expect(html).not.toContain('<script>alert(2)</script>');
});

test('recent-changes.html: pagination - OLDER fetches the next page, NEWER is disabled at the start', async ({ page }) => {
  let lastRangeHeader = null;
  await page.route('**/rest/v1/pending_revisions**', route => {
    lastRangeHeader = route.request().headers()['range'] || null;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_REVISIONS) });
  });

  await page.goto('/recent-changes.html', { waitUntil: 'networkidle' });

  await expect(page.locator('.rc-newer-btn').first()).toBeDisabled();
  await expect(page.locator('.rc-older-btn').first()).toBeEnabled();

  await page.locator('.rc-older-btn').first().click();
  await page.waitForTimeout(300);

  await expect(page.locator('.rc-newer-btn').first()).toBeEnabled();
});

test('navigation.json validates cleanly with the new Recent Changes entry', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  const navData = await page.evaluate(async () => {
    const res = await fetch('data/navigation.json');
    return res.json();
  });
  const allEntries = Object.values(navData).flat();
  const entry = allEntries.find(e => e.id === 'recent-changes');
  expect(entry).toBeTruthy();
  expect(entry.url).toBe('recent-changes.html');
});
