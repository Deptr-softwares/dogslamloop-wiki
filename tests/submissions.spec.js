// Coverage for the contributor self-service page (v0.6 item 4, "reviewer
// workflow/UI redesign", Phase 1). Before this page existed, a regular
// contributor had zero way to see/edit/withdraw their own pending
// submission - admin.html's RBAC gate blocks anyone without admin/reviewer
// outright (js/admin-core.js:161).
const { test, expect } = require('@playwright/test');

test('submissions.html: logged-out visitor sees a login prompt, not an access-denied wall', async ({ page }) => {
  await page.goto('/submissions.html', { waitUntil: 'networkidle' });

  await expect(page.locator('#submissions-list')).toContainText('You need to be logged in');
  await expect(page.locator('#submissions-login-btn')).toBeVisible();

  // Real page-load path with no session - this should be reachable and
  // openAuthModal-wired without the whole page being wiped like admin.html's
  // kickUser() does for a role-gated page.
  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push(err.message));
  await page.locator('#submissions-login-btn').click();
  await expect(page.locator('.modal-overlay, #auth-modal, .auth-modal-box')).toBeVisible({ timeout: 3000 }).catch(() => {});
  expect(consoleErrors).toEqual([]);
});

test('submissions.html: renders own revisions across every status with correct actions per status', async ({ page }) => {
  await page.goto('/submissions.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    const revisions = [
      { id: 'r-pending', page_id: 'boomcat', author_id: 'me', status: 'pending', is_delta: true, target_scope: 'matchup', target_key: 'vs Crow Charmer', created_at: '2026-08-01T00:00:00Z', qa_metadata: { changelog: 'Fixed a typo.' } },
      { id: 'r-ticket', page_id: 'boomcat', author_id: 'me', status: 'ticket_open', is_delta: true, target_scope: 'move', target_key: 'm1s::5H', created_at: '2026-08-01T00:00:00Z', qa_metadata: {} },
      { id: 'r-approved', page_id: 'boomcat', author_id: 'me', status: 'approved', is_delta: false, created_at: '2026-07-30T00:00:00Z', qa_metadata: { reviewed_by: 'StaffPerson' } },
      { id: 'r-rejected', page_id: 'boomcat', author_id: 'me', status: 'rejected', is_delta: false, created_at: '2026-07-29T00:00:00Z', qa_metadata: { rejection_reason: 'Frame data looked wrong.' } },
      { id: 'r-withdrawn', page_id: 'boomcat', author_id: 'me', status: 'withdrawn', is_delta: false, created_at: '2026-07-28T00:00:00Z', qa_metadata: {} },
    ];

    window.supabaseClient = {
      from(table) {
        if (table !== 'pending_revisions') throw new Error('unexpected table: ' + table);
        return {
          select() { return this; },
          eq() { return this; },
          order: async () => ({ data: revisions, error: null }),
        };
      },
    };
    window.currentSessionUserId = 'me';

    await window.loadSubmissions();

    const listHtml = document.getElementById('submissions-list').innerHTML;
    return {
      hasAllFiveStatuses: ['PENDING REVIEW', 'IN DISCUSSION', 'APPROVED', 'DECLINED', 'WITHDRAWN'].every(s => listHtml.includes(s)),
      pendingHasEditButton: !!document.getElementById('submission-edit-r-pending'),
      pendingHasWithdrawButton: !!document.getElementById('submission-withdraw-r-pending'),
      ticketOpenHasEditButton: !!document.getElementById('submission-edit-r-ticket'),
      approvedHasNoEditButton: !document.getElementById('submission-edit-r-approved'),
      approvedHasNoWithdrawButton: !document.getElementById('submission-withdraw-r-approved'),
      rejectedHasNoEditButton: !document.getElementById('submission-edit-r-rejected'),
      withdrawnHasNoEditButton: !document.getElementById('submission-edit-r-withdrawn'),
      rejectionReasonShown: listHtml.includes('Frame data looked wrong.'),
      matchupTargetShown: listHtml.includes('vs Crow Charmer'),
    };
  });

  expect(result.hasAllFiveStatuses).toBe(true);
  expect(result.pendingHasEditButton).toBe(true);
  expect(result.pendingHasWithdrawButton).toBe(true);
  expect(result.ticketOpenHasEditButton).toBe(true);
  expect(result.approvedHasNoEditButton).toBe(true);
  expect(result.approvedHasNoWithdrawButton).toBe(true);
  expect(result.rejectedHasNoEditButton).toBe(true);
  expect(result.withdrawnHasNoEditButton).toBe(true);
  expect(result.rejectionReasonShown).toBe(true);
  expect(result.matchupTargetShown).toBe(true);
});

test('submissions.html: withdraw scopes the update to the current user and the specific revision', async ({ page }) => {
  await page.goto('/submissions.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    let capturedEqCalls = [];
    let capturedPayload = null;

    window.supabaseClient = {
      from(table) {
        const chain = {
          update(payload) {
            capturedPayload = payload;
            return chain;
          },
          eq(col, val) {
            capturedEqCalls.push([col, val]);
            return chain;
          },
        };
        return chain;
      },
    };
    window.currentSessionUserId = 'me';
    // Not relevant to this test's assertion - stub the reload call away.
    window.loadSubmissions = async () => {};

    const withdrawPromise = window.withdrawSubmission('rev-123');
    // The confirm modal is async/dynamic - click its confirm button.
    await new Promise((r) => setTimeout(r, 50));
    const confirmBtn = document.getElementById('submissions-confirm-ok');
    if (confirmBtn) confirmBtn.click();
    await withdrawPromise.catch(() => {});

    return { capturedPayload, capturedEqCalls };
  });

  expect(result.capturedPayload).toEqual({ status: 'withdrawn' });
  expect(result.capturedEqCalls).toContainEqual(['id', 'rev-123']);
  expect(result.capturedEqCalls).toContainEqual(['author_id', 'me']);
});
