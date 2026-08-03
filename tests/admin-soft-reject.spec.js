// Regression coverage for the reviewer-workflow redesign's Phase 0 (see
// project memory / plan: "v0.6 Item 4: admin.html Reviewer Workflow/UI
// Redesign"). Rejecting a submission used to permanently DELETE the
// pending_revisions row - including ticket_chat, the discussion that led
// to the decision - leaving no institutional memory of disputed/bad edits
// and no way to spot a repeat problem submission. Fixed by turning reject
// (and self-withdraw) into a status change instead of a delete.
const { test, expect } = require('@playwright/test');

test('real bug fix: rejecting a revision preserves the row and its discussion instead of deleting them', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    // admin.html's RBAC gate wiped document.body for this logged-out
    // visitor - reconstruct just what rejectCurrentPreview actually reads.
    document.body.innerHTML = '';

    const revisionRow = {
      id: 'rev-1',
      page_id: 'testchar',
      author_id: 'author-uuid',
      page_type: 'character',
      qa_metadata: {},
      ticket_chat: [{ author: 'Alice', text: 'Why was this changed?', timestamp: '2026-08-01T00:00:00Z' }],
      supporters: ['reviewer-uuid'],
      opposers: [],
    };

    let deleteWasCalled = false;
    let capturedUpdatePayload = null;

    window.supabaseClient = {
      from(table) {
        if (table === 'pending_revisions') {
          return {
            update(payload) {
              capturedUpdatePayload = payload;
              return { eq: async () => { Object.assign(revisionRow, payload); return { error: null }; } };
            },
            delete() {
              deleteWasCalled = true;
              return { eq: async () => ({ error: null }) };
            },
          };
        }
        if (table === 'user_notifications') {
          return { insert: async () => ({ error: null }) };
        }
        throw new Error('unexpected table: ' + table);
      },
    };

    window.currentQueueData = [revisionRow];
    window.activePreviewRevId = 'rev-1';
    window.currentUserId = 'reviewer-uuid'; // different from author_id -> staff-reject branch, not self-withdraw
    window.currentUsername = 'TestReviewer';
    window.currentUserRoles = ['reviewer'];
    window.buildPageUrl = () => 'testchar/index.html';
    window.adminPrompt = async () => 'Frame data looks wrong, please double-check.';
    // Not relevant to this test's assertion - stub out the UI refresh/alert calls.
    window.resetPreviewState = () => {};
    window.loadQueue = async () => {};
    window.adminAlert = () => {};

    await window.rejectCurrentPreview();

    return {
      deleteWasCalled,
      rowStillExists: window.currentQueueData.length === 1, // sanity: we never removed it from our in-memory mock either
      finalStatus: revisionRow.status,
      ticketChatPreserved: JSON.stringify(revisionRow.ticket_chat) === JSON.stringify([{ author: 'Alice', text: 'Why was this changed?', timestamp: '2026-08-01T00:00:00Z' }]),
      rejectionReasonStored: revisionRow.qa_metadata.rejection_reason,
      reviewedByStored: revisionRow.qa_metadata.reviewed_by,
      updatePayloadHadNoDeleteOfChat: capturedUpdatePayload && !('ticket_chat' in capturedUpdatePayload),
    };
  });

  expect(result.deleteWasCalled).toBe(false);
  expect(result.finalStatus).toBe('rejected');
  expect(result.ticketChatPreserved).toBe(true);
  expect(result.rejectionReasonStored).toBe('Frame data looks wrong, please double-check.');
  expect(result.reviewedByStored).toBe('TestReviewer');
  expect(result.updatePayloadHadNoDeleteOfChat).toBe(true);
});

test('self-withdraw also becomes a status change, not a delete', async ({ page }) => {
  await page.goto('/admin.html', { waitUntil: 'networkidle' });

  const result = await page.evaluate(async () => {
    document.body.innerHTML = '';

    const revisionRow = {
      id: 'rev-2',
      page_id: 'testchar',
      author_id: 'same-user-uuid',
      page_type: 'character',
      qa_metadata: {},
      ticket_chat: [],
      supporters: [],
      opposers: [],
    };

    let deleteWasCalled = false;

    window.supabaseClient = {
      from(table) {
        if (table === 'pending_revisions') {
          return {
            update(payload) {
              return { eq: async () => { Object.assign(revisionRow, payload); return { error: null }; } };
            },
            delete() {
              deleteWasCalled = true;
              return { eq: async () => ({ error: null }) };
            },
          };
        }
        if (table === 'user_notifications') {
          return { insert: async () => ({ error: null }) };
        }
        throw new Error('unexpected table: ' + table);
      },
    };

    window.currentQueueData = [revisionRow];
    window.activePreviewRevId = 'rev-2';
    window.currentUserId = 'same-user-uuid'; // matches author_id -> self-withdraw branch
    window.currentUsername = 'SameUser';
    window.buildPageUrl = () => 'testchar/index.html';
    window.adminConfirm = async () => true;
    window.resetPreviewState = () => {};
    window.loadQueue = async () => {};
    window.adminAlert = () => {};

    await window.rejectCurrentPreview();

    return { deleteWasCalled, finalStatus: revisionRow.status };
  });

  expect(result.deleteWasCalled).toBe(false);
  expect(result.finalStatus).toBe('withdrawn');
});
