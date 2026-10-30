// The review chat and the votes on an approved submission are not public
// (owner, 2026-10-30: "I think we should hide ticket_chat history", "hide the
// vote as well").
//
// Approved submissions are read from approved_revisions, a view without
// ticket_chat, supporters or opposers (20261030000000). The table itself is
// closed to everyone but the author and the reviewers. Playwright never
// reaches Postgres, so the grants and the policy are probed on the PR's
// preview database; this file holds the two halves that can be checked here:
// every public page reads the view, and the view publishes nothing private.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const REVISION = {
  id: '00000000-0000-0000-0000-00000000c4a7',
  page_id: 'boomcat',
  page_type: 'character',
  author_name: 'ViewReader',
  created_at: new Date(Date.now() - 3600000).toISOString(),
  approved_at: null,
  qa_metadata: { reviewed_by: 'ViewReviewer', changelog: 'Read from the view' },
  is_delta: false,
  target_scope: null,
  target_key: null,
  delta_payload: null,
  desc_data: {},
  frame_data: {},
};

// What the database answers a logged-out read of the table once the
// migration is in, and the view answering instead.
async function tableClosedViewOpen(page) {
  await page.route('**/rest/v1/pending_revisions**', route => route.fulfill({
    status: 401, contentType: 'application/json',
    body: JSON.stringify({ code: '42501', details: null, hint: null, message: 'permission denied for table pending_revisions' }),
  }));
  await page.route('**/rest/v1/approved_revisions**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([REVISION]),
  }));
  await page.route('**/rest/v1/rpc/get_page_after_revision**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: 'null',
  }));
}

test('History reads approved submissions from the view', async ({ page }) => {
  await tableClosedViewOpen(page);
  await page.goto('/history.html?page=boomcat', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#history-meta-card')).toContainText('ViewReader', { timeout: 30000 });
  await expect(page.locator('#history-meta-card')).toContainText('ViewReviewer');
});

test('Recent Changes reads approved submissions from the view', async ({ page }) => {
  await tableClosedViewOpen(page);
  await page.goto('/recent-changes.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#recent-changes-list')).toContainText('ViewReader', { timeout: 30000 });
  await expect(page.locator('#recent-changes-list')).toContainText('Read from the view');
});

test('the Characters hub\'s recent edits read from the view', async ({ page }) => {
  await tableClosedViewOpen(page);
  await page.goto('/characters/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#recent-character-edits .recent-edit-row')).toContainText(['ViewReader'], { timeout: 30000 });
});

test('the Systems hub\'s site statistics count from the view', async ({ page }) => {
  await tableClosedViewOpen(page);
  await page.goto('/systems/index.html', { waitUntil: 'domcontentloaded' });
  const stat = (label) => page.locator('#wiki-stats .wiki-stat', { hasText: label }).locator('.wiki-stat-value');
  await expect(stat('approved edits')).toHaveText('1', { timeout: 30000 });
  await expect(stat('contributors')).toHaveText('1');
});

// ---------------------------------------------------------------- the migrations

const DIR = path.join(__dirname, '..', 'supabase', 'migrations');
const SQL = fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()
  .map(f => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/--[^\n]*/g, ' '))
  .join('\n');

const VIEW = '"public"."approved_revisions"';
const PRIVATE = ['ticket_chat', 'supporters', 'opposers'];
const definitions = [...SQL.matchAll(/CREATE (?:OR REPLACE )?VIEW "public"\."approved_revisions"[\s\S]*?;/g)];

test('the view publishes none of the private columns', () => {
  expect(definitions.length, 'the view is defined').toBeGreaterThan(0);
  const latest = definitions[definitions.length - 1][0];
  // The view runs as its owner, so its column list is the whole rule.
  expect(latest).not.toMatch(/SELECT\s+\*/);
  for (const column of PRIVATE) expect(latest, column).not.toContain(column);
  expect(latest).toMatch(/WHERE\s+"status"\s*=\s*'approved'/);
});

test('the view is read only for everyone', () => {
  // A one-table view is updatable, and an UPDATE through it runs as its owner,
  // past every policy on pending_revisions. Only SELECT is ever granted.
  const grants = [...SQL.matchAll(/\bGRANT\s+([^;]*?)\s+ON\s+(?:TABLE\s+)?"public"\."approved_revisions"/g)];
  expect(grants.length).toBeGreaterThan(0);
  for (const [, privileges] of grants) expect(privileges.trim()).toBe('SELECT');

  // Production grants ALL on every new relation by default, so the revoke has
  // to come after the view is (re)created.
  const lastCreate = definitions[definitions.length - 1].index;
  for (const role of ['PUBLIC', '"anon"', '"authenticated"']) {
    expect(SQL.indexOf(`REVOKE ALL ON ${VIEW} FROM ${role};`, lastCreate), role).toBeGreaterThan(lastCreate);
  }
});

test('the table is no longer open to the public', () => {
  // The policy that published every column of an approved row, and the
  // logged-out grant it needed, end dropped.
  const policy = 'Public can view approved revisions';
  expect(SQL.lastIndexOf(`DROP POLICY IF EXISTS "${policy}"`)).toBeGreaterThan(SQL.lastIndexOf(`CREATE POLICY "${policy}"`));
  expect(SQL.lastIndexOf('REVOKE SELECT ON TABLE "public"."pending_revisions" FROM "anon"'))
    .toBeGreaterThan(SQL.lastIndexOf('GRANT SELECT ON TABLE "public"."pending_revisions" TO "anon"'));
});
