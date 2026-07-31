// Coverage for architecture pass A-2: tier-list revisions used to fall into
// the character-shaped history renderer and almost always show "no
// renderable content." Mocks a realistic approved revision via network
// interception so the real fetch -> render pipeline runs unmodified,
// without touching production data (pending_revisions is staff-only via
// RLS, so this can't be tested against live Supabase from a test suite).
const { test, expect } = require('@playwright/test');

const FAKE_REVISION = {
  id: '00000000-0000-0000-0000-000000000001',
  page_id: 'tierlist',
  page_type: 'tierlist',
  author_id: '00000000-0000-0000-0000-000000000002',
  author_name: 'test-author',
  created_at: new Date().toISOString(),
  status: 'approved',
  is_delta: false,
  target_scope: null,
  target_key: null,
  delta_payload: null,
  qa_metadata: { reviewed_by: 'test-reviewer', changelog: 'Verification test revision' },
  desc_data: {
    tabs: [
      {
        id: 'overall',
        label: 'Overall',
        tiers: [
          { name: 'S', color: 'hsl(0, 80%, 60%)', characters: ['Boomcat'] },
          { name: 'A', color: 'hsl(30, 80%, 60%)', characters: [] },
        ],
        changelog: [{ date: '2026-07-31', notes: ['Test changelog entry'] }],
      },
    ],
  },
  frame_data: {},
};

test('history.html renders a tier-list revision natively, not the character fallback', async ({ page }) => {
  await page.route('**/rest/v1/pending_revisions**', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([FAKE_REVISION]) });
  });

  await page.goto('/history.html?page=tierlist', { waitUntil: 'networkidle' });

  await expect(page.locator('#tier-list-ui')).toContainText('Boomcat');
  await expect(page.locator('#changelog-container')).toContainText('Test changelog entry');
  await expect(page.locator('body')).not.toContainText('no renderable content');
});
